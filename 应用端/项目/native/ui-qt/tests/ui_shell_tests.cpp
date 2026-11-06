#include "ui_shell.hpp"
#include "evidence_store.hpp"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QElapsedTimer>
#include <QTemporaryDir>
#include <QThread>

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
}  // namespace

struct UiShellTestAccess {
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
  assert(argc == 6);
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
    UiShell shell;
    shell.saveDraft();
    assert(!shell.hasActiveAccount());
    assert(!shell.setAccountContext(unauthenticated, workspace, data));
    assert(!std::filesystem::exists(data / "accounts"));
    shell.loadPublishedContent(QString::fromLocal8Bit(argv[1]));
    wait_for([&] { return !shell.contentBusy(); });
    assert(shell.publishedTitles().size() > 1);
    shell.configureAccountStorage(workspace, data);
    shell.configureExecutionTool(QStringLiteral("cpp"), std::filesystem::path(argv[2]));
    shell.configureExecutionTool(QStringLiteral("java"), std::filesystem::path(argv[3]));
    shell.configureExecutionTool(QStringLiteral("python"), std::filesystem::path(argv[4]));
    shell.configureExecutionTool(QStringLiteral("javascript"), std::filesystem::path(argv[5]));
    assert(!shell.hasActiveAccount());
    shell.registerAccount(QStringLiteral("Qt Fixture"), QStringLiteral("qt@example.test"),
        QStringLiteral("Test-Password-123!"));
    wait_for([&] { return !shell.accountBusy(); });
    assert(shell.hasActiveAccount() && !shell.accountName().isEmpty());
    shell.logout();
    assert(!shell.hasActiveAccount());
    shell.login(QStringLiteral("qt@example.test"), QStringLiteral("Test-Password-123!"));
    wait_for([&] { return !shell.accountBusy(); });
    assert(shell.hasActiveAccount());
    shell.configureAccountStorage(workspace, data);
    shell.openPublishedContent(0);
    wait_for([&] { return !shell.contentBusy(); });
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
      wait_for([&] { return !shell.executionBusy(); });
      assert(shell.executionOutput() == expected);
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
    wait_for([&] { return !shell.executionBusy(); });
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
    wait_for([&] { return !shell.executionBusy(); });
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
    shell.logout();
    assert(!shell.hasActiveAccount());
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
    wait_for([&] { return shell.setAccountContext(second, workspace, data); });
    wait_for([&] { return !shell.contentBusy(); });
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
  std::cout << "Qt facade: account isolation, revisions, persistence, failures and shutdown passed\n";
}
