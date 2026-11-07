#include "ui_shell.hpp"
#include "evidence_store.hpp"
#include "challenge_runtime.hpp"
#include "challenge_submission_store.hpp"
#include "checkin_store.hpp"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QElapsedTimer>
#include <QDate>
#include <QDateTime>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLockFile>
#include <QTemporaryDir>
#include <QThread>
#include <QTimer>

#include <cassert>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>

namespace {
template<class Predicate> void wait_for(Predicate ready) {
  QElapsedTimer timer;
  timer.start();
  do {
    QCoreApplication::processEvents();
    if (ready()) return;
    QThread::msleep(1);
  } while (timer.elapsed() < 10000);
  assert(false && "asynchronous facade timeout");
}

std::filesystem::path draft_path(const std::filesystem::path& root, const QString& document) {
  return root / "drafts" / ("lesson-" + QCryptographicHash::hash(
      document.toUtf8(), QCryptographicHash::Sha256).toHex().toStdString() + ".txt");
}

std::string read_file(const std::filesystem::path& path) {
  std::ifstream file(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}

void test_challenge_submission_store() {
  QTemporaryDir temporary;
  assert(temporary.isValid());
  const auto root = temporary.path();
  const ChallengeSubmissionStore store(root);
  QVariantList records;
  assert(store.read(records).ok && records.isEmpty());
  const QVariantMap record{
      {"id", "submission-0123456789abcdef0123456789abcdef"}, {"challengeId", "stage-b"},
      {"submittedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
      {"status", "passed"}, {"tier", "teaching"}, {"judgeMode", "exact-lines"},
      {"evidence", "Immutable evidence snapshot"}, {"code", "print(15)"},
      {"expected", QVariantList{QStringLiteral("15")}}, {"output", QVariantList{QStringLiteral("15")}},
      {"observation", ""}, {"reviewedAt", ""}};
  assert(store.append(record, records).ok && records.size() == 1);
  const auto new_account_root = QDir(root).filePath("new-account");
  assert(!QDir(new_account_root).exists());
  QVariantList first_submission;
  assert(ChallengeSubmissionStore(new_account_root).append(record, first_submission).ok);
  assert(first_submission.size() == 1 && QDir(new_account_root).exists());
  assert(store.append(record, records).ok && records.size() == 1);
  auto conflict = record;
  conflict["evidence"] = "Different evidence";
  assert(!store.append(conflict, records).ok);
  assert(!store.review(record.value("id").toString(), false, {}, records).ok);
  auto external = record;
  external["id"] = "submission-1123456789abcdef0123456789abcdef";
  external["challengeId"] = "stage-a";
  external["status"] = "submitted";
  external["tier"] = "external";
  external["judgeMode"] = "";
  external["code"] = "";
  external["output"] = QVariantList{};
  assert(store.append(external, records).ok && records.size() == 2);
  const auto id = external.value("id").toString();
  assert(!store.review(id, true, "invented-observation", records).ok);
  assert(!store.review("missing-submission", true, {}, records).ok);
  assert(store.review(id, true, "completed", records).ok);
  const auto reviewed = records.last().toMap();
  assert(reviewed.value("status") == "verified" && reviewed.value("observation") == "completed");
  assert(reviewed.value("evidence") == external.value("evidence") &&
      reviewed.value("submittedAt") == external.value("submittedAt"));
  assert(!store.review(id, false, {}, records).ok);
  const ChallengeSubmissionStore reopened(root);
  assert(reopened.read(records).ok && records.last().toMap() == reviewed);
  external["id"] = "submission-2123456789abcdef0123456789abcdef";
  assert(store.append(external, records).ok && records.size() == 3);
  assert(store.review(external.value("id").toString(), false, "attempted", records).ok);
  assert(records.last().toMap().value("status") == "rejected");
  // A different account's empty directory cannot see this account's history.
  QTemporaryDir other_account;
  QVariantList other;
  assert(ChallengeSubmissionStore(other_account.path()).read(other).ok && other.isEmpty());
  const auto file_path = QDir(root).filePath("learning/challenge-submissions.v1.json");
  QLockFile lock(file_path + ".lock");
  assert(lock.tryLock(0));
  assert(!store.append(record, records).ok);
  lock.unlock();
  QFile file(file_path);
  assert(file.open(QIODevice::ReadOnly));
  const auto original = file.readAll();
  file.close();
  assert(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
  assert(file.write("broken-json") == 11);
  file.close();
  assert(!store.read(records).ok && !store.append(record, records).ok);
  assert(file.open(QIODevice::ReadOnly) && file.readAll() == "broken-json");
  file.close();
  assert(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
  assert(file.write(original) == original.size());
  file.close();
  auto bad = record;
  bad["status"] = "verified";
  assert(!store.append(bad, records).ok);
  bad = record; bad["output"] = QVariantList{QStringLiteral("150")};
  assert(!store.append(bad, records).ok);
  bad = record; bad["code"] = QString(65537, 'x');
  assert(!store.append(bad, records).ok);
  bad = record; bad["challengeId"] = "../outside";
  assert(!store.append(bad, records).ok);
  QTemporaryDir blocked;
  const auto blocked_root = std::filesystem::path(blocked.path().toStdWString());
  std::ofstream(blocked_root / "learning") << "not a directory";
  assert(!ChallengeSubmissionStore(blocked.path()).append(record, records).ok);
  assert(read_file(blocked_root / "learning") == "not a directory");
}
void test_checkin_store() {
  QTemporaryDir temporary;
  assert(temporary.isValid());
  const auto root = QDir(temporary.path()).filePath("account-a");
  const CheckinStore store(root);
  QStringList dates;
  assert(store.read(dates).ok && dates.isEmpty());
  assert(!QDir(root).exists());
  const QDate today(2028, 3, 1);
  assert(!store.checkIn(QDate{}, dates).ok);
  assert(store.checkIn(today.addDays(-2), dates).ok);
  assert(store.checkIn(today.addDays(-1), dates).ok);
  assert(CheckinStore::streak(dates, today) == 2);
  assert(store.checkIn(today, dates).ok && dates.size() == 3);
  assert(CheckinStore::streak(dates, today) == 3);
  assert(CheckinStore::streak(dates, today.addDays(1)) == 3);
  assert(CheckinStore::streak(dates, today.addDays(2)) == 0);
  const auto path = QDir(root).filePath("learning/checkin.v1.json");
  auto read_bytes = [&] {
    QFile file(path);
    assert(file.open(QIODevice::ReadOnly));
    return file.readAll();
  };
  const auto original = read_bytes();
  QFile file(path);
  const auto modified = QFileInfo(path).lastModified();
  assert(store.checkIn(today, dates).ok && dates.size() == 3);
  assert(read_bytes() == original && QFileInfo(path).lastModified() == modified);
  dates.clear();
  assert(CheckinStore(root).read(dates).ok && dates.size() == 3);
  assert(CheckinStore(QDir(temporary.path()).filePath("account-b")).read(dates).ok && dates.isEmpty());
  QLockFile lock(path + ".lock");
  assert(lock.tryLock(0));
  assert(!store.checkIn(today.addDays(1), dates).ok && read_bytes() == original);
  lock.unlock();
  for (const auto& bytes : {QByteArray("broken-json"), QByteArray("{\"schemaVersion\":2,\"dates\":[]}"),
                          QByteArray("{\"schemaVersion\":1,\"dates\":[\"2028-02-30\"]}"),
                          QByteArray("{\"schemaVersion\":1,\"dates\":[true]}"),
                          QByteArray("{\"schemaVersion\":1,\"dates\":null}")}) {
    assert(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
    assert(file.write(bytes) == bytes.size());
    file.close();
    assert(!store.read(dates).ok && !store.checkIn(today, dates).ok);
    assert(read_bytes() == bytes);
  }
  const QByteArray duplicate("{\"schemaVersion\":1,\"dates\":[\"2028-02-29\",\"2028-02-29\"]}");
  assert(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
  assert(file.write(duplicate) == duplicate.size());
  file.close();
  assert(store.read(dates).ok && dates.size() == 1);
  assert(store.checkIn(today, dates).ok && dates.size() == 2);
  QTemporaryDir blocked;
  std::ofstream(std::filesystem::path(blocked.path().toStdWString()) / "learning") << "not a directory";
  assert(!CheckinStore(blocked.path()).checkIn(today, dates).ok);
  assert(!CheckinStore("relative-account").read(dates).ok);
  assert(CheckinStore::streak({}, today) == 0);
}
}  // namespace

struct UiShellTestAccess {
  static void set_today(UiShell& shell, const QDate& date) {
    shell.local_date_ = [date] { return date; };
    shell.refreshLocalDay();
  }
  static bool block_worker(UiShell& shell, std::mutex& mutex,
      std::condition_variable& condition, bool& started, bool& release) {
    codeweave::backend::TaskRequest request;
    request.task_id = "qt-test-block-worker";
    request.kind = codeweave::backend::TaskKind::Read;
    request.work = [&mutex, &condition, &started, &release](const auto&) {
      std::unique_lock lock(mutex);
      started = true;
      condition.notify_all();
      condition.wait(lock, [&] { return release; });
      return codeweave::app::Result::success("test blocker released");
    };
    return shell.backend_tasks_.submit(std::move(request), {}).ok;
  }
};

int main(int argc, char** argv) {
  QCoreApplication application(argc, argv);
  if (argc == 2 && std::string_view(argv[1]) == "--challenge-worker") return challenge_worker_main();
  assert(argc == 6);
  test_challenge_submission_store();
  test_checkin_store();
  QTemporaryDir temporary;
  assert(temporary.isValid());
  const auto workspace = std::filesystem::path(temporary.path().toStdWString()) / L"中文工作区";
  const auto data = workspace / L"隔离数据";
  std::filesystem::create_directories(workspace / "config");
  std::ofstream(workspace / "config/codeweave.config.example.json") << "{}";
  std::ofstream(workspace / "progress.md")
      << "结构维护：2026-10-04；最近学习证据：2026-10-03\n"
      << "## 1. 当前状态\n\n| 项目 | 当前值 | 证据 |\n| --- | --- | --- |\n"
      << "| 当前阶段 | A2 | fixture |\n"
      << "## 3. 掌握程度\n\n| 技能 | 等级 | 状态 | 最新证据 |\n| --- | --- | --- | --- |\n"
      << "| C++ | 0—1 级 | 进行中 | test |\n"
      << "## 7. 阶段状态\n\n| 阶段 | 名称 | 状态 | 说明 |\n| --- | --- | --- | --- |\n"
      << "| S2 | 原生重构 | 进行中 | contract |\n";
  codeweave::account::AccountStore store(data);
  codeweave::account::AccountService first(store), second(store), unauthenticated(store);
  assert(first.register_account("Fixture A", "a@example.test", "Test-Password-123!").ok);
  assert(second.register_account("Fixture B", "b@example.test", "Test-Password-123!").ok);
  std::filesystem::path first_root, second_root;
  assert(first.learning_data_root(data, first_root).ok);
  assert(second.learning_data_root(data, second_root).ok);
  QString saved_document;
  {
    QTemporaryDir checkin_temporary;
    assert(checkin_temporary.isValid());
    const auto checkin_workspace = std::filesystem::path(checkin_temporary.path().toStdWString());
    const auto checkin_data = checkin_workspace / "checkin-data";
    codeweave::account::AccountStore checkin_accounts(checkin_data);
    codeweave::account::AccountService checkin_a(checkin_accounts), checkin_b(checkin_accounts);
    assert(checkin_a.register_account("Checkin A", "checkin-a@example.test", "Test-Password-123!").ok);
    assert(checkin_b.register_account("Checkin B", "checkin-b@example.test", "Test-Password-123!").ok);
    std::filesystem::path checkin_root;
    assert(checkin_a.learning_data_root(checkin_data, checkin_root).ok);
    UiShell shell;
    UiShellTestAccess::set_today(shell, QDate(2028, 2, 29));
    shell.checkIn();
    assert(!shell.checkinSummary().value("ready").toBool());
    assert(shell.setAccountContext(checkin_a, checkin_workspace, checkin_data));
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(shell.checkinSummary().value("ready").toBool());
    assert(!shell.checkinSummary().value("checkedIn").toBool());
    shell.checkIn();
    shell.checkIn();
    assert(!shell.clearAccountContext());
    assert(!shell.requestClose());
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(shell.checkinSummary().value("checkedIn").toBool());
    assert(shell.checkinSummary().value("streakDays").toInt() == 1);
    shell.checkIn();
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(shell.checkinSummary().value("totalDays").toInt() == 1);
    UiShellTestAccess::set_today(shell, QDate(2028, 3, 1));
    assert(!shell.checkinSummary().value("checkedIn").toBool());
    assert(shell.checkinSummary().value("streakDays").toInt() == 1);
    shell.checkIn();
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(shell.checkinSummary().value("streakDays").toInt() == 2);
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(shell.analysisSnapshot().value("streakDays").toInt() == 2);
    assert(shell.analysisSnapshot().value("todayCheckin") == "已打卡");
    UiShellTestAccess::set_today(shell, QDate(2028, 3, 2));
    assert(shell.analysisSnapshot().value("todayCheckin") == "未打卡");
    const auto account_snapshot = shell.analysisSnapshot();
    shell.openFreeProgram(QStringLiteral("python"));
    assert(shell.analysisSnapshot() == account_snapshot);
    wait_for([&] { return !shell.contentBusy(); });
    const auto checkin_path = QString::fromStdWString((checkin_root / "learning/checkin.v1.json").wstring());
    QLockFile lock(checkin_path + ".lock");
    assert(lock.tryLock(0));
    shell.checkIn();
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(!shell.checkinSummary().value("ready").toBool());
    assert(shell.checkinSummary().value("status").toString().contains(QStringLiteral("请稍后重试")));
    lock.unlock();
    shell.refreshCheckin();
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(shell.checkinSummary().value("ready").toBool());
    assert(!shell.checkinSummary().value("checkedIn").toBool());
    assert(shell.setAccountContext(checkin_b, checkin_workspace, checkin_data));
    assert(shell.checkinSummary().value("dates").toStringList().isEmpty());
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(shell.checkinSummary().value("totalDays").toInt() == 0);
    assert(shell.setAccountContext(checkin_a, checkin_workspace, checkin_data));
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(shell.checkinSummary().value("totalDays").toInt() == 2);
    assert(shell.clearAccountContext());
    assert(!shell.checkinSummary().value("ready").toBool());
    assert(shell.checkinSummary().value("dates").toStringList().isEmpty());
    // Read callbacks queued for a previous account must not reveal its dates.
    assert(shell.setAccountContext(checkin_a, checkin_workspace, checkin_data));
    assert(shell.setAccountContext(checkin_b, checkin_workspace, checkin_data));
    wait_for([&] { return !shell.checkinSummary().value("busy").toBool(); });
    assert(shell.checkinSummary().value("ready").toBool());
    assert(shell.checkinSummary().value("totalDays").toInt() == 0);
  }
  {
    UiShell shell;
    shell.saveDraft();
    assert(!shell.hasActiveAccount());
    assert(!shell.setAccountContext(unauthenticated, workspace, data));
    assert(!std::filesystem::exists(data / "accounts"));
    shell.loadPublishedContent(QString::fromLocal8Bit(argv[1]));
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.publishedTitles().size() > 1);
    assert(!shell.challengeMeta().isEmpty());
    const auto challenge = shell.challengeMeta().first().toMap();
    assert(!challenge.value(QStringLiteral("targetOutput")).toList().isEmpty());
    assert(!challenge.value(QStringLiteral("evidence")).toList().isEmpty());
    assert(!challenge.value(QStringLiteral("starterCode")).toString().isEmpty());
    assert(!challenge.value(QStringLiteral("explanation")).toString().isEmpty());
    assert(challenge.contains(QStringLiteral("prerequisites")));
    shell.openChallenge(QStringLiteral("missing-challenge"));
    assert(!shell.challengeDetailOpen());
    shell.openChallenge(challenge.value(QStringLiteral("id")).toString());
    assert(shell.challengeDetailOpen() && shell.selectedChallenge() == challenge);
    shell.openChallenge(QStringLiteral("missing-challenge"));
    assert(shell.selectedChallenge() == challenge);
    shell.closeChallenge();
    assert(!shell.challengeDetailOpen() && shell.selectedChallenge().isEmpty());
    shell.configureAccountStorage(workspace, data);
    shell.configureExecutionTool(QStringLiteral("cpp"), std::filesystem::path(argv[2]));
    shell.configureExecutionTool(QStringLiteral("java"), std::filesystem::path(argv[3]));
    shell.configureExecutionTool(QStringLiteral("python"), std::filesystem::path(argv[4]));
    shell.configureExecutionTool(QStringLiteral("javascript"), std::filesystem::path(argv[5]));
    assert(!shell.hasActiveAccount());
    shell.registerAccount(QStringLiteral("Qt Fixture"), QStringLiteral("qt@example.test"),
        QStringLiteral("Test-Password-123!"));
    wait_for([&] { return !shell.accountBusy(); });
    if (!shell.hasActiveAccount()) std::cerr << "Registration failed: " << shell.accountStatus().toStdString() << '\n';
    assert(shell.hasActiveAccount() && !shell.accountName().isEmpty());
    shell.logout();
    assert(!shell.hasActiveAccount());
    shell.login(QStringLiteral("qt@example.test"), QStringLiteral("Test-Password-123!"));
    wait_for([&] { return !shell.accountBusy(); });
    assert(shell.hasActiveAccount());
    // Runs are challenge-scoped, never consume the selected lesson draft and
    // do not create learning facts until a separate submission command.
    const auto challenge_learning_root = data / "accounts" /
        shell.activeAccountId().toStdString() / "learning";
    const auto lesson_before_challenge = shell.documentId();
    for (const auto& id : {QStringLiteral("stage-b"), QStringLiteral("stage-c"),
                          QStringLiteral("stage-d"), QStringLiteral("stage-j")}) {
      shell.openChallenge(id);
      shell.runChallenge();
      assert(shell.challengeRunBusy());
      wait_for([&] { return !shell.challengeRunBusy(); });
      const auto result = shell.challengeRunResult();
      if (!result.value(QStringLiteral("passed")).toBool())
        std::cerr << "Challenge run failed: " << id.toStdString() << " "
                  << result.value(QStringLiteral("error")).toString().toStdString() << '\n';
      assert(result.value(QStringLiteral("passed")).toBool());
      assert(!result.value(QStringLiteral("cases")).toList().isEmpty());
    }
    assert(shell.documentId() == lesson_before_challenge);
    assert(!std::filesystem::exists(challenge_learning_root / "evidence.v1.log"));
    assert(!std::filesystem::exists(challenge_learning_root / "progress.v1.log"));
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    shell.submitChallenge(QStringLiteral("Executed the current challenge and retained its output."), {});
    assert(shell.challengeHistoryBusy());
    assert(!shell.setAccountContext(second, workspace, data));
    shell.submitChallenge(QStringLiteral("Duplicate click while saving"), {});
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    if (shell.challengeHistory().size() != 1)
      std::cerr << "Challenge submission failed: " << shell.challengeHistoryStatus().toStdString()
                << "; account root exists: " << std::filesystem::exists(challenge_learning_root.parent_path()) << '\n';
    assert(shell.challengeHistory().size() == 1);
    const auto saved_challenge = shell.challengeHistory().first().toMap();
    assert(saved_challenge.value("status") == "passed" && saved_challenge.value("judgeMode") == "exact-lines");
    shell.submitChallenge(QStringLiteral("Executed the current challenge and retained its output."), {});
    assert(!shell.challengeHistoryBusy() && shell.challengeHistory().size() == 1);
    shell.updateChallengeCode(QStringLiteral("console.log('changed after submission')"));
    shell.submitChallenge(QStringLiteral("Cannot submit stale output"), {});
    assert(!shell.challengeHistoryBusy() && shell.challengeHistory().first().toMap() == saved_challenge);
    shell.openChallenge(QStringLiteral("stage-a"));
    assert(shell.challengeHistory().isEmpty());
    const QVariantMap external_fields{
        {"environment", "Windows 11 local fixture"}, {"command", "codeweave-check --isolated"},
        {"resultSummary", QStringLiteral("已保存工具链的版本输出记录，并附上构建错误日志与修复说明")},
        {"artifactRef", "fixture-report.txt"}, {"reproducedOn", QDate::currentDate().toString(Qt::ISODate)}};
    shell.submitChallenge({}, {});
    assert(!shell.challengeHistoryBusy() && shell.challengeHistory().isEmpty());
    auto sensitive = external_fields;
    sensitive["command"] = "password=example-secret";
    shell.submitChallenge({}, sensitive);
    assert(!shell.challengeHistoryBusy() && shell.challengeHistory().isEmpty());
    auto unrelated = external_fields;
    unrelated["resultSummary"] = QStringLiteral("完成了相关工作，详细内容见附件说明文档");
    shell.submitChallenge({}, unrelated);
    assert(!shell.challengeHistoryBusy() && shell.challengeHistory().isEmpty());
    assert(shell.challengeHistoryStatus().contains(QStringLiteral("验收点")));
    auto future = external_fields;
    future["reproducedOn"] = QDate::currentDate().addDays(1).toString(Qt::ISODate);
    shell.submitChallenge({}, future);
    assert(!shell.challengeHistoryBusy() && shell.challengeHistory().isEmpty());
    shell.submitChallenge({}, external_fields);
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    assert(shell.challengeHistory().size() == 1);
    const auto pending = shell.challengeHistory().first().toMap();
    assert(pending.value("status") == "submitted" && pending.value("tier") == "external");
    assert(shell.challengeProgress().value("stage-a").toMap().value("status") == "submitted");
    shell.reviewChallengeSubmission(pending.value("id").toString(), true, "completed");
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    assert(shell.challengeHistory().first().toMap().value("status") == "verified");
    assert(shell.challengeProgress().value("stage-a").toMap().value("status") == "verified");
    shell.refreshChallengeHistory();
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    assert(shell.challengeHistory().first().toMap().value("evidence") == pending.value("evidence"));
    auto revised_fields = external_fields;
    revised_fields["resultSummary"] = QStringLiteral("再次运行，已保存一次构建报错的完整日志。");
    shell.submitChallenge({}, revised_fields);
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    assert(shell.challengeHistory().size() == 2);
    assert(shell.challengeProgress().value("stage-a").toMap().value("status") == "verified");
    const auto retry = shell.challengeHistory().first().toMap();
    shell.reviewChallengeSubmission(retry.value("id").toString(), false, "attempted");
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    assert(shell.challengeHistory().first().toMap().value("status") == "rejected");
    shell.submitChallenge({}, revised_fields);
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    assert(shell.challengeHistory().size() == 3);
    assert(shell.challengeHistory().at(1).toMap().value("status") == "rejected");
    shell.openChallenge(QStringLiteral("stage-j"));
    shell.reviewChallengeSubmission(pending.value("id").toString(), false, {});
    assert(!shell.challengeHistoryBusy());
    assert(shell.challengeHistory().size() == 1 && shell.challengeHistory().first().toMap() == saved_challenge);
    shell.openChallenge(QStringLiteral("stage-d"));
    shell.updateChallengeCode(QStringLiteral("console.log('待办数量: 20');"));
    shell.runChallenge();
    wait_for([&] { return !shell.challengeRunBusy(); });
    assert(!shell.challengeRunResult().value(QStringLiteral("passed")).toBool());
    assert(shell.challengeRunResult().value(QStringLiteral("cases")).toList().size() == 3);
    assert(shell.challengeRunResult().value(QStringLiteral("extraLines")).toList().size() == 1);
    shell.updateChallengeCode(QStringLiteral("console.log('待办数量: 20');\n"));
    assert(shell.challengeRunResult().isEmpty());
    shell.updateChallengeCode(QStringLiteral("console.log(typeof Qt, typeof require, typeof fetch, typeof process);"));
    shell.runChallenge();
    wait_for([&] { return !shell.challengeRunBusy(); });
    assert(shell.challengeRunResult().value(QStringLiteral("output")).toList().first().toString()
        == QStringLiteral("undefined undefined undefined undefined"));
    shell.updateChallengeCode(QStringLiteral("while (true) {}"));
    shell.runChallenge();
    wait_for([&] { return !shell.challengeRunBusy(); });
    assert(shell.challengeRunResult().value(QStringLiteral("error")).toString().contains(QStringLiteral("超时")));
    shell.runChallenge();
    shell.cancelChallenge();
    wait_for([&] { return !shell.challengeRunBusy(); });
    assert(shell.challengeRunResult().value(QStringLiteral("error")).toString().contains(QStringLiteral("取消")));
    shell.updateChallengeCode(QStringLiteral("throw new Error('fixture failure')"));
    shell.runChallenge();
    wait_for([&] { return !shell.challengeRunBusy(); });
    assert(shell.challengeRunResult().value(QStringLiteral("error")).toString().contains(QStringLiteral("fixture failure")));
    assert(!shell.challengeRunResult().contains(QStringLiteral("cases")));
    shell.openChallenge(QStringLiteral("stage-a"));
    shell.runChallenge();
    assert(!shell.challengeRunBusy() && shell.challengeRunResult().contains(QStringLiteral("error")));
    shell.openChallenge(QStringLiteral("stage-d"));
    shell.updateChallengeCode(QStringLiteral("while (true) {}"));
    shell.runChallenge();
    assert(shell.challengeRunBusy());
    shell.closeChallenge();
    shell.openChallenge(QStringLiteral("stage-d"));
    wait_for([&] { return !shell.challengeRunBusy(); });
    assert(shell.challengeDetailOpen() && shell.challengeRunResult().isEmpty());
    shell.updateChallengeCode(QStringLiteral("for (let i = 0; i < 101; ++i) console.log(i);"));
    shell.runChallenge();
    wait_for([&] { return !shell.challengeRunBusy(); });
    assert(shell.challengeRunResult().value(QStringLiteral("error")).toString().contains(QStringLiteral("输出超过上限")));
    const auto retained_challenge_code = shell.challengeCode();
    shell.closeChallenge();
    shell.configureAccountStorage(workspace, data);
    shell.openPublishedContent(0);
    wait_for([&] { return !shell.contentBusy(); });
    shell.openChallenge(QStringLiteral("stage-d"));
    assert(shell.challengeCode() == retained_challenge_code);
    shell.closeChallenge();
    // Opening a published unit must complete the body -> starter chain without
    // requiring a second UI command. This is the regression for the broken
    // interaction path that left the editor without a language or draft.
    assert(!shell.starterLanguage().isEmpty());
    // Run one native fixture per supported language through the Qt facade. The
    // tools are trusted host inputs; QML never supplies executable paths.
    const std::map<QString, QString> execution_cases{
        {QStringLiteral("python-loop-sum"), QStringLiteral("15\n")},
        {QStringLiteral("java-loop-sum"), QStringLiteral("15\n")},
        {QStringLiteral("javascript-loop-sum"), QStringLiteral("15\n")},
        {QStringLiteral("b1-array-basics"), QStringLiteral("0: 3\n1: 1\n2: 4\n3: 1\n4: 5\n")}};
    for (const auto& [document, expected] : execution_cases) {
      const auto index = shell.publishedIds().indexOf(document);
      assert(index >= 0);
      shell.openPublishedContent(index);
      wait_for([&] { return !shell.contentBusy(); });
      shell.loadStarterCode();
      wait_for([&] { return !shell.contentBusy(); });
      assert(shell.executionPolicy() == QStringLiteral("native"));
      shell.runCode();
      wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
      assert(shell.executionOutput() == expected);
      const auto trace = shell.executionTrace();
      const auto events = trace.value(QStringLiteral("events")).toList();
      assert(trace.value(QStringLiteral("documentId")).toString() == document);
      assert(events.size() >= 3);
      assert(events.first().toMap().value(QStringLiteral("kind")).toString() == QStringLiteral("started"));
      assert(events.at(events.size() - 2).toMap().value(QStringLiteral("kind")).toString() == QStringLiteral("output"));
      assert(events.last().toMap().value(QStringLiteral("kind")).toString() == QStringLiteral("completed"));
      shell.refreshReviewSummary();
      wait_for([&] { return !shell.operationBusy(); });
      assert(shell.lessonEvidenceStates().value(document).toMap().value("practiced").toBool());
      assert(!shell.lessonAssessment().value("completed").toBool());
    }
    const auto challenge_index = shell.publishedIds().indexOf(QStringLiteral("stage-b"));
    assert(challenge_index >= 0);
    shell.openPublishedContent(challenge_index);
    wait_for([&] { return !shell.contentBusy(); });
    shell.loadStarterCode();
    wait_for([&] { return !shell.contentBusy(); });
    shell.setIndependentAttempt(true);
    assert(shell.independentAttempt());
    shell.runCode();
    wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
    assert(shell.executionOutput() == QStringLiteral("15\n"));
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(shell.progressSummary().contains(QStringLiteral("1 条")));
    assert(shell.analysisSnapshot().value(QStringLiteral("projectionStatus")).toString() == QStringLiteral("ok"));
    assert(shell.analysisSnapshot().value(QStringLiteral("projectionLatestEvidence")).toString() == QStringLiteral("2026-10-03"));
    assert(shell.analysisSnapshot().value(QStringLiteral("projectionMasteryCount")).toInt() == 1);
    shell.loadHints();
    wait_for([&] { return !shell.contentBusy(); });
    shell.setIndependentAttempt(true);
    assert(!shell.independentAttempt());
    shell.runCode();
    wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(shell.progressSummary().contains(QStringLiteral("1 条")));
    assert(shell.reviewSummary().contains(QStringLiteral("独立通过 1 次")));
    // An invalid host path is rejected before a task is queued and cannot be
    // used as a cross-language escape hatch.
    shell.configureExecutionTool(QStringLiteral("python"),
        std::filesystem::path("C:/does-not-exist/python.exe"));
    const auto python_index = shell.publishedIds().indexOf(QStringLiteral("python-loop-sum"));
    assert(python_index >= 0);
    shell.openPublishedContent(python_index);
    wait_for([&] { return !shell.contentBusy(); });
    shell.loadStarterCode();
    wait_for([&] { return !shell.contentBusy(); });
    shell.runCode();
    assert(!shell.executionBusy());
    assert(shell.operationStatus() == QStringLiteral("尚未配置该语言的执行工具"));
    shell.configureExecutionTool(QStringLiteral("python"), std::filesystem::path(argv[4]));
    shell.updateDraftCode(QStringLiteral("raise SystemExit(1)\n"));
    shell.saveDraft();
    wait_for([&] { return !shell.draftSaving(); });
    shell.runCode();
    wait_for([&] { return !shell.executionBusy(); });
    assert(shell.executionOutputError());
    assert(shell.executionOutput() == QStringLiteral("process_exit_nonzero"));
    assert(shell.executionTrace().value(QStringLiteral("events")).toList().last().toMap()
        .value(QStringLiteral("kind")).toString() == QStringLiteral("failed"));
    shell.openFreeProgram(QStringLiteral("python"));
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.documentId() == QStringLiteral("free-python"));
    assert(shell.selectedContentBody().isEmpty() && shell.executionTrace().isEmpty());
    shell.updateDraftCode(QStringLiteral("import time\ntime.sleep(2)\n"));
    shell.setExecutionTimeout(5000);
    shell.runCode();
    assert(shell.executionBusy());
    shell.cancelExecution();
    wait_for([&] { return !shell.executionBusy(); });
    assert(shell.executionOutput().contains(QStringLiteral("取消")));
    assert(shell.executionTrace().value(QStringLiteral("events")).toList().last().toMap()
        .value(QStringLiteral("kind")).toString() == QStringLiteral("cancelled"));
    shell.discardDraftChanges();
    shell.openPublishedContent(python_index);
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.documentId() == QStringLiteral("python-loop-sum"));
    assert(shell.executionTrace().isEmpty());
    shell.logout();
    assert(!shell.hasActiveAccount());
    assert(shell.executionOutput().isEmpty() && !shell.executionOutputError());
    assert(shell.executionTrace().isEmpty());
    const auto document = shell.documentId();
    saved_document = document;
    shell.discardDraftChanges();
    wait_for([&] { return shell.setAccountContext(first, workspace, data); });
    wait_for([&] { return !shell.contentBusy(); });
    assert(!shell.draftPersistenceBlocked() && !shell.draftDirty());
    shell.loadHints();
    wait_for([&] { return !shell.contentBusy(); });
    shell.saveExternalEvidence(QStringLiteral("Windows test fixture"),
        QStringLiteral("codeweave-test --isolated"),
        QStringLiteral("External evidence remains pending for manual review."),
        QString(), QStringLiteral("2026-10-05"));
    wait_for([&] { return !shell.operationBusy(); });
    std::vector<codeweave::learning::EvidenceRecord> pending_evidence;
    assert(codeweave::learning::EvidenceStore(first_root).read_all(pending_evidence).ok);
    assert(!pending_evidence.empty() &&
        pending_evidence.back().state == codeweave::learning::EvidenceState::Pending);
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(shell.progressSummary().contains(QStringLiteral("0 条")));
    assert(shell.reviewSummary().contains(QStringLiteral("证据 1 条")));
    assert(shell.reviewSummary().contains(QStringLiteral("通过 0 次")));
    assert(shell.reviewSummary().contains(QStringLiteral("External evidence remains pending")));
    const auto file = draft_path(first_root, document);
    shell.updateDraftCode(QStringLiteral("中文 first\n"));
    const auto submitted_revision = shell.draftRevision();
    shell.saveDraft();
    assert(shell.draftSaving() && !shell.requestClose());
    assert(!shell.setAccountContext(second, workspace, data));
    shell.saveDraft(); // Duplicate click is coalesced.
    shell.updateDraftCode(QStringLiteral("中文 second\n"));
    wait_for([&] { return !shell.draftSaving(); });
    assert(shell.draftDirty() && shell.savedRevision() == submitted_revision);
    assert(read_file(file) == QStringLiteral("中文 first\n").toUtf8().toStdString());
    shell.saveDraft();
    wait_for([&] { return !shell.draftSaving(); });
    assert(!shell.draftDirty());
    const auto stamp = std::filesystem::last_write_time(file);
    shell.saveDraft();
    assert(std::filesystem::last_write_time(file) == stamp);
    shell.loadStarterCode();
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.draftCode() == QStringLiteral("中文 second\n") && !shell.draftDirty());
    shell.updateDraftCode(QString(4 * 1024 * 1024 + 1, QChar('x')));
    shell.saveDraft();
    wait_for([&] { return !shell.draftSaving(); });
    assert(shell.draftDirty());
    assert(read_file(file) == QStringLiteral("中文 second\n").toUtf8().toStdString());
    shell.discardDraftChanges();
    shell.updateDraftCode(QString());
    shell.saveDraft();
    wait_for([&] { return !shell.draftSaving(); });
    assert(!shell.draftDirty() && read_file(file).empty());
    shell.loadStarterCode();
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.draftCode().isEmpty() && !shell.draftDirty());
    const auto generation = shell.accountGeneration();
    shell.openChallenge(QStringLiteral("stage-d"));
    shell.updateChallengeCode(QStringLiteral("console.log('account-private challenge draft');"));
    wait_for([&] { return shell.setAccountContext(second, workspace, data); });
    wait_for([&] { return !shell.contentBusy(); });
    assert(!shell.challengeDetailOpen() && shell.challengeRunResult().isEmpty());
    shell.openChallenge(QStringLiteral("stage-d"));
    assert(shell.challengeCode() == shell.selectedChallenge().value(QStringLiteral("starterCode")).toString());
    shell.closeChallenge();
    assert(shell.accountGeneration() > generation && shell.draftCode() == shell.starterCode());
    assert(shell.progressSummary().isEmpty() && shell.reviewSummary().isEmpty());
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(shell.reviewSummary().contains(QStringLiteral("证据 0 条")));
    assert(!std::filesystem::exists(draft_path(second_root, document)));
    shell.updateDraftCode(QStringLiteral("survives restart"));
    shell.saveDraft();
    wait_for([&] { return !shell.draftSaving(); });
    assert(!shell.draftDirty());
    // A directory at the target name forces a real write error without chmod
    // changes, real-data access, or mocking successful persistence.
    const auto blocked_file = draft_path(second_root, document);
    assert(std::filesystem::remove(blocked_file));
    std::filesystem::create_directory(blocked_file);
    shell.updateDraftCode(QStringLiteral("cannot commit"));
    shell.saveDraft();
    wait_for([&] { return !shell.draftSaving(); });
    assert(shell.draftDirty() && std::filesystem::is_directory(blocked_file));
    assert(std::filesystem::remove(blocked_file));
    shell.saveDraft();
    wait_for([&] { return !shell.draftSaving(); });
    assert(!shell.draftDirty());
    wait_for([&] { return shell.clearAccountContext(); });
    assert(shell.draftCode().isEmpty() && !shell.hasActiveAccount());
    assert(shell.analysisSnapshot().isEmpty());
    // Simulate a corrupt persisted file in our isolated fixture only.
    std::ofstream(file, std::ios::binary | std::ios::trunc).write("bad\0text", 8);
    wait_for([&] { return shell.setAccountContext(first, workspace, data); });
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.draftPersistenceBlocked());
    shell.updateDraftCode(QStringLiteral("must not overwrite"));
    shell.saveDraft();
    assert(read_file(file) == std::string("bad\0text", 8));
    wait_for([&] { return shell.clearAccountContext(); });
    assert(shell.requestClose());
  }
  // Reload a submitted snapshot in another shell, then close with a write
  // queued behind a read. Shutdown must drain the write without losing it.
  {
    UiShell shell;
    shell.configureAccountStorage(workspace, data);
    shell.loadPublishedContent(QString::fromLocal8Bit(argv[1]));
    wait_for([&] { return !shell.contentBusy(); });
    shell.login("qt@example.test", "Test-Password-123!");
    wait_for([&] { return !shell.accountBusy() && !shell.challengeHistoryBusy(); });
    shell.openChallenge("stage-j");
    assert(shell.challengeHistory().size() == 1);
    assert(shell.challengeHistory().first().toMap().value("code").toString().contains("console.log"));
    assert(shell.setAccountContext(second, workspace, data));
    wait_for([&] { return !shell.challengeHistoryBusy(); });
    shell.openChallenge("stage-j");
    assert(shell.challengeHistory().isEmpty() && shell.challengeProgress().isEmpty());
    shell.openChallenge("stage-a");
    std::mutex mutex;
    std::condition_variable condition;
    bool started = false, release = false;
    assert(UiShellTestAccess::block_worker(shell, mutex, condition, started, release));
    {
      std::unique_lock lock(mutex);
      assert(condition.wait_for(lock, std::chrono::seconds(5), [&] { return started; }));
    }
    shell.submitChallenge({}, QVariantMap{
        {"environment", "Windows isolated shutdown fixture"}, {"command", "fixture-check"},
        {"resultSummary", QStringLiteral("错误原因与修复步骤说明已留存，提交须在关闭前写入。")},
        {"artifactRef", ""}, {"reproducedOn", QDate::currentDate().toString(Qt::ISODate)}});
    assert(shell.challengeHistoryBusy());
    assert(!shell.setAccountContext(first, workspace, data));
    QTimer::singleShot(20, [&] {
      { std::lock_guard lock(mutex); release = true; }
      condition.notify_all();
    });
    assert(shell.requestClose());
    QVariantList stored;
    assert(ChallengeSubmissionStore(QString::fromStdWString(second_root.wstring())).read(stored).ok);
    assert(stored.size() == 1 && stored.first().toMap().value("status") == "submitted");
  }
  // Account changes are allowed while a read is in flight. The old callback
  // must be ignored after the generation changes and must not overwrite the
  // new account's starter/draft state.
  {
    UiShell shell;
    shell.loadPublishedContent(QString::fromLocal8Bit(argv[1]));
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.setAccountContext(first, workspace, data));
    std::mutex mutex;
    std::condition_variable condition;
    bool started = false;
    bool release = false;
    assert(UiShellTestAccess::block_worker(shell, mutex, condition, started, release));
    {
      std::unique_lock lock(mutex);
      assert(condition.wait_for(lock, std::chrono::seconds(5), [&] { return started; }));
    }
    shell.openPublishedContent(0);
    assert(shell.contentBusy());
    assert(shell.setAccountContext(second, workspace, data));
    {
      std::lock_guard lock(mutex);
      release = true;
    }
    condition.notify_all();
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.hasActiveAccount());
    assert(shell.activeAccountId() == QString::fromUtf8(second.current()->id));
    assert(!shell.starterLanguage().isEmpty());
    assert(!shell.draftPersistenceBlocked());
    assert(shell.requestClose());
  }
  assert(!std::filesystem::exists(first_root / ".native.lock"));
  assert(!std::filesystem::exists(second_root / ".native.lock"));
  {
    UiShell shell;
    shell.configureAccountStorage(workspace, data);
    shell.login(QStringLiteral("b@example.test"), QStringLiteral("Test-Password-123!"));
    wait_for([&] { return !shell.accountBusy(); });
    assert(shell.hasActiveAccount());
    shell.changePassword(QStringLiteral("wrong"), QStringLiteral("Changed-Password-456!"));
    wait_for([&] { return !shell.accountBusy(); });
    assert(!shell.accountStatus().contains(QStringLiteral("密码已修改")));
    shell.changePassword(QStringLiteral("Test-Password-123!"), QStringLiteral("Changed-Password-456!"));
    wait_for([&] { return !shell.accountBusy(); });
    assert(shell.accountStatus().contains(QStringLiteral("密码已修改")));
    shell.logout();
    shell.login(QStringLiteral("b@example.test"), QStringLiteral("Changed-Password-456!"));
    wait_for([&] { return !shell.accountBusy(); });
    assert(shell.hasActiveAccount());
    shell.openFreeProgram(QStringLiteral("invalid"));
    assert(shell.starterLanguage().isEmpty());
    shell.openFreeProgram(QStringLiteral("python"));
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.documentId() == "free-python" && shell.starterLanguage() == "python");
    shell.updateDraftCode(QStringLiteral("print('free program')"));
    shell.saveDraft();
    wait_for([&] { return !shell.draftSaving(); });
    assert(!shell.draftDirty());
    shell.openFreeProgram(QStringLiteral("cpp"));
    wait_for([&] { return !shell.contentBusy(); });
    shell.openFreeProgram(QStringLiteral("python"));
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.draftCode() == QStringLiteral("print('free program')"));
    assert(shell.performDataAction(QStringLiteral("backup"), {}, workspace / "qt-backup"));
    wait_for([&] { return !shell.operationBusy(); });
    assert(std::filesystem::exists(workspace / "qt-backup"));
    assert(shell.performDataAction(QStringLiteral("restore"), workspace / "qt-backup", workspace / "qt-restored"));
    wait_for([&] { return !shell.operationBusy(); });
    assert(std::filesystem::exists(workspace / "qt-restored"));
    std::ofstream(workspace / "invalid-import.json") << "not json";
    assert(shell.performDataAction(QStringLiteral("import-users"), workspace / "invalid-import.json", workspace / "invalid-target"));
    wait_for([&] { return !shell.operationBusy(); });
    assert(!std::filesystem::exists(workspace / "invalid-target"));
  }
  // A new facade restores a successfully saved document after shutdown.
  {
    UiShell shell;
    assert(shell.setAccountContext(second, workspace, data));
    shell.saveDraft();
    assert(!std::filesystem::exists(second_root / ".native.lock"));
    shell.loadPublishedContent(QString::fromLocal8Bit(argv[1]));
    wait_for([&] { return !shell.contentBusy(); });
    shell.openPublishedContent(0);
    wait_for([&] { return !shell.contentBusy(); });
    shell.loadStarterCode();
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.documentId() == saved_document);
    assert(shell.draftCode() == QStringLiteral("cannot commit") && !shell.draftDirty());
  }
  assert(!std::filesystem::exists(second_root / ".native.lock"));
  {
    UiShell shell;
    shell.loadPublishedContent(QString::fromLocal8Bit(argv[1]));
    // Destruction while a read is queued/active must reclaim the worker.
  }
  {
    codeweave::account::AccountService learning_account(store);
    assert(learning_account.register_account("Learning fixture", "learning@example.test", "Test-Password-123!").ok);
    std::filesystem::path learning_root;
    assert(learning_account.learning_data_root(data, learning_root).ok);
    codeweave::learning::MasteryStore mastery(learning_root);
    const auto append = [&](const std::string& id, const std::string& ref,
        codeweave::learning::MasteryEvidenceKind kind, bool passed,
        codeweave::learning::CompletionVerification verification, const std::string& note) {
      codeweave::learning::MasteryEvidence record{id, kind, ref, note, "2025-01-01T00:00:00Z", passed,
          verification, codeweave::learning::RanBy::Learner, true, "L1", "op-learning-" +
              QCryptographicHash::hash(QByteArray::fromStdString(id), QCryptographicHash::Sha256).toHex().left(6).toStdString()};
      bool duplicate = false;
      assert(mastery.append_idempotent(record, duplicate).ok && !duplicate);
    };
    using Kind = codeweave::learning::MasteryEvidenceKind;
    using Verification = codeweave::learning::CompletionVerification;
    append("read-only", "python-loop-sum", Kind::Lesson, false, Verification::SelfDeclared,
        "学习信号：已阅读 · 课程正文已阅读");
    append("practiced-only", "python-loop-sum", Kind::Lesson, false, Verification::SelfDeclared,
        "学习信号：已练习 · 一次实际运行");
    append("external-pending", "python-loop-sum", Kind::Lesson, false, Verification::SelfDeclared,
        "执行环境：test\n执行命令：test\n结果摘要：pending\n复现日期：2025-01-01");
    append("self-passed", "python-condition", Kind::Lesson, true, Verification::SelfDeclared, "完成声明");
    append("auto-passed", "java-loop-sum", Kind::Lesson, true, Verification::AutoVerified, "真实验证记录 fixture");
    append("review-passed", "c-loop-sum", Kind::Review, true, Verification::SelfDeclared, "复测通过");
    append("challenge-only", "javascript-loop-sum", Kind::Challenge, true, Verification::AutoVerified, "挑战不算课程完成");
    UiShell shell;
    shell.loadPublishedContent(QString::fromLocal8Bit(argv[1]));
    wait_for([&] { return !shell.contentBusy(); });
    assert(!shell.lessonEvidenceReady() && shell.lessonEvidenceStates().isEmpty());
    assert(shell.setAccountContext(learning_account, workspace, data));
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(shell.lessonEvidenceReady());
    const auto learning_signals = shell.lessonEvidenceStates().value("python-loop-sum").toMap();
    assert(learning_signals.value("read").toBool() && learning_signals.value("practiced").toBool() && learning_signals.value("submittedEvidence").toBool());
    assert(!learning_signals.value("selfDeclaredPassed").toBool() && !learning_signals.value("autoVerifiedPassed").toBool() && !learning_signals.value("reviewMastered").toBool());
    // Completion facts remain all-time even though the analysis window is seven days.
    assert(shell.lessonEvidenceStates().value("python-condition").toMap().value("selfDeclaredPassed").toBool());
    assert(shell.lessonEvidenceStates().value("java-loop-sum").toMap().value("autoVerifiedPassed").toBool());
    assert(shell.lessonEvidenceStates().value("c-loop-sum").toMap().value("reviewMastered").toBool());
    assert(!shell.lessonEvidenceStates().contains("javascript-loop-sum"));
    const auto first_lesson = shell.lessonMeta().first().toMap();
    assert(!first_lesson.value("code").toString().isEmpty() && !first_lesson.value("prerequisites").toList().isEmpty());
    std::ofstream(learning_root / "learning" / "mastery.v1.log", std::ios::trunc) << "invalid fixture record\n";
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(!shell.lessonEvidenceReady() && shell.lessonEvidenceStates().isEmpty());
    assert(shell.clearAccountContext());
    assert(!shell.lessonEvidenceReady() && shell.lessonEvidenceStates().isEmpty());
    assert(shell.setAccountContext(second, workspace, data));
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(shell.lessonEvidenceReady() && !shell.lessonEvidenceStates().contains("python-condition"));
  }
  {
    codeweave::account::AccountService learner(store);
    assert(learner.register_account("Evidence learner", "lesson-evidence@example.test", "Test-Password-123!").ok);
    std::filesystem::path root;
    assert(learner.learning_data_root(data, root).ok);
    const auto records = [&] {
      std::vector<codeweave::learning::MasteryEvidence> result;
      assert(codeweave::learning::MasteryStore(root).read_all(result).ok);
      return result;
    };
    UiShell shell;
    shell.loadPublishedContent(QString::fromLocal8Bit(argv[1]));
    wait_for([&] { return !shell.contentBusy(); });
    shell.openPublishedContent(shell.publishedIds().indexOf("stage-d"));
    wait_for([&] { return !shell.contentBusy(); });
    assert(!shell.lessonAssessment().value("canMarkRead").toBool());
    shell.markLessonRead();
    shell.completeLesson({});
    assert(records().empty());
    assert(shell.setAccountContext(learner, workspace, data));
    wait_for([&] { return !shell.contentBusy(); });
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(!shell.lessonAssessment().value("canComplete").toBool());
    shell.markLessonRead();
    assert(shell.operationBusy() && !shell.setAccountContext(second, workspace, data));
    shell.markLessonRead();
    wait_for([&] { return !shell.operationBusy(); });
    assert(records().size() == 1 && !records().front().passed);
    assert(shell.lessonEvidenceStates().value("stage-d").toMap().value("read").toBool());
    assert(!shell.lessonAssessment().value("completed").toBool());
    shell.markLessonRead();
    assert(!shell.operationBusy() && records().size() == 1);
    shell.configureExecutionTool("javascript", std::filesystem::path(argv[5]));
    shell.updateDraftCode("throw new Error('lesson failure');\n");
    shell.runCode();
    wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
    assert(!shell.lessonAssessment().value("canComplete").toBool() && records().size() == 1);
    shell.updateDraftCode("console.log(150);\n");
    shell.runCode();
    wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
    assert(shell.lessonEvidenceStates().value("stage-d").toMap().value("practiced").toBool());
    assert(!shell.lessonAssessment().value("canComplete").toBool());
    assert(!shell.lessonAssessment().value("cases").toList().first().toMap().value("matched").toBool());
    shell.completeLesson({});
    assert(!shell.operationBusy() && records().size() == 2);
    const auto correct = QStringLiteral("console.log('待办数量: 2'); console.log('写周报'); console.log('跑一次构建');\n");
    shell.updateDraftCode("setTimeout(() => {" + correct + "}, 100);\n");
    shell.runCode();
    shell.updateDraftCode(correct);
    wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
    assert(!shell.lessonAssessment().value("canComplete").toBool());
    shell.runCode();
    wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
    assert(shell.lessonAssessment().value("canComplete").toBool());
    shell.updateDraftCode("");
    assert(!shell.lessonAssessment().value("canComplete").toBool());
    shell.updateDraftCode(correct + "console.log('extra');\n");
    shell.runCode();
    wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
    assert(shell.lessonAssessment().value("canComplete").toBool());
    assert(shell.lessonAssessment().value("extraLines").toList().size() == 1);
    shell.completeLesson({});
    shell.completeLesson({});
    wait_for([&] { return !shell.operationBusy(); });
    assert(records().size() == 3 && records().back().passed);
    assert(records().back().verification == codeweave::learning::CompletionVerification::AutoVerified);
    assert(!records().back().independent);
    assert(shell.lessonAssessment().value("completed").toBool());
    shell.completeLesson({});
    assert(!shell.operationBusy() && records().size() == 3);
    codeweave::learning::MasteryStore mastery(root);
    codeweave::learning::MasterySnapshot snapshot;
    assert(codeweave::learning::MasteryService(mastery).replay(5, snapshot).ok);
    assert(snapshot.records.at("stage-d").level == 0);
    shell.discardDraftChanges();
    shell.openPublishedContent(shell.publishedIds().indexOf("javascript-loop-sum"));
    wait_for([&] { return !shell.contentBusy(); });
    shell.runCode();
    wait_for([&] { return !shell.executionBusy() && !shell.operationBusy(); });
    assert(shell.lessonAssessment().value("canComplete").toBool());
    assert(!shell.lessonAssessment().value("autoVerified").toBool());
    assert(shell.lessonAssessment().value("cases").toList().isEmpty());
    shell.completeLesson({});
    wait_for([&] { return !shell.operationBusy(); });
    assert(records().size() == 5 && records().back().passed);
    assert(records().back().verification == codeweave::learning::CompletionVerification::SelfDeclared);
    shell.discardDraftChanges();
    shell.openPublishedContent(shell.publishedIds().indexOf("csharp-loop-sum"));
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.lessonAssessment().value("external").toBool());
    shell.completeLesson({});
    assert(!shell.operationBusy() && records().size() == 5);
    QVariantMap fields{{"environment", "Windows .NET isolated test"}, {"command", "dotnet run"},
        {"resultSummary", QStringLiteral("能不看示例写出循环累加，并解释任意一轮 total 的值。输出 15。")},
        {"artifactRef", "fixture-log.txt"}, {"reproducedOn", QDate::currentDate().toString(Qt::ISODate)}};
    auto invalid = fields; invalid["reproducedOn"] = "2999-01-01";
    shell.completeLesson(invalid);
    assert(!shell.operationBusy() && records().size() == 5);
    invalid = fields; invalid["command"] = "password=example-secret";
    shell.completeLesson(invalid);
    assert(!shell.operationBusy() && records().size() == 5);
    invalid = fields; invalid["resultSummary"] = "zzzzzzzzzz";
    shell.completeLesson(invalid);
    assert(!shell.operationBusy() && records().size() == 5);
    shell.saveExternalEvidence(fields["environment"].toString(), fields["command"].toString(),
        fields["resultSummary"].toString(), fields["artifactRef"].toString(), fields["reproducedOn"].toString());
    wait_for([&] { return !shell.operationBusy(); });
    auto states = shell.lessonEvidenceStates().value("csharp-loop-sum").toMap();
    assert(states.value("submittedEvidence").toBool() && !states.value("selfDeclaredPassed").toBool());
    assert(!shell.lessonAssessment().value("completed").toBool());
    shell.completeLesson(fields);
    wait_for([&] { return !shell.operationBusy(); });
    states = shell.lessonEvidenceStates().value("csharp-loop-sum").toMap();
    assert(states.value("selfDeclaredPassed").toBool() && !states.value("autoVerifiedPassed").toBool());
    assert(records().size() == 6 && records().back().passed);
    assert(records().back().verification == codeweave::learning::CompletionVerification::SelfDeclared);
    assert(shell.clearAccountContext());
    assert(shell.lessonEvidenceStates().isEmpty() && !shell.lessonAssessment().value("canComplete").toBool());
    assert(shell.setAccountContext(learner, workspace, data));
    wait_for([&] { return !shell.contentBusy(); });
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(shell.lessonEvidenceStates().value("stage-d").toMap().value("autoVerifiedPassed").toBool());
    assert(shell.lessonAssessment().value("completed").toBool());
    const auto damaged = root / "learning/mastery.v1.log";
    std::ofstream(damaged, std::ios::trunc | std::ios::binary) << "invalid isolated lesson fixture\n";
    shell.refreshReviewSummary();
    wait_for([&] { return !shell.operationBusy(); });
    assert(!shell.lessonEvidenceReady() && !shell.lessonAssessment().value("canComplete").toBool());
    shell.markLessonRead();
    shell.completeLesson(fields);
    assert(!shell.operationBusy() && read_file(damaged) == "invalid isolated lesson fixture\n");
  }
  {
    using namespace codeweave::learning;
    codeweave::account::AccountService learner(store);
    assert(learner.register_account("Analytics learner", "analytics@example.test", "Test-Password-123!").ok);
    std::filesystem::path root;
    assert(learner.learning_data_root(data, root).ok);
    UiShell shell;
    assert(shell.setAccountContext(learner, workspace, data));
    wait_for([&] { return !shell.contentBusy(); });
    const auto today = QDate::currentDate();
    const auto timestamp = [&](int offset, QTime time = QTime(12, 0)) {
      return QDateTime(today.addDays(offset), time).toUTC().toString(Qt::ISODateWithMs).toStdString();
    };
    const auto refresh = [&] {
      shell.refreshReviewSummary();
      wait_for([&] { return !shell.operationBusy(); });
    };
    refresh();
    assert(shell.analysisSnapshot().value("completedUnits").toInt() == 0);
    assert(shell.analysisSnapshot().value("periodStartKey") == today.addDays(-6).toString(Qt::ISODate));
    assert(shell.analysisSnapshot().value("todayKey") == today.toString(Qt::ISODate));
    MasteryStore mastery(root);
    int sequence = 0;
    const auto fact = [&](MasteryEvidenceKind kind, const char* ref, int offset, bool passed,
        QTime time = QTime(12, 0)) {
      const auto suffix = QString::number(++sequence, 16).rightJustified(6, '0').toStdString();
      const MasteryEvidence record{"analytics-" + suffix, kind, ref, "isolated analytics fixture",
          timestamp(offset, time), passed, CompletionVerification::SelfDeclared,
          RanBy::Learner, false, "L1", "op-analytics-" + suffix};
      bool duplicate = false;
      assert(mastery.append_idempotent(record, duplicate).ok && !duplicate);
    };
    fact(MasteryEvidenceKind::Lesson, "lesson-first", -6, true, QTime(0, 0));
    fact(MasteryEvidenceKind::Lesson, "lesson-first", 0, true);
    fact(MasteryEvidenceKind::Lesson, "lesson-last", 0, true, QTime(23, 59, 59));
    fact(MasteryEvidenceKind::Lesson, "lesson-old", -7, true, QTime(23, 59, 59));
    fact(MasteryEvidenceKind::Lesson, "lesson-future", 1, true, QTime(0, 0));
    fact(MasteryEvidenceKind::Lesson, "lesson-read", 0, false);
    fact(MasteryEvidenceKind::Bugfix, "unrelated-pass", 0, true);
    fact(MasteryEvidenceKind::Review, "review-a", -6, true, QTime(0, 0));
    fact(MasteryEvidenceKind::Review, "review-b", 0, false, QTime(23, 59, 59));
    fact(MasteryEvidenceKind::Review, "review-old", -7, true);
    fact(MasteryEvidenceKind::Challenge, "legacy-only", -6, true);
    fact(MasteryEvidenceKind::Challenge, "legacy-only", 0, true);
    fact(MasteryEvidenceKind::Challenge, "shared", 0, true);
    fact(MasteryEvidenceKind::Challenge, "legacy-rejected", -1, true);
    fact(MasteryEvidenceKind::Challenge, "legacy-rejected", 0, false);
    EvidenceStore evidence(root);
    for (int index = 0; index < 4; ++index) {
      const auto suffix = QString::number(index, 16).rightJustified(6, '0').toStdString();
      EvidenceRecord record{"practice-" + suffix, "not-explicitly-completed", "exercise-a",
          today.addDays(index == 2 ? -7 : 0).toString(Qt::ISODate).toStdString(), "15", "15",
          RanBy::Learner, false, "L1", {}, {}, EvidenceState::Pending, "op-practice-" + suffix};
      if (index == 3) record.exercise_id = "external-evidence";
      bool duplicate = false;
      assert(evidence.append_idempotent(record, duplicate).ok);
    }
    const ChallengeSubmissionStore submissions(QString::fromStdWString(root.wstring()));
    QVariantList records;
    const auto submission = [&](const char* id, const char* status, int offset, bool external = false) {
      const auto suffix = QString::number(++sequence, 16).rightJustified(32, '0');
      const bool reviewed = std::string_view(status) == "verified" || std::string_view(status) == "rejected";
      const QVariantMap record{{"id", "submission-" + suffix}, {"challengeId", id},
          {"submittedAt", QString::fromStdString(timestamp(offset))}, {"status", reviewed ? "submitted" : status},
          {"tier", external ? "external" : "teaching"}, {"judgeMode", external ? "" : "exact-lines"},
          {"evidence", "Isolated analytics submission"}, {"code", external ? "" : "print(15)"},
          {"expected", QVariantList{QStringLiteral("15")}},
          {"output", external ? QVariantList{} : QVariantList{QStringLiteral("15")}},
          {"observation", ""}, {"reviewedAt", ""}};
      assert(submissions.append(record, records).ok);
      if (reviewed) assert(submissions.review(record.value("id").toString(),
          std::string_view(status) == "verified", {}, records).ok);
    };
    submission("shared", "passed", 0);
    submission("shared", "passed", 0);
    submission("shared", "submitted", 0, true);
    submission("rejected", "passed", 0);
    submission("rejected", "rejected", 0, true);
    submission("pending", "submitted", 0, true);
    submission("verified", "verified", -7, true);
    submission("old", "passed", -7);
    submission("future", "passed", 1);
    refresh();
    const auto snapshot = shell.analysisSnapshot();
    assert(snapshot.value("completedUnits").toInt() == 2);
    assert(snapshot.value("practiceCount").toInt() == 2);
    assert(snapshot.value("verifiedPasses").toInt() == 3);
    assert(snapshot.value("reviewPassed").toInt() == 1 && snapshot.value("reviewFailed").toInt() == 1);
    assert(shell.clearAccountContext() && shell.analysisSnapshot().isEmpty());
    assert(shell.setAccountContext(learner, workspace, data));
    wait_for([&] { return !shell.contentBusy(); });
    refresh();
    assert(shell.analysisSnapshot() == snapshot);
    const auto archive = root / "learning/challenge-submissions.v1.json";
    std::ofstream(archive, std::ios::trunc | std::ios::binary) << "invalid isolated analytics fixture\n";
    refresh();
    assert(shell.analysisSnapshot().isEmpty() && !shell.lessonEvidenceReady());
    assert(read_file(archive) == "invalid isolated analytics fixture\n");
  }
  std::cout << "Qt facade: account isolation, analytics windows, revisions, persistence, lesson evidence, failures and shutdown passed\n";
}
