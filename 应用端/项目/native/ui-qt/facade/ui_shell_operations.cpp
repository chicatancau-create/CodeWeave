#include "ui_shell.hpp"

#include "backup_service.hpp"
#include "content_repository.hpp"
#include "evidence_store.hpp"
#include "external_evidence_service.hpp"
#include "process_contract.hpp"
#include "trace_store.hpp"
#include "challenge_service.hpp"
#include "legacy_import.hpp"

#include <QMetaObject>
#include <QDate>
#include <QDateTime>
#include <QUuid>

#include <fstream>
#include <memory>
#include <string>

namespace {
QString normalized_output(const std::string& value) {
  return QString::fromUtf8(value).replace(QStringLiteral("\r\n"), QStringLiteral("\n"))
      .replace(QChar('\r'), QChar('\n'));
}

struct ProgressSource {
  bool found{};
  std::string markdown;
};

ProgressSource read_progress_source(const std::filesystem::path& workspace) {
  if (workspace.empty()) return {};
  for (const auto& name : {std::filesystem::path("progress.md"),
                           std::filesystem::path(L"学习进度.md")}) {
    const auto path = workspace / name;
    std::error_code error;
    const auto status = std::filesystem::symlink_status(path, error);
    if (error || status.type() == std::filesystem::file_type::not_found) continue;
    if (std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status)) continue;
    const auto size = std::filesystem::file_size(path, error);
    if (error || size > 4 * 1024 * 1024) continue;
    std::ifstream input(path, std::ios::binary);
    if (!input) continue;
    std::string markdown(static_cast<std::size_t>(size), '\0');
    input.read(markdown.data(), static_cast<std::streamsize>(markdown.size()));
    if (!input && !input.eof()) continue;
    return {true, std::move(markdown)};
  }
  return {};
}

QString projection_status(codeweave::learning::ProgressStatus status) {
  switch (status) {
    case codeweave::learning::ProgressStatus::Ok: return QStringLiteral("ok");
    case codeweave::learning::ProgressStatus::Partial: return QStringLiteral("partial");
    case codeweave::learning::ProgressStatus::StructureUnsupported:
      return QStringLiteral("unsupported");
  }
  return QStringLiteral("unsupported");
}

std::string utc_timestamp() {
  return QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs).toStdString();
}

void normalize_local_day(std::string& timestamp) {
  auto parsed = QDateTime::fromString(QString::fromStdString(timestamp), Qt::ISODateWithMs);
  if (!parsed.isValid()) parsed = QDateTime::fromString(QString::fromStdString(timestamp), Qt::ISODate);
  if (parsed.isValid())
    timestamp = parsed.toLocalTime().date().toString(Qt::ISODate).toStdString();
}

std::string operation_id_for(const char* prefix) {
  const auto value = QUuid::createUuid().toString(QUuid::Id128).toStdString();
  return std::string("op-") + prefix + "-" + value.substr(0, 6);
}

QString plan_source_text(codeweave::learning::ReviewPlanSource source) {
  switch (source) {
    case codeweave::learning::ReviewPlanSource::Unit: return QStringLiteral("unit");
    case codeweave::learning::ReviewPlanSource::Published: return QStringLiteral("published");
    case codeweave::learning::ReviewPlanSource::Fallback: return QStringLiteral("fallback");
  }
  return QStringLiteral("fallback");
}
}

void UiShell::setIndependentAttempt(bool value) {
  const bool accepted = value && !hints_viewed_;
  if (accepted == independent_attempt_) return;
  independent_attempt_ = accepted;
  emit independentAttemptChanged();
}

void UiShell::setOperationStatus(const QString& status) {
  operation_status_ = status;
  emit operationStatusChanged();
}

void UiShell::setExecutionTimeout(int milliseconds) {
  if (execution_busy_) return;
  if (milliseconds < 100 || milliseconds > 120000) {
    setOperationStatus(QStringLiteral("执行超时必须在 100–120000 毫秒之间"));
    return;
  }
  execution_timeout_ = milliseconds;
  emit executionOptionsChanged();
}

