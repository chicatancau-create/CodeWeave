#include "vault_writeback_store.hpp"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLockFile>
#include <QTemporaryDir>

#include <cassert>
#include <iostream>

namespace {
const auto progress_path = QStringLiteral("全栈工程师学习计划/进度追踪.md");
const auto index_path = QStringLiteral("全栈工程师学习计划/全栈竞赛长期冲刺总计划.md");

void write_file(const QString& path, const QByteArray& bytes) {
  assert(QDir().mkpath(QFileInfo(path).absolutePath()));
  QFile file(path);
  assert(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
  assert(file.write(bytes) == bytes.size());
}

QByteArray read_file(const QString& path) {
  QFile file(path); assert(file.open(QIODevice::ReadOnly)); return file.readAll();
}

QVariantMap hashes(const QVariantMap& preview) {
  QVariantMap result;
  for (const auto& value : preview.value("targets").toList()) {
    const auto item = value.toMap(); result[item.value("path").toString()] = item.value("expectedHash");
  }
  return result;
}

struct Fixture {
  QTemporaryDir directory;
  QString root = directory.path();
  QString owner = QDir(root).filePath("owner");
  QString account = QDir(root).filePath("account-a");
  QString vault = QDir(root).filePath("vault");
  QByteArray progress = QStringLiteral("# 进度追踪\r\n\r\n最近学习证据：2026-10-01\r\n"
      "\r\n| 字段 | 内容 |\r\n|---|---|\r\n| 最近正式日志 | 旧日志 |\r\n| 当前主题 | 旧主题 |\r\n"
      "\r\n## 掌握矩阵\r\n| 技能 | 等级 | 状态 | 最新证据 |\r\n|---|---|---|---|\r\n| C++ | 0—1 级 | 待复核 | 无 |\r\n").toUtf8();
  QByteArray index = QStringLiteral("# 长期计划\n\n## 0. 学习日志索引\n\n> 每日记录统一存放在学习日志\n\n## 1. 原文保留\n用户原文\n").toUtf8();
  Fixture() {
    assert(directory.isValid());
    write_file(QDir(vault).filePath(progress_path), progress);
    write_file(QDir(vault).filePath(index_path), index);
  }
  VaultWritebackStore store(const std::string& id = "account-a") {
    return {owner.toStdWString(), account.toStdWString(), vault.toStdWString(), id};
  }
  void evidence(const std::string& id = "first", const std::string& day = "2026-11-08",
      const std::string& content = "lesson-a") {
    using namespace codeweave::learning;
    EvidenceStore ledger(account.toStdWString());
    EvidenceRecord record{id, content, "exercise-a", day, "15", "15\n````\nnot an HTML preview",
        RanBy::Learner, false, "L1", {"fixture.log"}, {"await manual review"}, EvidenceState::Pending,
        "op-fixture" + id + "-abcdef"};
    bool duplicate = false; assert(ledger.append_idempotent(record, duplicate).ok);
  }
};

void test_confirm_commit_and_rollback() {
  Fixture fixture; auto store = fixture.store();
  bool owner = true; assert(store.ownerStatus(owner).ok && !owner);
  QVariantMap projection, preview, result;
  assert(!store.readProgress(projection).ok);
  fixture.evidence();
  assert(!store.preview({"first"}, preview).ok);
  assert(store.bindOwner().ok && store.ownerStatus(owner).ok && owner);
  assert(store.readProgress(projection).ok && !projection.isEmpty());
  assert(!fixture.store("account-b").bindOwner().ok);
  assert(!fixture.store("account-b").readProgress(projection).ok);
  assert(!store.preview({"missing"}, preview).ok);
  assert(!store.preview({"first", "first"}, preview).ok);
  assert(store.preview({"first"}, preview).ok);
  assert(read_file(QDir(fixture.vault).filePath(progress_path)) == fixture.progress);
  assert(read_file(QDir(fixture.vault).filePath(index_path)) == fixture.index);
  const auto operation = preview.value("operationId").toString();
  const auto log = QDir(fixture.vault).filePath(preview.value("targets").toList().first().toMap().value("path").toString());
  assert(!QFile::exists(log));
  assert(!store.commit(operation, {}, result).ok && !QFile::exists(log));
  assert(!store.commit("../outside", hashes(preview), result).ok);
  const auto committed = store.commit(operation, hashes(preview), result);
  if (!committed.ok) std::cerr << "commit failed: " << committed.message << '\n';
  assert(committed.ok && result.value("synced").toBool());
  const auto written = read_file(log);
  assert(written.contains("fixture.log") && written.contains("await manual review"));
  assert(written.contains("`````"));
  write_file(log, written + "third-party edit\n");
  const auto modified = read_file(log);
  assert(!store.commit(operation, hashes(preview), result).ok && read_file(log) == modified);
  write_file(log, written);
  assert(store.commit(operation, hashes(preview), result).ok && result.value("idempotent").toBool());
  assert(read_file(log) == written);
  QVariantList pending, synced;
  assert(store.readEvidence(pending, synced).ok && pending.isEmpty() && synced.size() == 1);
  assert(!store.preview({"first"}, result).ok);
  assert(read_file(QDir(fixture.vault).filePath(progress_path)).contains(QStringLiteral("0—1 级").toUtf8()));
  assert(store.rollback(operation, result).ok);
  assert(!QFile::exists(log));
  assert(read_file(QDir(fixture.vault).filePath(progress_path)) == fixture.progress);
  assert(read_file(QDir(fixture.vault).filePath(index_path)) == fixture.index);
  assert(store.readEvidence(pending, synced).ok && pending.size() == 1 && synced.isEmpty());
  assert(store.rollback(operation, result).ok && result.value("idempotent").toBool());
  assert(!store.commit(operation, hashes(preview), result).ok);
}

void test_conflicts_corruption_and_cross_account() {
  Fixture fixture; auto store = fixture.store(); fixture.evidence();
  assert(store.bindOwner().ok);
  QVariantMap preview, result; assert(store.preview({"first"}, preview).ok);
  const auto operation = preview.value("operationId").toString();
  const auto path = QDir(fixture.vault).filePath(progress_path);
  write_file(path, fixture.progress + "third-party edit\n");
  assert(!store.commit(operation, hashes(preview), result).ok);
  assert(read_file(QDir(fixture.vault).filePath(index_path)) == fixture.index);
  write_file(path, fixture.progress);
  assert(store.commit(operation, hashes(preview), result).ok);
  write_file(path, read_file(path) + "third-party edit\n");
  const auto modified = read_file(path);
  assert(!store.rollback(operation, result).ok && read_file(path) == modified);
  assert(!fixture.store("other-account").commit(operation, hashes(preview), result).ok);
  const auto tx_path = QDir(fixture.account).filePath("learning/writeback/" + operation + ".json");
  auto tx = QJsonDocument::fromJson(read_file(tx_path)).object();
  auto targets = tx.value("targets").toArray(); auto first = targets[0].toObject();
  first["path"] = "../../outside.md"; targets[0] = first; tx["targets"] = targets;
  write_file(tx_path, QJsonDocument(tx).toJson());
  assert(!store.commit(operation, hashes(preview), result).ok);
  QVariantList ledger;
  assert(!store.transactions(ledger).ok);
  write_file(tx_path, "broken"); assert(!store.transactions(ledger).ok);
  const auto owner_path = QDir(fixture.owner).filePath("learning/vault-owner.v1.json");
  write_file(owner_path, "broken"); assert(!store.bindOwner().ok);
  assert(read_file(owner_path) == "broken");
}

void test_multi_group_recovery_and_lock() {
  Fixture fixture; auto store = fixture.store(); fixture.evidence(); fixture.evidence("second", "2026-11-07", "lesson-b");
  assert(store.bindOwner().ok);
  QVariantMap preview, result; assert(store.preview({"first", "second"}, preview).ok);
  const auto operation = preview.value("operationId").toString();
  const auto targets = preview.value("targets").toList(); assert(targets.size() == 4);
  QLockFile lock(QDir(fixture.owner).filePath("learning/vault-writeback.lock")); assert(lock.tryLock(0));
  assert(!store.commit(operation, hashes(preview), result).ok); lock.unlock();
  // Simulate a crash after the first replacement but before its applied flag was saved.
  const auto tx_path = QDir(fixture.account).filePath("learning/writeback/" + operation + ".json");
  auto tx = QJsonDocument::fromJson(read_file(tx_path)).object();
  auto steps = tx.value("targets").toArray(); auto first = steps[0].toObject();
  const auto after = first.value("after").toString().toUtf8();
  first["prepared"] = true;
  first["postHash"] = QString::fromLatin1(QCryptographicHash::hash(after, QCryptographicHash::Sha256).toHex());
  steps[0] = first; tx["targets"] = steps; tx["state"] = "writing";
  write_file(tx_path, QJsonDocument(tx).toJson());
  write_file(QDir(fixture.vault).filePath(first.value("path").toString()), after);
  auto recovered = fixture.store();
  assert(recovered.commit(operation, hashes(preview), result).ok);
  assert(read_file(QDir(fixture.vault).filePath(first.value("path").toString())) == after);
  const auto index = read_file(QDir(fixture.vault).filePath(index_path));
  assert(index.contains("2026-11-08-lesson-a") && index.contains("2026-11-07-lesson-b"));
  assert(recovered.rollback(operation, result).ok);
  assert(read_file(QDir(fixture.vault).filePath(index_path)) == fixture.index);
}

void test_latest_progress_and_older_append() {
  Fixture fixture; auto store = fixture.store();
  fixture.evidence("older", "2026-11-07", "lesson-old");
  fixture.evidence("newer", "2026-11-08", "lesson-new");
  assert(store.bindOwner().ok);
  QVariantMap preview, result;
  assert(store.preview({"older", "newer"}, preview).ok);
  assert(store.commit(preview.value("operationId").toString(), hashes(preview), result).ok);
  const auto old_log = QDir(fixture.vault).filePath(
      QStringLiteral("全栈工程师学习计划/学习日志/2026-11/2026-11-07-lesson-old.md"));
  assert(read_file(old_log).startsWith(QStringLiteral("# 2026-11-07 学习日志 · lesson-old\n").toUtf8()));
  const auto new_log = QDir(fixture.vault).filePath(
      QStringLiteral("全栈工程师学习计划/学习日志/2026-11/2026-11-08-lesson-new.md"));
  assert(read_file(new_log).startsWith(QStringLiteral("# 2026-11-08 学习日志 · lesson-new\n").toUtf8()));
  const auto progress = read_file(QDir(fixture.vault).filePath(progress_path));
  assert(progress.contains("2026-11-08-lesson-new"));
  assert(progress.contains("| lesson-new |"));
  assert(progress.contains("2026-11-08"));

  fixture.evidence("backfill", "2026-11-06", "lesson-earlier");
  assert(store.preview({"backfill"}, preview).ok);
  assert(store.commit(preview.value("operationId").toString(), hashes(preview), result).ok);
  assert(read_file(QDir(fixture.vault).filePath(progress_path)) == progress);
  assert(read_file(QDir(fixture.vault).filePath(index_path)).contains("2026-11-06-lesson-earlier"));

  const auto old_bytes = read_file(old_log);
  fixture.evidence("append", "2026-11-07", "lesson-old");
  assert(store.preview({"append"}, preview).ok);
  assert(store.commit(preview.value("operationId").toString(), hashes(preview), result).ok);
  assert(read_file(old_log).startsWith(old_bytes));
  assert(read_file(QDir(fixture.vault).filePath(progress_path)) == progress);
  assert(store.rollback(preview.value("operationId").toString(), result).ok);
  assert(read_file(old_log) == old_bytes);
}
}  // namespace

int main(int argc, char** argv) {
  QCoreApplication app(argc, argv);
  test_confirm_commit_and_rollback();
  test_conflicts_corruption_and_cross_account();
  test_multi_group_recovery_and_lock();
  test_latest_progress_and_older_append();
  std::cout << "Vault writeback: confirmation, hash conflicts, account boundaries, recovery and rollback passed\n";
}
