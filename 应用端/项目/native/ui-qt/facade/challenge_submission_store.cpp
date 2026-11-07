#include "challenge_submission_store.hpp"
#include "output_comparison.hpp"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLockFile>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSet>
#include <filesystem>
#include <functional>

#ifdef _WIN32
#include <windows.h>
#endif

namespace {
using codeweave::app::Result;
constexpr qint64 max_file_bytes = 16 * 1024 * 1024;
constexpr qsizetype max_records = 1000;

bool safe_path(const QString& path) {
  const auto absolute = std::filesystem::path(path.toStdWString());
  if (!absolute.is_absolute()) return false;
  std::filesystem::path current;
  for (const auto& part : absolute) {
    current /= part;
    if (current == absolute.root_name() || current == absolute.root_path()) continue;
    std::error_code error;
    const auto status = std::filesystem::symlink_status(current, error);
    if (error == std::errc::no_such_file_or_directory) continue;
    if (error || std::filesystem::is_symlink(status)) return false;
#ifdef _WIN32
    const auto attributes = GetFileAttributesW(current.c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) return false;
#endif
  }
  return true;
}

bool text(const QJsonObject& record, const QString& name, qsizetype limit, bool required = true) {
  const auto value = record.value(name);
  if (!value.isString()) return false;
  const auto string = value.toString();
  return (!required || !string.trimmed().isEmpty()) && !string.contains(QChar::Null) &&
      QString::fromUtf8(string.toUtf8()) == string && string.toUtf8().size() <= limit;
}

bool lines(const QJsonValue& value, std::vector<std::string>& output) {
  if (!value.isArray() || value.toArray().size() > 100) return false;
  qsizetype bytes = 0;
  for (const auto& item : value.toArray()) {
    if (!item.isString()) return false;
    const auto line = item.toString();
    const auto encoded = line.toUtf8();
    bytes += encoded.size();
    if (bytes > 32768 || line.contains(QChar::Null) || QString::fromUtf8(encoded) != line) return false;
    output.push_back(encoded.toStdString());
  }
  return true;
}

bool valid_observation(const QString& observation) {
  return observation.isEmpty() || observation == QStringLiteral("completed") ||
      observation == QStringLiteral("partially-completed") || observation == QStringLiteral("attempted");
}

bool valid_record(const QJsonObject& record) {
  static const QRegularExpression id(QStringLiteral("^submission-[a-f0-9]{32}$"));
  static const QRegularExpression challenge(QStringLiteral("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$"));
  if (!id.match(record.value("id").toString()).hasMatch() ||
      !challenge.match(record.value("challengeId").toString()).hasMatch() ||
      !text(record, "submittedAt", 40) ||
      !QDateTime::fromString(record.value("submittedAt").toString(), Qt::ISODateWithMs).isValid() ||
      !text(record, "evidence", 8192) || !text(record, "code", 65536, false) ||
      !text(record, "observation", 32, false) || !valid_observation(record.value("observation").toString()) ||
      !text(record, "reviewedAt", 40, false)) return false;
  const auto status = record.value("status").toString();
  const auto tier = record.value("tier").toString();
  const auto reviewed = record.value("reviewedAt").toString();
  if (!reviewed.isEmpty() && !QDateTime::fromString(reviewed, Qt::ISODateWithMs).isValid()) return false;
  std::vector<std::string> expected, output;
  if (!lines(record.value("expected"), expected) || !lines(record.value("output"), output)) return false;
  if (tier == "external") {
    return record.value("judgeMode").toString().isEmpty() &&
        record.value("code").toString().isEmpty() && output.empty() &&
        ((status == "submitted" && reviewed.isEmpty()) ||
         ((status == "verified" || status == "rejected") && !reviewed.isEmpty()));
  }
  return (tier == "teaching" || tier == "qt-js") && status == "passed" && reviewed.isEmpty() &&
      !record.value("code").toString().trimmed().isEmpty() &&
      record.value("judgeMode").toString() == "exact-lines" &&
      codeweave::learning::judge_output(expected, output).passed;
}

Result read_document(const QString& path, QVariantList& records) {
  records.clear();
  if (!safe_path(path)) return Result::failure("挑战提交存储路径无效");
  QFile file(path);
  if (!file.exists()) return Result::success();
  if (file.size() > max_file_bytes || !file.open(QIODevice::ReadOnly))
    return Result::failure("无法读取挑战提交档案，原文件已保留");
  QJsonParseError error;
  const auto document = QJsonDocument::fromJson(file.read(max_file_bytes + 1), &error);
  if (error.error != QJsonParseError::NoError || !document.isObject() ||
      document.object().value("schemaVersion").toInt() != 1 ||
      !document.object().value("records").isArray())
    return Result::failure("挑战提交档案损坏或版本不支持，禁止覆盖");
  const auto entries = document.object().value("records").toArray();
  if (entries.size() > max_records) return Result::failure("挑战提交档案超过记录上限");
  QSet<QString> ids;
  for (const auto& entry : entries) {
    const auto record = entry.toObject();
    const auto id = record.value("id").toString();
    if (!entry.isObject() || !valid_record(record) || ids.contains(id))
      return Result::failure("挑战提交记录无效，禁止覆盖原档案");
    ids.insert(id);
    records.append(record.toVariantMap());
  }
  return Result::success();
}

Result mutate_document(const QString& root, QVariantList& records,
    const std::function<Result(QVariantList&)>& mutation) {
  const auto directory = QDir(root).filePath("learning");
  const auto path = QDir(directory).filePath("challenge-submissions.v1.json");
  const auto lock_path = path + ".lock";
  if (!safe_path(root) || !safe_path(directory) ||
      !safe_path(path) || !safe_path(lock_path) || !QDir().mkpath(directory))
    return Result::failure("挑战提交目录不可写或路径无效");
  QLockFile lock(lock_path);
  if (!lock.tryLock(0)) return Result::failure("挑战提交档案正被使用，请稍后重试");
  QVariantList next;
  const auto read = read_document(path, next);
  if (!read.ok) return read;
  const auto result = mutation(next);
  if (!result.ok) return result;
  const auto encoded = QJsonDocument(QJsonObject{{"schemaVersion", 1},
      {"records", QJsonArray::fromVariantList(next)}}).toJson(QJsonDocument::Compact);
  if (encoded.size() > max_file_bytes) return Result::failure("挑战提交档案已达到大小上限");
  QSaveFile file(path);
  file.setDirectWriteFallback(false);
  if (!file.open(QIODevice::WriteOnly) || file.write(encoded) != encoded.size() || !file.commit())
    return Result::failure("挑战提交保存失败，原档案未被替换");
  records = std::move(next);
  return result;
}
}  // namespace