void UiShell::openFreeProgram(const QString& language) {
  if (content_busy_ || draft_saving_ || !allowDocumentChange()) return;
  if (language != "cpp" && language != "java" && language != "python" && language != "javascript") {
    setOperationStatus(QStringLiteral("不支持的自由编程语言"));
    return;
  }
  clearDraft();
  selected_content_index_ = -1;
  selected_content_id_ = QStringLiteral("free-") + language;
  starter_language_ = language;
  execution_policy_ = QStringLiteral("native");
  starter_code_ = language == "cpp" ? QStringLiteral("#include <iostream>\nint main() { std::cout << \"Hello\\n\"; }\n") :
      language == "java" ? QStringLiteral("class Main { public static void main(String[] args) { System.out.println(\"Hello\"); } }\n") :
      language == "python" ? QStringLiteral("print('Hello')\n") : QStringLiteral("console.log('Hello');\n");
  draft_baseline_ = draft_code_ = draft_saved_code_ = starter_code_;
  emit selectedContentChanged();
  emit starterCodeChanged();
  emit draftChanged();
  if (hasActiveAccount()) loadAccountDraft();
  selectPage(QStringLiteral("编辑器"));
}

void UiShell::requestToolSelection() {
  if (!closing_ && !backend_tasks_.busy() && !starter_language_.isEmpty())
    emit toolSelectionRequested(starter_language_);
}

void UiShell::requestDataAction(const QString& action) {
  if (closing_ || backend_tasks_.busy() || draftDirty()) {
    setOperationStatus(QStringLiteral("请先保存草稿并等待当前任务完成"));
    return;
  }
  if (action != "backup" && action != "restore" && action != "import-users" &&
      action != "import-learning" && action != "open") return;
  if (!hasActiveAccount()) { setOperationStatus(QStringLiteral("请先登录")); return; }
  emit dataActionRequested(action);
}

bool UiShell::performDataAction(const QString& action, const std::filesystem::path& source,
    const std::filesystem::path& target) {
  if (action == "backup") return createBackup(native_data_root_, target);
  if (action == "restore") return restoreBackup(source, target);
  if (closing_ || backend_tasks_.busy() || !hasActiveAccount() ||
      (action != "import-users" && action != "import-learning")) return false;
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-import-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.kind = codeweave::backend::TaskKind::Import;
  const auto account = active_account_id_.toStdString();
  request.account_id = account;
  request.account_generation = account_generation_;
  request.work = [source, target, action, account](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("导入已取消");
    codeweave::migration::LegacyImportReport report;
    return action == "import-users" ? codeweave::migration::import_legacy_users(source, target, report) :
        codeweave::migration::import_legacy_learning(source, account, target, report);
  };
  operation_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request), [this, target, task_name](auto result) {
    QMetaObject::invokeMethod(this, [this, target, task_name, result] {
      if (task_name != operation_task_id_) return;
      operation_task_id_.clear();
      operation_busy_ = false;
      emit operationBusyChanged();
      if (result.cancelled) {
        setOperationStatus(QStringLiteral("导入已取消"));
        return;
      }
      setOperationStatus(QString::fromUtf8(result.result.message) +
          (result.result.ok ? QStringLiteral("\n新目录：") + QString::fromStdWString(target.wstring()) : QString()));
    }, Qt::QueuedConnection);
  });
  if (!submitted.ok) {
    operation_task_id_.clear();
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
  return submitted.ok;
}

