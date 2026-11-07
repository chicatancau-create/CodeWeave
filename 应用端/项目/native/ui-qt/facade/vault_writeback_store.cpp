#include "vault_writeback_store.hpp"

#include "progress_projection.hpp"

#include <QCryptographicHash>
#include <QDate>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLockFile>
#include <QRegularExpression>
#include <QSaveFile>
#include <QStringDecoder>
#include <QSet>
#include <QUuid>

#include <algorithm>
#include <fstream>
#include <iterator>
#include <map>
#include <memory>

#ifdef _WIN32
#include <windows.h>
#endif

namespace {
using codeweave::app::Result;
using codeweave::learning::EvidenceRecord;
using codeweave::learning::EvidenceState;
constexpr qint64 kMaxVaultFileBytes = 8 * 1024 * 1024;
constexpr qint64 kMaxTransactionBytes = 24 * 1024 * 1024;
constexpr auto kProgressPath = "全栈工程师学习计划/进度追踪.md";
constexpr auto kPlanPath = "全栈工程师学习计划/全栈竞赛长期冲刺总计划.md";

QString hash_bytes(const QByteArray& bytes) {
  return QString::fromLatin1(QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex());
}

bool safe_path(const std::filesystem::path& path) {
  if (!path.is_absolute()) return false;
  auto current = std::filesystem::path{};
  for (const auto& part : path) {
    current /= part;
    if (current == path.root_name() || current == path.root_path()) continue;
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

QString qpath(const std::filesystem::path& path) { return QString::fromStdWString(path.wstring()); }

QString to_utf8(const std::string& value) { return QString::fromUtf8(value.data(), static_cast<qsizetype>(value.size())); }

QString safe_topic(QString value) {
  value.replace(QRegularExpression(QStringLiteral("[\\\\/:*?\"<>|]")), QStringLiteral("-"));
  value.replace(QRegularExpression(QStringLiteral("\\s+")), QStringLiteral(" "));
  value = value.trimmed();
  if (value.isEmpty()) value = QStringLiteral("学习记录");
  return value.left(120);
}

bool valid_relative(const QString& relative) {
  if (relative == QString::fromUtf8(kProgressPath) || relative == QString::fromUtf8(kPlanPath)) return true;
  static const QRegularExpression log_path(QStringLiteral(
      "^全栈工程师学习计划/学习日志/\\d{4}-\\d{2}/\\d{4}-\\d{2}-\\d{2}-[A-Za-z0-9._-]{1,128}\\.md$"));
  return log_path.match(relative).hasMatch() && !relative.contains(QStringLiteral(".."));
}

bool valid_operation(const QString& operation) {
  return codeweave::learning::is_operation_id(operation.toStdString());
}

struct Target {
  QString path;
  QString kind;
  QString expected_hash;
  QString after;
  QString backup;
  QString post_hash;
  bool existed{};
  bool applied{};
  bool skipped{};
  bool prepared{};
  bool restored{};
};

QJsonObject target_json(const Target& target) {
  return {{"path", target.path}, {"kind", target.kind},
      {"expectedHash", target.expected_hash}, {"after", target.after},
      {"backup", target.backup}, {"postHash", target.post_hash},
      {"existed", target.existed}, {"applied", target.applied}, {"skipped", target.skipped},
      {"prepared", target.prepared}, {"restored", target.restored}};
}

Target target_from_json(const QJsonObject& object) {
  return {object.value("path").toString(), object.value("kind").toString(),
      object.value("expectedHash").toString(), object.value("after").toString(),
      object.value("backup").toString(), object.value("postHash").toString(),
      object.value("existed").toBool(), object.value("applied").toBool(),
      object.value("skipped").toBool(), object.value("prepared").toBool(), object.value("restored").toBool()};
}

bool read_target(const std::filesystem::path& root, const QString& relative,
    QByteArray& bytes, QString& hash, bool& exists) {
  if (!valid_relative(relative)) return false;
  const auto path = root / relative.toStdWString();
  if (!safe_path(path)) return false;
  std::error_code error;
  const auto status = std::filesystem::symlink_status(path, error);
  if (error == std::errc::no_such_file_or_directory) {
    bytes.clear(); hash.clear(); exists = false; return true;
  }
  if (error || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) return false;
  const auto size = std::filesystem::file_size(path, error);
  if (error || size > static_cast<std::uintmax_t>(kMaxVaultFileBytes)) return false;
  QFile file(qpath(path));
  if (!file.open(QIODevice::ReadOnly)) return false;
  bytes = file.read(kMaxVaultFileBytes + 1);
  if (bytes.size() > kMaxVaultFileBytes || file.error() != QFileDevice::NoError) return false;
  QStringDecoder decoder(QStringDecoder::Utf8);
  decoder.decode(bytes);
  if (decoder.hasError() || bytes.contains('\0')) return false;
  hash = hash_bytes(bytes); exists = true; return true;
}

bool write_target(const std::filesystem::path& root, const QString& relative, const QByteArray& bytes) {
  if (!valid_relative(relative) || bytes.size() > kMaxVaultFileBytes) return false;
  const auto path = root / relative.toStdWString();
  if (!safe_path(path)) return false;
  const auto parent = qpath(path.parent_path());
  if (!QDir().mkpath(parent) || !safe_path(path.parent_path())) return false;
  QSaveFile file(qpath(path));
  file.setDirectWriteFallback(false);
  return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() && file.commit();
}

QString fenced(const QString& text) {
  const auto runs = QRegularExpression(QStringLiteral("`{3,}"));
  int longest = 2;
  auto match = runs.globalMatch(text);
  while (match.hasNext()) longest = qMax(longest, match.next().capturedLength());
  const auto fence = QString(longest + 1, QLatin1Char('`'));
  return fence + QLatin1Char('\n') + text.trimmed() + QLatin1Char('\n') + fence;
}

QString render_log(const std::vector<EvidenceRecord>& records, const QString& operation) {
  if (records.empty()) return {};
  QString output;
  if (records.front().content_id.empty()) return {};
  for (const auto& record : records) {
    if (!record.operation_id.empty()) output += QStringLiteral("\n---\n\n");
    const auto topic = safe_topic(to_utf8(record.content_id));
    output += QStringLiteral("## 学习证据 · %1\n\n| 项目 | 内容 |\n|---|---|\n")
        .arg(topic);
    const auto row = [&](const QString& label, const QString& value) {
      auto cell = value; cell.replace('|', QStringLiteral("\\|"));
      cell.replace(QRegularExpression(QStringLiteral("[\\r\\n]+")), QStringLiteral(" "));
      output += QStringLiteral("| %1 | %2 |\n").arg(label, cell.trimmed());
    };
    row(QStringLiteral("学习日期"), to_utf8(record.at));
    row(QStringLiteral("内容 ID"), to_utf8(record.content_id));
    row(QStringLiteral("练习 ID"), to_utf8(record.exercise_id));
    row(QStringLiteral("运行者"), record.ran_by == codeweave::learning::RanBy::Learner
        ? QStringLiteral("学习者") : record.ran_by == codeweave::learning::RanBy::Assistant
        ? QStringLiteral("AI 助手") : QStringLiteral("未说明"));
    row(QStringLiteral("独立完成"), record.independent ? QStringLiteral("是（学习者声明）") : QStringLiteral("否"));
    row(QStringLiteral("提示等级"), to_utf8(record.hint_level));
    for (const auto& artifact : record.artifact_refs) row(QStringLiteral("证据产物"), to_utf8(artifact));
    output += QLatin1Char('\n');
    if (!record.expected_result.empty()) output += QStringLiteral("**预期结果**\n\n%1\n\n").arg(fenced(to_utf8(record.expected_result)));
    if (!record.actual_result.empty()) output += QStringLiteral("**实际结果**\n\n%1\n\n").arg(fenced(to_utf8(record.actual_result)));
    if (!record.unfinished_items.empty()) {
      output += QStringLiteral("**未完成项**\n\n");
      for (const auto& unfinished : record.unfinished_items) output += QStringLiteral("- %1\n").arg(to_utf8(unfinished));
    }
  }
  output += QStringLiteral("<!-- cw-evidence:%1 -->\n").arg(operation);
  return output;
}

QString merge_progress(QString text, const QString& date, const QString& topic, const QString& log_link) {
  const QRegularExpression latest(QStringLiteral("(最近学习证据\\s*[：:]\\s*)\\d{4}-\\d{2}-\\d{2}"));
  auto match = latest.match(text);
  const bool advances_latest = !match.hasMatch() || match.captured().right(10) <= date;
  if (match.hasMatch() && match.captured().right(10) < date)
    text.replace(match.capturedStart(), match.capturedLength(), match.captured(1) + date);
  const auto update_row = [&](const QString& field, const QString& value) {
    const auto lines = text.split(QLatin1Char('\n'));
    for (qsizetype index = 0; index < lines.size(); ++index) {
      if (!lines[index].trimmed().startsWith(QLatin1Char('|'))) continue;
      const auto cells = lines[index].split(QLatin1Char('|'));
      if (cells.size() < 4 || cells[1].trimmed() != field) continue;
      auto mutable_cells = cells;
      mutable_cells[2] = QStringLiteral(" %1 ").arg(value);
      auto changed = lines; changed[index] = mutable_cells.join(QLatin1Char('|'));
      text = changed.join(QLatin1Char('\n')); return;
    }
  };
  if (advances_latest) {
    update_row(QStringLiteral("最近正式日志"), log_link);
    update_row(QStringLiteral("当前主题"), topic);
  }
  return text;
}

QString insert_index(QString text, const QString& month, const QString& line, bool& supported) {
  if (text.contains(line)) { supported = true; return text; }
  auto lines = text.split(QLatin1Char('\n'));
  const QRegularExpression heading(QStringLiteral("^###\\s+%1\\s*$").arg(QRegularExpression::escape(month)));
  for (qsizetype i = 0; i < lines.size(); ++i) {
    if (heading.match(lines[i].trimmed()).hasMatch()) {
      lines.insert(i + 1, line); supported = true; return lines.join(QLatin1Char('\n'));
    }
  }
  for (qsizetype i = 0; i < lines.size(); ++i) {
    if (!lines[i].startsWith(QStringLiteral("> 每日记录统一存放")) &&
        lines[i].trimmed() != QStringLiteral("## 0. 学习日志索引")) continue;
    lines.insert(i + 1, QString()); lines.insert(i + 2, QStringLiteral("### %1").arg(month));
    lines.insert(i + 3, line); supported = true; return lines.join(QLatin1Char('\n'));
  }
  supported = false; return text;
}

QVariantMap target_view(const Target& target) {
  return {{"path", target.path}, {"kind", target.kind}, {"exists", target.existed},
      {"expectedHash", target.expected_hash.isEmpty() ? QVariant() : QVariant(target.expected_hash)},
      {"preview", target.after}};
}

std::unique_ptr<QLockFile> acquire_lock(const std::filesystem::path& root) {
  const auto path = root / "learning" / "vault-writeback.lock";
  if (!safe_path(path) || !QDir().mkpath(qpath(path.parent_path()))) return {};
  auto lock = std::make_unique<QLockFile>(qpath(path));
  if (!lock->tryLock(0)) return {};
  return lock;
}

QString vault_key(const std::filesystem::path& root) {
  return hash_bytes(QFileInfo(qpath(root)).canonicalFilePath().toUtf8());
}

bool valid_transaction(const QJsonObject& tx, const std::filesystem::path& root,
    const std::filesystem::path& vault, const std::string& account, const QString& operation) {
  if (tx.value("schemaVersion").toInt() != 1 || tx.value("accountId").toString().toStdString() != account ||
      tx.value("operationId").toString() != operation || tx.value("vaultKey").toString() != vault_key(vault) ||
      !valid_operation(operation) || !tx.value("targets").isArray() || !tx.value("evidenceIds").isArray()) return false;
  const auto targets = tx.value("targets").toArray();
  if (targets.size() < 3 || targets.size() > 102) return false;
  QSet<QString> paths;
  for (qsizetype i = 0; i < targets.size(); ++i) {
    const auto target = target_from_json(targets[i].toObject());
    if (!valid_relative(target.path) || paths.contains(target.path) || target.after.toUtf8().size() > kMaxVaultFileBytes) return false;
    paths.insert(target.path);
    const auto expected_kind = i == targets.size() - 1 ? QStringLiteral("index") :
        i == targets.size() - 2 ? QStringLiteral("progress") : QStringLiteral("log");
    if (target.kind != expected_kind || (target.existed && target.expected_hash.size() != 64) ||
        (!target.existed && !target.expected_hash.isEmpty())) return false;
    if (target.kind == "progress" && target.path != QString::fromUtf8(kProgressPath)) return false;
    if (target.kind == "index" && target.path != QString::fromUtf8(kPlanPath)) return false;
    const auto expected_backup = root / "learning" / "writeback" / operation.toStdWString() / L"backups" /
        (QString::number(i).toStdWString() + L".bak");
    if (!target.backup.isEmpty() && target.backup != qpath(expected_backup)) return false;
    if (target.prepared && target.post_hash != hash_bytes(target.after.toUtf8())) return false;
    if (target.applied && !target.prepared) return false;
  }
  return true;
}
}  // namespace

VaultWritebackStore::VaultWritebackStore(std::filesystem::path app_root,
    std::filesystem::path account_root, std::filesystem::path vault_root, std::string account_id)
    : owner_root_(std::move(app_root)), account_root_(std::move(account_root)),
      vault_root_(std::move(vault_root)),
      account_id_(std::move(account_id)) {}

Result VaultWritebackStore::ownerStatus(bool& is_owner) const {
  is_owner = false;
  const auto path = owner_root_ / "learning" / "vault-owner.v1.json";
  if (!safe_path(path)) return Result::failure("资料库绑定记录路径无效");
  QFile file(qpath(path));
  if (!file.exists()) return Result::success("尚未绑定资料库拥有者");
  if (!file.open(QIODevice::ReadOnly) || file.size() > 65536) return Result::failure("资料库绑定记录不可读");
  QJsonParseError error;
  const auto object = QJsonDocument::fromJson(file.readAll(), &error).object();
  if (error.error != QJsonParseError::NoError || object.value("schemaVersion").toInt() != 1)
    return Result::failure("资料库绑定记录损坏，已停止写回");
  if (!object.value("accountId").isString() || object.value("accountId").toString().isEmpty() ||
      !object.value("vaultRoot").isString() || object.value("vaultRoot").toString().isEmpty())
    return Result::failure("资料库绑定字段损坏，已停止写回");
  if (vault_root_.empty() || !safe_path(vault_root_)) return Result::success("请连接原先绑定的资料库");
  is_owner = object.value("accountId").toString().toStdString() == account_id_ &&
      QFileInfo(object.value("vaultRoot").toString()).canonicalFilePath() == QFileInfo(qpath(vault_root_)).canonicalFilePath();
  return Result::success(is_owner ? "当前账户是资料库拥有者" : "资料库未绑定当前账户");
}

Result VaultWritebackStore::bindOwner() {
  const auto lock = acquire_lock(owner_root_);
  if (!lock) return Result::failure("资料库绑定记录正被使用，请稍后重试");
  if (account_id_.empty() || !safe_path(vault_root_)) return Result::failure("账户或资料库路径无效");
  QByteArray bytes; QString hash; bool exists = false;
  if (!read_target(vault_root_, QString::fromUtf8(kProgressPath), bytes, hash, exists) || !exists)
    return Result::failure("未找到受支持的资料库进度追踪文件");
  if (!read_target(vault_root_, QString::fromUtf8(kPlanPath), bytes, hash, exists) || !exists)
    return Result::failure("未找到资料库总计划索引文件");
  const auto path = owner_root_ / "learning" / "vault-owner.v1.json";
  if (!safe_path(path) || !QDir().mkpath(qpath(path.parent_path()))) return Result::failure("无法创建资料库绑定目录");
  bool existing_owner = false;
  const auto status = ownerStatus(existing_owner);
  if (!status.ok) return status;
  QFile current(qpath(path));
  if (current.exists() && !existing_owner) return Result::failure("该设备上的资料库已绑定其他账户");
  QSaveFile file(qpath(path)); file.setDirectWriteFallback(false);
  const auto data = QJsonDocument(QJsonObject{{"schemaVersion", 1},
      {"accountId", QString::fromStdString(account_id_)},
      {"vaultRoot", QFileInfo(qpath(vault_root_)).canonicalFilePath()},
      {"boundAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}}).toJson(QJsonDocument::Indented);
  return file.open(QIODevice::WriteOnly) && file.write(data) == data.size() && file.commit()
      ? Result::success("资料库已绑定当前账户") : Result::failure("资料库绑定保存失败");
}

Result VaultWritebackStore::readProgress(QVariantMap& projection) const {
  projection.clear(); bool owner = false;
  auto result = ownerStatus(owner); if (!result.ok) return result;
  if (!owner) return Result::failure("仅资料库拥有者可查看正式进度");
  QByteArray bytes; QString hash; bool exists = false;
  if (!read_target(vault_root_, QString::fromUtf8(kProgressPath), bytes, hash, exists) || !exists)
    return Result::failure("资料库进度追踪文件不可读");
  const auto parsed = codeweave::learning::parse_progress(std::string_view(bytes.constData(), static_cast<size_t>(bytes.size())));
  projection.insert("status", parsed.status == codeweave::learning::ProgressStatus::Ok ? "ok" :
      parsed.status == codeweave::learning::ProgressStatus::Partial ? "partial" : "structure_unsupported");
  projection.insert("sourcePath", QString::fromUtf8(kProgressPath));
  projection.insert("fileHash", hash);
  projection.insert("latestEvidenceOn", to_utf8(parsed.latest_evidence_on));
  projection.insert("notice", to_utf8(parsed.read_only_notice));
  QVariantList mastery;
  for (const auto& row : parsed.mastery) mastery.push_back(QVariantMap{{"skill", to_utf8(row.skill)},
      {"level", to_utf8(row.level.label)}, {"status", to_utf8(row.status)}, {"evidence", to_utf8(row.evidence)}});
  QVariantList stages;
  for (const auto& row : parsed.stages) stages.push_back(QVariantMap{{"id", to_utf8(row.id)},
      {"name", to_utf8(row.name)}, {"status", to_utf8(row.status)}, {"note", to_utf8(row.note)}});
  projection.insert("mastery", mastery); projection.insert("stages", stages);
  return Result::success("资料库进度已读取");
}

Result VaultWritebackStore::readEvidence(QVariantList& pending, QVariantList& synced) const {
  pending.clear(); synced.clear();
  if (account_id_.empty()) return Result::failure("请先登录账户");
  codeweave::learning::EvidenceStore store(account_root_);
  std::vector<EvidenceRecord> records;
  const auto loaded = store.read_all(records); if (!loaded.ok) return loaded;
  QVariantList ledger;
  bool owner = false;
  const auto status = ownerStatus(owner);
  if (!status.ok) return status;
  if (owner) { const auto listed = transactions(ledger); if (!listed.ok) return listed; }
  QSet<QString> synced_ids, partial_ids;
  for (const auto& value : ledger) {
    const auto tx = value.toMap();
    for (const auto& id : tx.value("evidenceIds").toStringList()) {
      if (tx.value("state") == "synced") synced_ids.insert(id);
      else if (tx.value("state") == "writing" || tx.value("state") == "partial" || tx.value("state") == "rolling_back") partial_ids.insert(id);
    }
  }
  for (const auto& record : records) {
    const auto id = to_utf8(record.evidence_id);
    const bool is_synced = synced_ids.contains(id) || record.state == EvidenceState::Synced;
    const bool is_partial = partial_ids.contains(id) || record.state == EvidenceState::Partial;
    QVariantMap item{{"evidenceId", to_utf8(record.evidence_id)}, {"contentId", to_utf8(record.content_id)},
      {"exerciseId", to_utf8(record.exercise_id)}, {"at", to_utf8(record.at)},
      {"expected", to_utf8(record.expected_result)}, {"actual", to_utf8(record.actual_result)},
      {"independent", record.independent}, {"state", is_synced ? "synced" : is_partial ? "partial" : "pending"}};
    (is_synced ? synced : pending).push_back(std::move(item));
  }
  return Result::success("暂存证据已读取");
}

Result VaultWritebackStore::preview(const QStringList& evidence_ids, QVariantMap& result) {
  const auto lock = acquire_lock(owner_root_);
  if (!lock) return Result::failure("另一个资料库操作正在进行");
  result.clear(); bool owner = false; auto status = ownerStatus(owner);
  if (!status.ok || !owner) return status.ok ? Result::failure("先绑定当前资料库拥有者才能预览写回") : status;
  if (evidence_ids.isEmpty() || evidence_ids.size() > 100) return Result::failure("请选择 1 至 100 条待写回证据");
  if (QSet<QString>(evidence_ids.cbegin(), evidence_ids.cend()).size() != evidence_ids.size()) return Result::failure("不能重复选择同一条证据");
  QVariantList pending, synced;
  const auto queue = readEvidence(pending, synced); if (!queue.ok) return queue;
  for (const auto& id : evidence_ids) {
    const auto found = std::find_if(pending.begin(), pending.end(), [&](const auto& value) { return value.toMap().value("evidenceId") == id; });
    if (found == pending.end() || found->toMap().value("state") == "partial")
      return Result::failure("证据已同步或已有待恢复事务，请先核对事务记录");
  }
  codeweave::learning::EvidenceStore store(account_root_);
  std::vector<EvidenceRecord> all; auto loaded = store.read_all(all); if (!loaded.ok) return loaded;
  std::vector<EvidenceRecord> chosen;
  for (const auto& id : evidence_ids) {
    const auto found = std::find_if(all.begin(), all.end(), [&](const auto& record) { return record.evidence_id == id.toStdString(); });
    if (found == all.end()) return Result::failure("暂存证据不存在或不属于当前账户");
    if (found->state == EvidenceState::Synced) return Result::failure("已同步证据不能重复提交");
    chosen.push_back(*found);
  }
  const auto operation = QStringLiteral("op-%1-%2").arg(QUuid::createUuid().toString(QUuid::Id128).left(12),
      QUuid::createUuid().toString(QUuid::Id128).right(6));
  const auto latest_record = std::max_element(chosen.begin(), chosen.end(), [](const auto& a, const auto& b) {
    return a.at < b.at;
  });
  const auto date = to_utf8(latest_record->at);
  const auto topic = safe_topic(to_utf8(latest_record->content_id));
  QJsonArray targets;
  QVariantList views;
  QJsonArray ids; for (const auto& record : chosen) ids.append(to_utf8(record.evidence_id));

  std::map<std::string, std::vector<EvidenceRecord>> groups;
  for (const auto& record : chosen) groups[record.at + "|" + record.content_id].push_back(record);
  for (const auto& [key, group] : groups) {
    const auto parts = QString::fromStdString(key).split(QLatin1Char('|'));
    const auto relative = QStringLiteral("全栈工程师学习计划/学习日志/%1/%2-%3.md").arg(parts[0].left(7), parts[0], safe_topic(parts.value(1)));
    QByteArray before; QString hash; bool exists = false;
    if (!read_target(vault_root_, relative, before, hash, exists)) return Result::failure("学习日志目标路径无效或不可读");
    QString after = QString::fromUtf8(before);
    if (!exists) after = QStringLiteral("# %1 学习日志 · %2\n\n> 由 CodeWeave 确认式写回创建。\n> 本记录不自动提升掌握等级。\n\n").arg(parts[0], safe_topic(to_utf8(group.front().content_id)));
    if (!after.isEmpty() && !after.endsWith(QLatin1Char('\n'))) after += QLatin1Char('\n');
    after += QStringLiteral("\n---\n\n") + render_log(group, operation);
    Target target{relative, QStringLiteral("log"), hash, after, {}, {}, exists, false, false};
    targets.append(target_json(target)); views.push_back(target_view(target));
  }

  QByteArray progress_bytes; QString progress_hash; bool progress_exists = false;
  if (!read_target(vault_root_, QString::fromUtf8(kProgressPath), progress_bytes, progress_hash, progress_exists) || !progress_exists)
    return Result::failure("进度追踪文件不存在或不可读，预览已停止");
  const auto progress_text = QString::fromUtf8(progress_bytes);
  if (!progress_text.contains(QStringLiteral("最近学习证据")) || !progress_text.contains(QStringLiteral("最近正式日志")) ||
      !progress_text.contains(QStringLiteral("当前主题"))) return Result::failure("进度追踪结构不受支持，未生成写回预览");
  const auto log_path = QStringLiteral("全栈工程师学习计划/学习日志/%1/%2-%3.md")
      .arg(date.left(7), date, topic);
  const auto link = QStringLiteral("[[%1]]").arg(log_path.left(log_path.size() - 3));
  const auto progress_after = merge_progress(progress_text, date, topic, link);
  Target progress{QString::fromUtf8(kProgressPath), QStringLiteral("progress"), progress_hash,
      progress_after, {}, {}, true, false, progress_after == progress_text};
  targets.append(target_json(progress)); views.push_back(target_view(progress));

  QByteArray plan_bytes; QString plan_hash; bool plan_exists = false;
  if (!read_target(vault_root_, QString::fromUtf8(kPlanPath), plan_bytes, plan_hash, plan_exists) || !plan_exists)
    return Result::failure("总计划索引文件不存在或不可读，预览已停止");
  bool supported = false;
  auto plan_after = QString::fromUtf8(plan_bytes);
  for (const auto& [key, group] : groups) {
    const auto at = to_utf8(group.front().at);
    const auto group_topic = safe_topic(to_utf8(group.front().content_id));
    const auto group_link = QStringLiteral("[[全栈工程师学习计划/学习日志/%1/%2-%3]]").arg(at.left(7), at, group_topic);
    plan_after = insert_index(plan_after, at.left(7), QStringLiteral("- %1 — %2").arg(group_link, group_topic), supported);
    if (!supported) return Result::failure("总计划缺少可识别的学习日志索引，未生成写回预览");
  }
  Target index{QString::fromUtf8(kPlanPath), QStringLiteral("index"), plan_hash,
      plan_after, {}, {}, true, false, plan_after == QString::fromUtf8(plan_bytes)};
  targets.append(target_json(index)); views.push_back(target_view(index));

  QJsonObject tx{{"schemaVersion", 1}, {"operationId", operation},
      {"accountId", QString::fromStdString(account_id_)}, {"state", "preview"},
      {"at", date}, {"topic", topic}, {"evidenceIds", ids}, {"targets", targets},
      {"vaultKey", vault_key(vault_root_)}, {"createdAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}};
  const auto tx_path = account_root_ / "learning" / "writeback" / (operation.toStdWString() + L".json");
  if (!safe_path(tx_path) || !QDir().mkpath(qpath(tx_path.parent_path()))) return Result::failure("无法创建写回事务目录");
  QSaveFile tx_file(qpath(tx_path)); tx_file.setDirectWriteFallback(false);
  const auto tx_bytes = QJsonDocument(tx).toJson(QJsonDocument::Compact);
  if (!tx_file.open(QIODevice::WriteOnly) || tx_file.write(tx_bytes) != tx_bytes.size() || !tx_file.commit())
    return Result::failure("写回事务预览保存失败");
  result = {{"operationId", operation}, {"at", date}, {"topic", topic}, {"evidenceIds", evidence_ids},
      {"targets", views}, {"notices", QVariantList{QStringLiteral("预览未修改资料库文件。"),
          QStringLiteral("确认后按学习日志、进度追踪、总计划索引顺序写入。"),
          QStringLiteral("掌握等级不会由证据自动提升。")}}};
  return Result::success("只读写回预览已生成");
}

Result VaultWritebackStore::commit(const QString& operation_id, const QVariantMap& expected_hashes,
    QVariantMap& result) {
  result.clear(); bool owner = false; auto status = ownerStatus(owner);
  if (!status.ok || !owner) return status.ok ? Result::failure("当前账户无权提交该资料库") : status;
  if (!valid_operation(operation_id)) return Result::failure("写回事务 ID 无效");
  const auto lock = acquire_lock(owner_root_); if (!lock) return Result::failure("另一个资料库操作正在进行");
  const auto tx_path = account_root_ / "learning" / "writeback" / (operation_id.toStdWString() + L".json");
  if (!safe_path(tx_path)) return Result::failure("写回事务路径无效");
  QFile file(qpath(tx_path)); if (!file.open(QIODevice::ReadOnly) || file.size() > kMaxTransactionBytes)
    return Result::failure("找不到可提交的写回事务");
  QJsonParseError error; auto tx = QJsonDocument::fromJson(file.readAll(), &error).object();
  file.close();
  if (error.error != QJsonParseError::NoError || !valid_transaction(tx, account_root_, vault_root_, account_id_, operation_id))
    return Result::failure("写回事务损坏或不属于当前账户");
  if (tx.value("state") == "rolled_back" || tx.value("state") == "rolling_back") return Result::failure("回滚中的事务不能提交，请重新预览或继续回滚");
  auto targets = tx.value("targets").toArray();
  // Every retry must prove it came from the same preview, including missing-file baselines.
  for (const auto& value : targets) {
    const auto target = target_from_json(value.toObject());
    if (!expected_hashes.contains(target.path) || expected_hashes.value(target.path).toString() != target.expected_hash)
      return Result::failure("预览指纹缺失或已过期，请重新读取事务");
  }
  if (tx.value("state") == "synced") {
    for (const auto& value : targets) {
      const auto target = target_from_json(value.toObject());
      QByteArray bytes; QString hash; bool exists = false;
      if (!read_target(vault_root_, target.path, bytes, hash, exists) || hash != target.post_hash)
        return Result::failure("已同步文件后来发生变化，请核对资料库与事务记录");
    }
    result = {{"synced", true}, {"idempotent", true}, {"operationId", operation_id}};
    return Result::success("本次写回此前已完成");
  }
  for (const auto& value : targets) {
    const auto target = target_from_json(value.toObject());
    QByteArray bytes; QString hash; bool exists = false;
    if (!read_target(vault_root_, target.path, bytes, hash, exists)) return Result::failure("目标文件不可读，未写入任何内容");
    if (hash != target.expected_hash && !(target.prepared && hash == target.post_hash))
      return Result::failure(QStringLiteral("写回冲突：%1 已在预览后发生变化").arg(target.path).toStdString());
  }
  tx["state"] = "writing";
  const auto persist = [&]() {
    QSaveFile save(qpath(tx_path)); save.setDirectWriteFallback(false);
    const auto bytes = QJsonDocument(tx).toJson(QJsonDocument::Compact);
    return save.open(QIODevice::WriteOnly) && save.write(bytes) == bytes.size() && save.commit();
  };
  if (!persist()) return Result::failure("写回事务状态无法保存，尚未写入资料库");
  const auto backup_dir = account_root_ / "learning" / "writeback" / operation_id.toStdWString() / L"backups";
  QVariantList applied;
  for (qsizetype index = 0; index < targets.size(); ++index) {
    auto target = target_from_json(targets[index].toObject());
      QByteArray current; QString current_hash; bool exists = false;
      if (!read_target(vault_root_, target.path, current, current_hash, exists) ||
          (current_hash != target.expected_hash && !(target.prepared && current_hash == target.post_hash))) {
        tx["state"] = applied.isEmpty() ? "failed" : "partial"; tx["targets"] = targets; persist();
        return Result::failure(QStringLiteral("写入前发现第三方修改，已停止：%1").arg(target.path).toStdString());
      }
      const bool already_applied = target.prepared && current_hash == target.post_hash;
      if (exists && !target.prepared) {
        const auto backup = backup_dir / (QString::number(index).toStdWString() + L".bak");
        if (!safe_path(backup) || !QDir().mkpath(qpath(backup.parent_path()))) return Result::failure("无法建立写回前备份");
        QSaveFile backup_file(qpath(backup));
        if (!backup_file.open(QIODevice::WriteOnly) || backup_file.write(current) != current.size() || !backup_file.commit())
          return Result::failure("写回前备份失败，资料库未修改");
        target.backup = qpath(backup);
      }
      const auto desired = target.after.toUtf8();
      target.prepared = true; target.post_hash = hash_bytes(desired);
      targets[index] = target_json(target); tx["targets"] = targets;
      // Persist recovery data before replacing a vault file. A crash after the
      // replacement is recovered by comparing the recorded pre/post hashes.
      if (!persist()) return Result::failure("写回事务恢复记录保存失败，已停止写入");
      if (!already_applied && !target.skipped && !write_target(vault_root_, target.path, desired)) {
        tx["state"] = applied.isEmpty() ? "failed" : "partial"; tx["targets"] = targets; persist();
        return Result::failure(QStringLiteral("写入失败，已保留已完成步骤与备份：%1").arg(target.path).toStdString());
      }
      target.applied = true;
    targets[index] = target_json(target); applied.push_back(QVariantMap{{"path", target.path}, {"kind", target.kind}, {"applied", target.applied}});
    tx["targets"] = targets;
    if (!persist()) { tx["state"] = "partial"; return Result::failure("写回事务记录更新失败，需从事务列表恢复核对"); }
  }
  tx["state"] = "synced"; tx["syncedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
  if (!persist()) return Result::failure("资料库已写入，但事务完成状态未保存；请检查事务列表");
  result = {{"synced", true}, {"idempotent", false}, {"operationId", operation_id}, {"targets", applied}};
  return Result::success("学习日志、进度追踪与索引已写入");
}

Result VaultWritebackStore::rollback(const QString& operation_id, QVariantMap& result) {
  result.clear(); bool owner = false; auto status = ownerStatus(owner);
  if (!status.ok || !owner) return status.ok ? Result::failure("当前账户无权回滚该资料库") : status;
  if (!valid_operation(operation_id)) return Result::failure("写回事务 ID 无效");
  const auto lock = acquire_lock(owner_root_); if (!lock) return Result::failure("另一个资料库操作正在进行");
  const auto tx_path = account_root_ / "learning" / "writeback" / (operation_id.toStdWString() + L".json");
  if (!safe_path(tx_path)) return Result::failure("写回事务路径无效");
  QFile file(qpath(tx_path)); if (!file.open(QIODevice::ReadOnly) || file.size() > kMaxTransactionBytes) return Result::failure("事务不可读");
  QJsonParseError error; auto tx = QJsonDocument::fromJson(file.readAll(), &error).object();
  file.close();
  if (error.error != QJsonParseError::NoError || !valid_transaction(tx, account_root_, vault_root_, account_id_, operation_id))
    return Result::failure("事务损坏或账户不匹配");
  if (tx.value("state") == "rolled_back") { result.insert("idempotent", true); return Result::success("事务此前已回滚"); }
  auto targets = tx.value("targets").toArray();
  const auto persist = [&] {
    QSaveFile save(qpath(tx_path)); save.setDirectWriteFallback(false);
    const auto bytes = QJsonDocument(tx).toJson(QJsonDocument::Compact);
    return save.open(QIODevice::WriteOnly) && save.write(bytes) == bytes.size() && save.commit();
  };
  for (const auto& value : targets) {
    const auto target = target_from_json(value.toObject()); if (!target.prepared || target.skipped) continue;
    QByteArray current; QString hash; bool exists = false;
    if (!read_target(vault_root_, target.path, current, hash, exists) ||
        (hash != target.post_hash && !((tx.value("state") == "rolling_back" || !target.applied) && hash == target.expected_hash)))
      return Result::failure(QStringLiteral("检测到第三方修改，拒绝覆盖并停止回滚：%1").arg(target.path).toStdString());
    if (target.existed && (target.backup.isEmpty() || !safe_path(std::filesystem::path(target.backup.toStdWString())) || !QFileInfo::exists(target.backup)))
      return Result::failure(QStringLiteral("缺少原文件备份，拒绝回滚：%1").arg(target.path).toStdString());
    if (target.existed) {
      QFile backup(target.backup);
      if (!backup.open(QIODevice::ReadOnly) || backup.size() > kMaxVaultFileBytes || hash_bytes(backup.readAll()) != target.expected_hash)
        return Result::failure("回滚备份损坏，禁止覆盖资料库");
    }
  }
  tx["state"] = "rolling_back";
  if (!persist()) return Result::failure("回滚恢复记录保存失败，未修改资料库");
  QVariantList restored;
  for (qsizetype i = targets.size(); i > 0; --i) {
    auto target = target_from_json(targets[i - 1].toObject()); if (!target.prepared || target.skipped || target.restored) continue;
    QByteArray current; QString hash; bool exists = false;
    if (!read_target(vault_root_, target.path, current, hash, exists) || (hash != target.post_hash && hash != target.expected_hash))
      return Result::failure("回滚前检测到第三方修改，已停止");
    if (hash == target.expected_hash) { target.restored = true; }
    else {
    if (target.existed) {
      QFile backup(target.backup); if (!backup.open(QIODevice::ReadOnly)) return Result::failure("回滚备份不可读");
      if (!write_target(vault_root_, target.path, backup.readAll())) return Result::failure("原文件恢复失败，事务保持部分回滚状态");
      restored.push_back(QVariantMap{{"path", target.path}, {"action", "restored"}});
    } else {
      const auto path = vault_root_ / target.path.toStdWString();
      if (!safe_path(path)) return Result::failure("新建文件路径无效，回滚停止");
      std::error_code remove_error; std::filesystem::remove(path, remove_error);
      if (remove_error) return Result::failure("移除本次新建文件失败");
      restored.push_back(QVariantMap{{"path", target.path}, {"action", "removed"}});
    }
    target.restored = true;
    }
    targets[i - 1] = target_json(target); tx["targets"] = targets;
    if (!persist()) return Result::failure("回滚步骤已完成，事务状态保存失败；请继续回滚");
  }
  tx["state"] = "rolled_back"; tx["rolledBackAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
  QSaveFile save(qpath(tx_path)); save.setDirectWriteFallback(false); const auto bytes = QJsonDocument(tx).toJson(QJsonDocument::Compact);
  if (!save.open(QIODevice::WriteOnly) || save.write(bytes) != bytes.size() || !save.commit()) return Result::failure("已恢复资料库文件，但回滚状态未保存");
  result = {{"rolledBack", true}, {"idempotent", false}, {"operationId", operation_id}, {"targets", restored}};
  return Result::success("资料库文件已按备份回滚");
}

Result VaultWritebackStore::transactions(QVariantList& result) const {
  result.clear(); bool owner = false; auto status = ownerStatus(owner);
  if (!status.ok || !owner) return status.ok ? Result::failure("仅资料库拥有者可查看写回事务") : status;
  const auto directory = account_root_ / "learning" / "writeback";
  std::error_code error;
  if (!std::filesystem::exists(directory, error)) return Result::success("尚无写回事务");
  if (error || !safe_path(directory)) return Result::failure("写回事务目录不可读");
  for (const auto& entry : std::filesystem::directory_iterator(directory, error)) {
    if (error) return Result::failure("写回事务目录枚举失败");
    if (!entry.is_regular_file() || entry.path().extension() != ".json") continue;
    QFile file(qpath(entry.path()));
    if (!file.open(QIODevice::ReadOnly) || file.size() > kMaxTransactionBytes) return Result::failure("有写回事务不可读，未将其冒充为空记录");
    QJsonParseError parse_error; const auto tx = QJsonDocument::fromJson(file.readAll(), &parse_error).object();
    if (parse_error.error != QJsonParseError::NoError ||
        !valid_transaction(tx, account_root_, vault_root_, account_id_, tx.value("operationId").toString()))
      return Result::failure("有损坏的写回事务记录，已停止汇总");
    if (tx.value("accountId").toString().toStdString() != account_id_) continue;
    result.push_back(QVariantMap{{"operationId", tx.value("operationId").toString()},
        {"state", tx.value("state").toString()}, {"at", tx.value("at").toString()},
        {"topic", tx.value("topic").toString()}, {"createdAt", tx.value("createdAt").toString()},
        {"evidenceIds", tx.value("evidenceIds").toVariant().toStringList()},
        {"targets", [&] {
          QVariantList list; for (const auto& value : tx.value("targets").toArray()) {
            const auto step = value.toObject();
            list.push_back(QVariantMap{{"path", step.value("path").toString()}, {"kind", step.value("kind").toString()},
                {"expectedHash", step.value("expectedHash").toString()}, {"applied", step.value("applied").toBool()},
                {"prepared", step.value("prepared").toBool()}, {"restored", step.value("restored").toBool()}});
          } return list;
        }()}, {"evidenceCount", tx.value("evidenceIds").toArray().size()}});
  }
  std::sort(result.begin(), result.end(), [](const QVariant& left, const QVariant& right) {
    return left.toMap().value("createdAt").toString() > right.toMap().value("createdAt").toString();
  });
  return Result::success("写回事务已读取");
}
