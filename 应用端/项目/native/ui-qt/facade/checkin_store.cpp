#include "checkin_store.hpp"

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLockFile>
#include <QSaveFile>
#include <QSet>
#include <algorithm>
#include <filesystem>

#ifdef _WIN32
#include <windows.h>
#endif

namespace {
using codeweave::app::Result;
constexpr qint64 max_file_bytes = 1024 * 1024;

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

Result read_document(const QString& path, QStringList& dates) {
  dates.clear();
  if (!safe_path(path)) return Result::failure("打卡存储路径无效");
  QFile file(path);
  if (!file.exists()) return Result::success();
  if (file.size() > max_file_bytes || !file.open(QIODevice::ReadOnly))
    return Result::failure("无法读取打卡记录，原文件已保留");
  QJsonParseError error;
  const auto bytes = file.read(max_file_bytes + 1);
  const auto document = QJsonDocument::fromJson(bytes, &error);
  if (bytes.size() > max_file_bytes || error.error != QJsonParseError::NoError || !document.isObject() ||
      document.object().value("schemaVersion") != QJsonValue(1) ||
      !document.object().value("dates").isArray())
    return Result::failure("打卡记录损坏或版本不支持，禁止覆盖");
  QSet<QString> unique;
  for (const auto& entry : document.object().value("dates").toArray()) {
    const auto key = entry.toString();
    const auto date = QDate::fromString(key, Qt::ISODate);
    if (!entry.isString() || !date.isValid() || date.toString(Qt::ISODate) != key)
      return Result::failure("打卡日期无效，禁止覆盖原记录");
    unique.insert(key);
  }
  dates = unique.values();
  std::sort(dates.begin(), dates.end());
  return Result::success();
}
}  // namespace

CheckinStore::CheckinStore(QString accountRoot) : root_(std::move(accountRoot)) {}

codeweave::app::Result CheckinStore::read(QStringList& dates) const {
  return read_document(QDir(root_).filePath("learning/checkin.v1.json"), dates);
}

codeweave::app::Result CheckinStore::checkIn(const QDate& today, QStringList& dates) const {
  if (!today.isValid()) return Result::failure("本地打卡日期无效");
  const auto directory = QDir(root_).filePath("learning");
  const auto path = QDir(directory).filePath("checkin.v1.json");
  if (!safe_path(root_) || !safe_path(directory) || !safe_path(path) ||
      !safe_path(path + ".lock") || !QDir().mkpath(directory))
    return Result::failure("打卡目录不可写或路径无效");
  QLockFile lock(path + ".lock");
  if (!lock.tryLock(0)) return Result::failure("打卡记录正被使用，请稍后重试");
  QStringList next;
  const auto loaded = read_document(path, next);
  if (!loaded.ok) return loaded;
  const auto key = today.toString(Qt::ISODate);
  if (next.contains(key)) {
    dates = std::move(next);
    return Result::success("今天已打卡");
  }
  next.append(key);
  std::sort(next.begin(), next.end());
  const auto bytes = QJsonDocument(QJsonObject{{"schemaVersion", 1},
      {"dates", QJsonArray::fromStringList(next)}}).toJson(QJsonDocument::Compact);
  if (bytes.size() > max_file_bytes) return Result::failure("打卡记录已达到大小上限");
  QSaveFile file(path);
  file.setDirectWriteFallback(false);
  if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit())
    return Result::failure("打卡保存失败，原记录未被替换");
  dates = std::move(next);
  return Result::success("今日打卡已保存");
}

int CheckinStore::streak(const QStringList& dates, const QDate& today) {
  if (!today.isValid()) return 0;
  const QSet<QString> recorded(dates.cbegin(), dates.cend());
  auto cursor = today;
  if (!recorded.contains(cursor.toString(Qt::ISODate))) cursor = cursor.addDays(-1);
  int count = 0;
  while (cursor.isValid() && recorded.contains(cursor.toString(Qt::ISODate)) && count < 3650) {
    ++count;
    cursor = cursor.addDays(-1);
  }
  return count;
}
