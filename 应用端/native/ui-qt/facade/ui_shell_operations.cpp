#include "ui_shell.hpp"

#include "backup_service.hpp"
#include "content_repository.hpp"
#include "evidence_store.hpp"
#include "external_evidence_service.hpp"
#include "process_contract.hpp"
#include "trace_store.hpp"

#include <QMetaObject>

#include <memory>
#include <string>

namespace {
QString normalized_output(const std::string& value) {
  return QString::fromUtf8(value).replace(QStringLiteral("\r\n"), QStringLiteral("\n"))
      .replace(QChar('\r'), QChar('\n'));
}
}

void UiShell::setOperationStatus(const QString& status) {
  operation_status_ = status;
  emit operationStatusChanged();
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
  request.task_id = QStringLiteral("qt-hints-%1").arg(next_task_id_++).toStdString();
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
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, hints, account, generation](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, hints, account, generation,
            result = std::move(result)]() mutable {
          if (account != active_account_id_ || generation != account_generation_) {
            content_busy_ = false;
            emit contentBusyChanged();
            return;
          }
          content_busy_ = false;
          emit contentBusyChanged();
          if (result.result.ok) {
            hints_ = *hints;
            emit hintsChanged();
            setOperationStatus(QStringLiteral("提示已读取；使用提示不会自动计入独立完成"));
          } else {
            setOperationStatus(QString::fromUtf8(result.result.message));
          }
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
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
  const auto operation_id = QStringLiteral("op-qtexternal-%1").arg(
      static_cast<qulonglong>(next_task_id_), 6, 16, QLatin1Char('0')).toStdString();
  const auto evidence_id = QStringLiteral("qt-evidence-%1").arg(
      static_cast<qulonglong>(next_task_id_)).toStdString();
  operation_busy_ = true;
  emit operationBusyChanged();
  codeweave::backend::TaskRequest request;
  request.task_id = QStringLiteral("qt-evidence-%1").arg(next_task_id_++).toStdString();
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
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation,
            result = std::move(result)]() mutable {
          if (account != active_account_id_ || generation != account_generation_) {
            operation_busy_ = false;
            emit operationBusyChanged();
            return;
          }
          operation_busy_ = false;
          emit operationBusyChanged();
          setOperationStatus(QString::fromUtf8(result.result.message));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    operation_busy_ = false;
    emit operationBusyChanged();
    setOperationStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::configureExecutionTool(const QString& language, const std::filesystem::path& tool) {
  const auto key = language.toStdString();
  if (key != "cpp" && key != "java" && key != "python" && key != "javascript") return;
  if (tool.empty()) {
    execution_tools_.erase(key);
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
      QStringLiteral("qt-run-%1").arg(next_task_id_++).toStdString(),
      starter_language_.toStdString(), draft_code_.toUtf8().toStdString(), 30'000, 1'048'576};
  const auto tool = tool_entry->second;
  const auto root = data_root_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  codeweave::backend::TaskRequest request;
  request.task_id = QStringLiteral("qt-execute-%1").arg(next_task_id_++).toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Execute;
  request.work = [request_data, tool, root, this](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("执行已取消");
    std::error_code directory_error;
    std::filesystem::create_directories(root / "execution", directory_error);
    if (directory_error) return codeweave::app::Result::failure("无法准备执行工作目录");
    const auto result = codeweave::execution::ExecutionService{}.run(
        request_data, tool, root / "execution", &execution_cancelled_, &execution_control_);
    if (result.trace) {
      codeweave::execution::TraceStore(root).append(*result.trace);
    }
    if (!result.validation.ok) return result.validation;
    if (!result.process) return codeweave::app::Result::failure("执行没有返回进程结果");
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
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, account, generation](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, account, generation,
            result = std::move(result)]() mutable {
          if (account != active_account_id_ || generation != account_generation_) return;
          execution_busy_ = false;
          emit executionBusyChanged();
          execution_output_ = QString::fromUtf8(result.result.message);
          emit executionOutputChanged();
          setOperationStatus(result.result.ok ? QStringLiteral("执行完成") : QStringLiteral("执行失败"));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
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
  request.task_id = QStringLiteral("qt-backup-%1").arg(next_task_id_++).toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Backup;
  request.work = [source, target](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("备份已取消");
    codeweave::backup::Report report;
    return codeweave::backup::create_native_backup(source, target, report);
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, result = std::move(result)]() mutable {
          operation_busy_ = false;
          emit operationBusyChanged();
          setOperationStatus(QString::fromUtf8(result.result.message));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) { operation_busy_ = false; emit operationBusyChanged(); setOperationStatus(QString::fromUtf8(submitted.message)); }
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
  request.task_id = QStringLiteral("qt-restore-%1").arg(next_task_id_++).toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Backup;
  request.work = [backup, target](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("恢复已取消");
    codeweave::backup::Report report;
    return codeweave::backup::restore_native_backup(backup, target, report);
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this](codeweave::backend::TaskResult result) {
        QMetaObject::invokeMethod(this, [this, result = std::move(result)]() mutable {
          operation_busy_ = false;
          emit operationBusyChanged();
          setOperationStatus(QString::fromUtf8(result.result.message));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) { operation_busy_ = false; emit operationBusyChanged(); setOperationStatus(QString::fromUtf8(submitted.message)); }
  return submitted.ok;
}