void UiShell::refreshReviewSummary() {
  if (closing_ || operation_busy_ || execution_busy_ || account_busy_ || !hasActiveAccount()) {
    setOperationStatus(QStringLiteral("请先登录，并等待当前任务完成"));
    return;
  }
  const auto root = data_root_;
  const auto workspace = workspace_root_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto today_date = QDate::currentDate();
  const auto today = today_date.toString(Qt::ISODate).toStdString();
  const auto first_day = today_date.addDays(-6).toString(Qt::ISODate).toStdString();
  const auto summary = std::make_shared<codeweave::learning::ReviewSummary>();
  const auto projection = std::make_shared<codeweave::learning::ProgressProjection>();
  const auto projection_found = std::make_shared<bool>(false);
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-review-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Read;
  const auto analysis = std::make_shared<codeweave::learning::AnalysisWindowSummary>();
  request.work = [root, workspace, today, first_day, summary, projection, projection_found,
      analysis](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("复习读取已取消");
    const codeweave::learning::EvidenceStore evidence(root);
    const codeweave::learning::ProgressStore progress(root);
    codeweave::learning::MasteryStore mastery(root);
    const auto result = codeweave::learning::ReviewService(evidence, progress, &mastery)
        .summarize(*summary, today, codeweave::learning::ReviewPlan{});
    if (!result.ok) return result;
    std::vector<codeweave::learning::EvidenceRecord> evidence_records;
    std::vector<codeweave::learning::MasteryEvidence> mastery_records;
    const auto evidence_read = evidence.read_all(evidence_records);
    if (!evidence_read.ok) return evidence_read;
    const auto mastery_read = mastery.read_all(mastery_records);
    if (!mastery_read.ok) return mastery_read;
    for (auto& record : evidence_records) normalize_local_day(record.at);
    for (auto& record : mastery_records) normalize_local_day(record.at);
    *analysis = codeweave::learning::summarize_analysis_window(
        evidence_records, mastery_records, first_day, today);
    const auto source = read_progress_source(workspace);
    if (source.found) {
      *projection_found = true;
      *projection = codeweave::learning::parse_progress(source.markdown);
    }
    return result;
  };
  operation_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation, summary, projection, projection_found, analysis, task_name](
          codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation, summary,
            projection, projection_found, analysis, task_name, result = std::move(result)] {
          if (task_name != operation_task_id_) return;
          operation_task_id_.clear();
          operation_busy_ = false;
          emit operationBusyChanged();
          if (account != active_account_id_ || generation != account_generation_) return;
          if (result.cancelled) {
            setOperationStatus(QStringLiteral("复习读取已取消"));
            return;
          }
          progress_summary_.clear();
          review_summary_.clear();
          review_items_.clear();
          analysis_snapshot_.clear();
          if (result.result.ok) {
            progress_summary_ = QStringLiteral("正式进度事实：%1 条（仅独立完成挑战计入）")
                .arg(summary->progress_count);
            review_summary_ = QStringLiteral("证据 %1 条，通过 %2 次，独立通过 %3 次\n"
                "逾期 %4 项，今日 %5 项，未来 7 天 %6 项\n")
                .arg(summary->evidence_count).arg(summary->passed_count)
                .arg(summary->independent_passed_count).arg(summary->overdue_count)
                .arg(summary->today_count).arg(summary->upcoming_count);
            for (const auto& item : summary->items) {
              QVariantMap dto;
              dto.insert(QStringLiteral("itemId"), QString::fromUtf8(item.content_id));
              dto.insert(QStringLiteral("contentId"), QString::fromUtf8(item.content_id));
              dto.insert(QStringLiteral("exerciseId"), QString::fromUtf8(item.exercise_id));
              dto.insert(QStringLiteral("latestAt"), QString::fromUtf8(item.latest_at));
              dto.insert(QStringLiteral("latestResult"), QString::fromUtf8(item.latest_result));
              dto.insert(QStringLiteral("passed"), item.passed);
              dto.insert(QStringLiteral("independent"), item.independent);
              dto.insert(QStringLiteral("hintLevel"), QString::fromUtf8(item.hint_level));
              dto.insert(QStringLiteral("evidenceCount"), static_cast<qulonglong>(item.evidence_count));
              dto.insert(QStringLiteral("dueKey"), QString::fromUtf8(item.due_key));
              dto.insert(QStringLiteral("nextNodeIndex"), static_cast<qulonglong>(item.next_node_index));
              dto.insert(QStringLiteral("masteryLevel"), item.mastery_level);
              dto.insert(QStringLiteral("planSource"), plan_source_text(item.plan_source));
              dto.insert(QStringLiteral("group"), QString::fromUtf8(item.group));
              dto.insert(QStringLiteral("forgettingRisk"), QString::fromUtf8(item.forgetting_risk));
              review_items_.push_back(std::move(dto));
            }
            for (const auto& item : summary->items) {
              review_summary_ += QStringLiteral("\n%1 / %2 · %3 · %4\n%5\n")
                  .arg(QString::fromUtf8(item.content_id), QString::fromUtf8(item.exercise_id),
                      QString::fromUtf8(item.latest_at), item.passed ? QStringLiteral("输出通过") : QStringLiteral("待复习"),
                      QString::fromUtf8(item.latest_result));
            }
            analysis_snapshot_.insert(QStringLiteral("completedUnits"),
                static_cast<qulonglong>(analysis->completed_units));
            analysis_snapshot_.insert(QStringLiteral("practiceCount"),
                static_cast<qulonglong>(analysis->practice_count));
            analysis_snapshot_.insert(QStringLiteral("verifiedPasses"),
                static_cast<qulonglong>(analysis->challenge_passes));
            analysis_snapshot_.insert(QStringLiteral("independentPasses"),
                static_cast<qulonglong>(summary->independent_passed_count));
            analysis_snapshot_.insert(QStringLiteral("reviewPassed"),
                static_cast<qulonglong>(analysis->review_passed));
            analysis_snapshot_.insert(QStringLiteral("reviewFailed"),
                static_cast<qulonglong>(analysis->review_failed));
            analysis_snapshot_.insert(QStringLiteral("reviewDueCount"),
                static_cast<qulonglong>(summary->overdue_count + summary->today_count));
            analysis_snapshot_.insert(QStringLiteral("reviewOverdueCount"),
                static_cast<qulonglong>(summary->overdue_count));
            analysis_snapshot_.insert(QStringLiteral("reviewTodayCount"),
                static_cast<qulonglong>(summary->today_count));
            analysis_snapshot_.insert(QStringLiteral("reviewFuture7Days"),
                static_cast<qulonglong>(summary->upcoming_count));
            analysis_snapshot_.insert(QStringLiteral("reviewNext7Days"),
                static_cast<qulonglong>(summary->upcoming_count));
            analysis_snapshot_.insert(QStringLiteral("reviewScheduledCount"),
                static_cast<qulonglong>(summary->overdue_count + summary->today_count +
                    summary->upcoming_count));
            analysis_snapshot_.insert(QStringLiteral("streakDays"), QStringLiteral("暂无数据"));
            analysis_snapshot_.insert(QStringLiteral("todayCheckin"), QStringLiteral("暂无数据"));
            analysis_snapshot_.insert(QStringLiteral("projectionStatus"),
                *projection_found ? projection_status(projection->status) : QStringLiteral("unavailable"));
            analysis_snapshot_.insert(QStringLiteral("projectionLatestEvidence"),
                *projection_found && !projection->latest_evidence_on.empty()
                    ? QString::fromUtf8(projection->latest_evidence_on)
                    : QStringLiteral("暂无数据"));
            analysis_snapshot_.insert(QStringLiteral("projectionMasteryCount"),
                static_cast<qulonglong>(projection->mastery.size()));
            analysis_snapshot_.insert(QStringLiteral("projectionStageCount"),
                static_cast<qulonglong>(projection->stages.size()));
          }
          emit reviewSummaryChanged();
          emit reviewItemsChanged();
          setOperationStatus(QString::fromUtf8(result.result.message));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    operation_task_id_.clear();
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::reviewItem(const QString& itemId, bool passed, const QString& note) {
  if (closing_ || operation_busy_ || execution_busy_ || account_busy_ || !hasActiveAccount()) {
    setOperationStatus(QStringLiteral("请先登录，并等待当前任务完成"));
    return;
  }
  const auto item = itemId.trimmed();
  if (item.isEmpty()) {
    setOperationStatus(QStringLiteral("复测项目标识不能为空"));
    return;
  }
  const auto root = data_root_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto operation_id = operation_id_for("review");
  const auto evidence_id = "review-" + operation_id.substr(3);
  const auto timestamp = utc_timestamp();
  const auto review_note = note.toUtf8().toStdString();
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-review-record-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Evidence;
  request.work = [root, item, passed, review_note, operation_id, evidence_id, timestamp](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("复测提交已取消");
    codeweave::learning::MasteryStore store(root);
    codeweave::learning::MasteryEvidence evidence{
        evidence_id, codeweave::learning::MasteryEvidenceKind::Review,
        item.toUtf8().toStdString(), review_note, timestamp, passed,
        codeweave::learning::CompletionVerification::SelfDeclared,
        codeweave::learning::RanBy::Learner, true, "L1", operation_id};
    bool duplicate = false;
    codeweave::learning::MasterySnapshot snapshot;
    return codeweave::learning::MasteryService(store).record_evidence(
        evidence, codeweave::learning::ReviewPlan{}, duplicate, snapshot);
  };
  operation_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation, task_name](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation, task_name,
            result = std::move(result)]() mutable {
          if (task_name != operation_task_id_) return;
          operation_task_id_.clear();
          operation_busy_ = false;
          emit operationBusyChanged();
          if (account != active_account_id_ || generation != account_generation_) return;
          setOperationStatus(result.cancelled ? QStringLiteral("复测提交已取消")
                                              : QString::fromUtf8(result.result.message));
          if (result.result.ok) refreshReviewSummary();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    operation_task_id_.clear();
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::snoozeReview(const QString& itemId) {
  if (closing_ || operation_busy_ || execution_busy_ || account_busy_ || !hasActiveAccount()) {
    setOperationStatus(QStringLiteral("请先登录，并等待当前任务完成"));
    return;
  }
  const auto item = itemId.trimmed();
  if (item.isEmpty()) {
    setOperationStatus(QStringLiteral("复测项目标识不能为空"));
    return;
  }
  const auto root = data_root_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto operation_id = operation_id_for("snooze");
  const auto evidence_id = "snooze-" + operation_id.substr(3);
  const auto timestamp = utc_timestamp();
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-review-snooze-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Evidence;
  request.work = [root, item, operation_id, evidence_id, timestamp](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("复习延期已取消");
    codeweave::learning::MasteryStore store(root);
    codeweave::learning::MasteryEvidence evidence{
        evidence_id, codeweave::learning::MasteryEvidenceKind::Snooze,
        item.toUtf8().toStdString(), "用户将复习延期一天", timestamp, false,
        codeweave::learning::CompletionVerification::SelfDeclared,
        codeweave::learning::RanBy::Learner, false, "L4", operation_id};
    bool duplicate = false;
    codeweave::learning::MasterySnapshot snapshot;
    return codeweave::learning::MasteryService(store).record_evidence(
        evidence, codeweave::learning::ReviewPlan{}, duplicate, snapshot);
  };
  operation_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation, task_name](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation, task_name,
            result = std::move(result)]() mutable {
          if (task_name != operation_task_id_) return;
          operation_task_id_.clear();
          operation_busy_ = false;
          emit operationBusyChanged();
          if (account != active_account_id_ || generation != account_generation_) return;
          setOperationStatus(result.cancelled ? QStringLiteral("复习延期已取消")
                                              : QString::fromUtf8(result.result.message));
          if (result.result.ok) refreshReviewSummary();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    operation_task_id_.clear();
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::loadHints() {
  if (closing_ || content_busy_ || operation_busy_ || selected_content_id_.isEmpty() || content_root_.isEmpty()) return;
  content_busy_ = true;
  emit contentBusyChanged();
  const auto root = std::filesystem::path(content_root_.toStdWString());
  const auto document = selected_content_id_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto hints = std::make_shared<QString>();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-hints-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Read;
  request.work = [root, document, hints](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("提示读取已取消");
    std::string value;
    const auto result = codeweave::content::ContentRepository(root).read_hints(
        document.toStdString(), value);
    if (result.ok) *hints = QString::fromUtf8(value);
    return result;
  };
  content_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, hints, account, generation, task_name](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, hints, account, generation,
            task_name, result = std::move(result)]() mutable {
          if (task_name != content_task_id_) return;
          content_task_id_.clear();
          content_busy_ = false;
          emit contentBusyChanged();
          if (account != active_account_id_ || generation != account_generation_) {
            return;
          }
          if (result.cancelled) {
            setOperationStatus(QStringLiteral("提示读取已取消"));
            return;
          }
          if (result.result.ok) {
            hints_ = *hints;
            hints_viewed_ = true;
            setIndependentAttempt(false);
            emit hintsChanged();
            setOperationStatus(QStringLiteral("提示已读取；使用提示不会自动计入独立完成"));
          } else {
            setOperationStatus(QString::fromUtf8(result.result.message));
          }
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    content_task_id_.clear();
    content_busy_ = false;
    emit contentBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::saveExternalEvidence(const QString& environment, const QString& command,
    const QString& summary, const QString& artifactRef, const QString& reproducedOn) {
  if (closing_ || operation_busy_ || !hasActiveAccount() || selected_content_id_.isEmpty() || content_busy_ || draft_saving_) {
    setOperationStatus(QStringLiteral("请先登录并选择课程"));
    return;
  }
  const auto root = data_root_;
  const auto document = selected_content_id_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto unique = QUuid::createUuid().toString(QUuid::Id128).toStdString();
  const auto operation_id = "op-" + unique.substr(0, 20) + "-" + unique.substr(26);
  const auto evidence_id = "qt-evidence-" + unique;
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-evidence-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Evidence;
  request.work = [root, document, environment, command, summary, artifactRef, reproducedOn,
      operation_id, evidence_id](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("外部证据提交已取消");
    codeweave::learning::EvidenceStore store(root);
    const codeweave::learning::ExternalEvidenceFields fields{
        environment.toUtf8().toStdString(), command.toUtf8().toStdString(),
        summary.toUtf8().toStdString(), artifactRef.toUtf8().toStdString(),
        reproducedOn.toUtf8().toStdString()};
    return codeweave::learning::save_external_evidence(store, document.toStdString(), fields,
        operation_id, evidence_id);
  };
  operation_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation, task_name](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation, task_name,
            result = std::move(result)]() mutable {
          if (task_name != operation_task_id_) return;
          operation_task_id_.clear();
          operation_busy_ = false;
          emit operationBusyChanged();
          if (account != active_account_id_ || generation != account_generation_) return;
          setOperationStatus(result.cancelled ? QStringLiteral("外部证据提交已取消")
                                              : QString::fromUtf8(result.result.message));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    operation_task_id_.clear();
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::configureExecutionTool(const QString& language, const std::filesystem::path& tool) {
  const auto key = language.toStdString();
  if (key != "cpp" && key != "java" && key != "python" && key != "javascript") return;
  if (tool.empty()) {
    fprintf(stderr, "empty-before\n");
    execution_tools_.erase(key);
    fprintf(stderr, "empty-after\n");
    return;
  }
  const auto validation = codeweave::execution::validate_process_request(
      {tool, {}, tool.parent_path(), key});
  std::error_code error;
  if (!validation.ok || !tool.is_absolute() || !std::filesystem::is_regular_file(tool, error)) {
    execution_tools_.erase(key);
    return;
  }
  execution_tools_[key] = tool;
}

void UiShell::runCode() {
  if (closing_ || operation_busy_ || !hasActiveAccount() || execution_busy_ || starter_language_.isEmpty() ||
      execution_policy_ != QStringLiteral("native")) {
    setOperationStatus(QStringLiteral("当前课程不可在应用内运行，或尚未登录/读取代码"));
    return;
  }
  const auto tool_entry = execution_tools_.find(starter_language_.toStdString());
  if (tool_entry == execution_tools_.end()) {
    setOperationStatus(QStringLiteral("尚未配置该语言的执行工具"));
    return;
  }
  execution_busy_ = true;
  execution_cancelled_.store(false, std::memory_order_release);
  emit executionBusyChanged();
  const auto request_data = codeweave::execution::Request{
      (QStringLiteral("qt-run-") + QUuid::createUuid().toString(QUuid::Id128)).toStdString(),
      starter_language_.toStdString(), draft_code_.toUtf8().toStdString(),
      static_cast<std::uint32_t>(execution_timeout_), 1'048'576};
  const auto tool = tool_entry->second;
  const auto root = data_root_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto document = selected_content_id_.toStdString();
  const auto content_root = std::filesystem::path(content_root_.toStdWString());
  const auto independent = independent_attempt_ && !hints_viewed_;
  const auto hints_viewed = hints_viewed_;
  const auto challenge_status = std::make_shared<QString>();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-execute-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Execute;
  request.work = [request_data, tool, root, document, content_root, independent,
      hints_viewed, challenge_status, this](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("执行已取消");
    std::error_code directory_error;
    std::filesystem::create_directories(root / "execution", directory_error);
    if (directory_error) return codeweave::app::Result::failure("无法准备执行工作目录");
    const auto result = codeweave::execution::ExecutionService{}.run(
        request_data, tool, root / "execution", &execution_cancelled_, &execution_control_);
    if (result.trace) {
      const auto saved = codeweave::execution::TraceStore(root).append(*result.trace);
      if (!saved.ok) return saved;
    }
    if (!result.validation.ok) return result.validation;
    if (!result.process) return codeweave::app::Result::failure("执行没有返回进程结果");
    if (result.process->started && result.process->execution_output_valid &&
        !document.starts_with("free-")) {
      codeweave::content::ContentRepository repository(content_root);
      std::vector<codeweave::content::Exercise> exercises;
      const auto loaded = repository.list_exercises(document, exercises);
      if (!loaded.ok) return loaded;
      if (!exercises.empty()) {
        const auto& exercise = exercises.front();
        codeweave::learning::EvidenceStore evidence(root);
        codeweave::learning::ProgressStore progress(root);
        const auto unique = QUuid::createUuid().toString(QUuid::Id128).toStdString();
        const auto suffix = unique.substr(unique.size() - 6);
        const codeweave::learning::ChallengeRequest challenge{
            "qt-evidence-" + unique, document, exercise.exercise_id,
            QDate::currentDate().toString(Qt::ISODate).toStdString(), exercise.expected_output,
            "op-" + unique.substr(0, 20) + "-" + suffix,
            independent, hints_viewed ? "L3" : exercise.hint_level};
        const auto recorded = codeweave::learning::ChallengeService(evidence, progress)
            .record_execution(challenge, *result.process);
        if (!recorded.validation.ok) return recorded.validation;
        *challenge_status = QString::fromUtf8(recorded.validation.message);
      }
    }
    if (result.process->started && result.process->exit_code == 0 &&
        result.process->error_code.empty() && !result.process->cancelled &&
        !result.process->timed_out && result.process->execution_output_valid) {
      return codeweave::app::Result::success(normalized_output(result.process->output).toUtf8().toStdString());
    }
    if (result.process->cancelled) return codeweave::app::Result::failure("执行已取消");
    if (result.process->timed_out) return codeweave::app::Result::failure("执行超时");
    if (result.process->output_truncated) return codeweave::app::Result::failure("执行输出超过上限");
    if (!result.process->error_code.empty()) {
      return codeweave::app::Result::failure(result.process->error_code);
    }
    return codeweave::app::Result::failure(
        "执行失败，退出码 " + std::to_string(result.process->exit_code));
  };
  execution_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation, challenge_status, task_name](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation, challenge_status,
            task_name, result = std::move(result)]() mutable {
          if (task_name != execution_task_id_) return;
          execution_task_id_.clear();
          execution_busy_ = false;
          emit executionBusyChanged();
          if (account != active_account_id_ || generation != account_generation_) return;
          execution_output_ = QString::fromUtf8(result.result.message);
          emit executionOutputChanged();
          if (result.cancelled) {
            setOperationStatus(QStringLiteral("执行已取消"));
          } else if (!challenge_status->isEmpty()) {
            setOperationStatus(*challenge_status);
          } else {
            setOperationStatus(result.result.ok ? QStringLiteral("执行完成")
                                                : QStringLiteral("执行失败"));
          }
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    execution_task_id_.clear();
    execution_busy_ = false;
    emit executionBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::cancelExecution() {
  execution_cancelled_.store(true, std::memory_order_release);
  setOperationStatus(QStringLiteral("已请求取消执行"));
}

void UiShell::pauseExecution() {
  if (!execution_busy_) { setOperationStatus(QStringLiteral("当前没有运行中的代码")); return; }
  const auto result = execution_control_.request(codeweave::execution::ControlCommand::Pause);
  setOperationStatus(QString::fromUtf8(result.message));
  if (result.ok) emit executionStateChanged();
}

void UiShell::resumeExecution() {
  if (!execution_busy_) { setOperationStatus(QStringLiteral("当前没有运行中的代码")); return; }
  const auto result = execution_control_.request(codeweave::execution::ControlCommand::Resume);
  setOperationStatus(QString::fromUtf8(result.message));
  if (result.ok) emit executionStateChanged();
}

void UiShell::stepExecution() {
  if (!execution_busy_) { setOperationStatus(QStringLiteral("当前没有运行中的代码")); return; }
  const auto result = execution_control_.request(codeweave::execution::ControlCommand::Step);
  setOperationStatus(QString::fromUtf8(result.message));
  if (result.ok) emit executionStateChanged();
}

bool UiShell::createBackup(const std::filesystem::path& source,
    const std::filesystem::path& target) {
  if (closing_ || operation_busy_ || backend_tasks_.busy() || !hasActiveAccount()) return false;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-backup-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Backup;
  request.work = [source, target](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("备份已取消");
    codeweave::backup::Report report;
    return codeweave::backup::create_native_backup(source, target, report);
  };
  operation_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation, task_name](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation, task_name,
            result = std::move(result)]() mutable {
          if (task_name != operation_task_id_) return;
          operation_task_id_.clear();
          operation_busy_ = false;
          emit operationBusyChanged();
          if (account != active_account_id_ || generation != account_generation_) return;
          setOperationStatus(result.cancelled ? QStringLiteral("备份已取消")
                                              : QString::fromUtf8(result.result.message));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    operation_task_id_.clear();
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
  return submitted.ok;
}

bool UiShell::restoreBackup(const std::filesystem::path& backup,
    const std::filesystem::path& target) {
  if (closing_ || operation_busy_ || backend_tasks_.busy() || !hasActiveAccount()) return false;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-restore-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Backup;
  request.work = [backup, target](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("恢复已取消");
    codeweave::backup::Report report;
    return codeweave::backup::restore_native_backup(backup, target, report);
  };
  operation_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation, task_name](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation, task_name,
            result = std::move(result)]() mutable {
          if (task_name != operation_task_id_) return;
          operation_task_id_.clear();
          operation_busy_ = false;
          emit operationBusyChanged();
          if (account != active_account_id_ || generation != account_generation_) return;
          setOperationStatus(result.cancelled ? QStringLiteral("恢复已取消")
                                              : QString::fromUtf8(result.result.message));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    operation_task_id_.clear();
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
  return submitted.ok;
}