ChallengeSubmissionStore::ChallengeSubmissionStore(QString accountRoot) : root_(std::move(accountRoot)) {}

Result ChallengeSubmissionStore::read(QVariantList& records) const {
  return read_document(QDir(root_).filePath("learning/challenge-submissions.v1.json"), records);
}

Result ChallengeSubmissionStore::append(const QVariantMap& record, QVariantList& records) const {
  const auto object = QJsonObject::fromVariantMap(record);
  if (!valid_record(object) || (object.value("status") != "submitted" && object.value("status") != "passed"))
    return Result::failure("挑战提交内容无效");
  return mutate_document(root_, records, [&](QVariantList& next) {
    for (const auto& existing : next) {
      const auto item = existing.toMap();
      if (item.value("id") != record.value("id")) continue;
      return item == record ? Result::success("重复挑战提交已忽略") : Result::failure("提交 ID 已用于其他内容");
    }
    if (next.size() >= max_records) return Result::failure("挑战提交已达到记录上限");
    next.append(record);
    return Result::success("挑战提交已保存");
  });
}

Result ChallengeSubmissionStore::review(const QString& id, bool passed,
    const QString& observation, QVariantList& records) const {
  if (!valid_observation(observation)) return Result::failure("学习状态标注无效");
  return mutate_document(root_, records, [&](QVariantList& next) {
    for (auto& existing : next) {
      auto item = existing.toMap();
      if (item.value("id").toString() != id) continue;
      if (item.value("status") != "submitted" || item.value("tier") != "external")
        return Result::failure("仅待确认的外部证据可人工复核");
      item["status"] = passed ? "verified" : "rejected";
      item["observation"] = observation;
      item["reviewedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
      existing = item;
      return Result::success(passed ? "已人工确认通过（非系统自动验证）" : "已人工标记不通过");
    }
    return Result::failure("找不到待复核的挑战提交");
  });
}
