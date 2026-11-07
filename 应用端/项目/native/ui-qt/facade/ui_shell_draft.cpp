#include "ui_shell.hpp"

#include <QCryptographicHash>
#include <QMetaObject>
#include <QStringDecoder>

namespace {
std::string storage_id(const QString& document) {
  // Same mapping as the existing Win32 product, including long content IDs.
  return "lesson-" + QCryptographicHash::hash(document.toUtf8(), QCryptographicHash::Sha256)
      .toHex().toStdString();
}

struct LoadedDraft {
  QString code;
};
}  // namespace

void UiShell::setStatus(const QString& status) {
  content_status_ = status;
  emit contentStatusChanged();
}

void UiShell::dismissContentStatus() {
  if (content_status_.isEmpty()) return;
  content_status_.clear();
  emit contentStatusChanged();
}

bool UiShell::allowDocumentChange() {
  if (closing_ || operation_busy_ || execution_busy_ || challenge_run_busy_ ||
      (challenge_history_busy_ && challenge_history_write_) ||
      (checkin_busy_ && checkin_write_) || account_busy_) return false;
  if (vault_busy_ && vault_write_) return false;
  if (!draftDirty()) return true;
  setStatus(QStringLiteral("请先保存草稿，或明确放弃未保存的修改"));
  return false;
}

void UiShell::clearDraft(bool accountChange) {
  lesson_expected_output_.clear();
  lesson_contract_ready_ = false;
  lesson_run_succeeded_ = false;
  independent_attempt_ = false;
  hints_viewed_ = false;
  emit independentAttemptChanged();
  hints_.clear();
  execution_output_.clear();
  execution_output_error_ = false;
  execution_trace_.clear();
  emit executionTraceChanged();
  // Account aggregates survive document changes, but never cross accounts.
  if (accountChange) {
    progress_summary_.clear();
    review_summary_.clear();
    review_items_.clear();
    analysis_snapshot_.clear();
    emit reviewSummaryChanged();
    emit reviewItemsChanged();
  }
  emit hintsChanged();
  emit executionOutputChanged();
  starter_language_.clear();
  starter_code_.clear();
  execution_policy_.clear();
  draft_code_.clear();
  draft_baseline_.clear();
  draft_saved_code_.clear();
  ++draft_revision_;
  saved_revision_ = draft_revision_;
  draft_persistence_blocked_ = false;
  emit starterCodeChanged();
  emit draftChanged();
  emit draftDirtyChanged();
  emit draftPersistenceBlockedChanged();
}

void UiShell::clearChallengeDrafts() {
  closeChallenge();
  challenge_drafts_.clear();
  challenge_run_result_.clear();
  challenge_submissions_.clear();
  challenge_history_status_.clear();
  challenge_history_task_id_.clear();
  challenge_history_busy_ = false;
  emit challengeHistoryChanged();
  emit challengeCodeChanged();
  emit challengeRunResultChanged();
}

bool UiShell::setAccountContext(const codeweave::account::AccountService& session,
    const std::filesystem::path& workspace, const std::filesystem::path& nativeDataRoot) {
  if (draft_saving_ || !allowDocumentChange()) return false;
  std::filesystem::path account_root;
  const auto resolved = session.learning_data_root(nativeDataRoot, account_root);
  if (!resolved.ok) { setStatus(QString::fromUtf8(resolved.message)); return false; }
  active_account_id_ = QString::fromUtf8(session.current()->id);
  native_data_root_ = nativeDataRoot;
  lesson_evidence_states_.clear();
  lesson_evidence_ready_ = false;
  ++account_generation_;
  execution_output_.clear();
  execution_output_error_ = false;
  emit executionOutputChanged();
  // Reads belong to the previous account/document. Invalidate their callbacks
  // before resetting the visible state; the worker may finish later.
  content_task_id_.clear();
  draft_task_id_.clear();
  content_busy_ = false;
  emit contentBusyChanged();
  workspace_root_ = workspace;
  data_root_ = account_root;
  // All core I/O runs on the serial worker. The previous core is idle here.
  personal_core_ = std::make_shared<codeweave::app::ApplicationCore>();
  clearCheckin();
  clearVaultWriteback();
  clearChallengeDrafts();
  clearDraft(true);
  emit accountChanged();
  if (hasSelectedContent()) loadStarterCode();
  refreshChallengeHistory();
  refreshCheckin();
  return true;
}

bool UiShell::clearAccountContext() {
  if (draft_saving_ || !allowDocumentChange()) return false;
  active_account_id_.clear();
  lesson_evidence_states_.clear();
  lesson_evidence_ready_ = false;
  ++account_generation_;
  execution_output_.clear();
  execution_output_error_ = false;
  emit executionOutputChanged();
  content_task_id_.clear();
  draft_task_id_.clear();
  content_busy_ = false;
  emit contentBusyChanged();
  // Keep the configured workspace and account registry root available for a
  // later login in the same process. Only the authenticated account root and
  // its core lock are cleared here.
  data_root_ = native_data_root_;
  personal_core_.reset();
  clearCheckin();
  clearVaultWriteback();
  clearChallengeDrafts();
  clearDraft(true);
  emit accountChanged();
  return true;
}

void UiShell::discardDraftChanges() {
  if (content_busy_ || draft_saving_) return;
  updateDraftCode(draft_saved_code_);
}

bool UiShell::requestClose() {
  if (vault_busy_ && vault_write_) {
    setStatus(QStringLiteral("资料库操作正在提交，请稍候再关闭"));
    return false;
  }
  if (checkin_busy_ && checkin_write_) {
    setStatus(QStringLiteral("打卡正在保存，请稍候再关闭"));
    return false;
  }
  if (draftDirty()) {
    setStatus(QStringLiteral("请先保存草稿，或明确放弃未保存的修改"));
    return false;
  }
  if (draft_saving_) {
    // 写提交中不取消：丢掉用户已经下达的持久化意图，比让他再点一次关闭更糟。
    setStatus(QStringLiteral("草稿正在提交，请稍候再关闭"));
    return false;
  }
  closing_ = true;
  execution_cancelled_.store(true, std::memory_order_release);
  if (content_busy_ || backend_tasks_.busy()) {
    // 读任务可以被取消；关闭时排空并保持事件泵，而不是无泵地阻塞 join，
    // 也不是简单拒绝关闭让用户对着一个转圈的窗口没办法。
    if (!drain_backend_tasks(5000)) {
      setStatus(QStringLiteral("后台任务未在限定时间内结束，已阻止关闭"));
      return false;
    }
    content_busy_ = false;
    emit contentBusyChanged();
  }
  return true;
}

void UiShell::loadAccountDraft() {
  if (!hasActiveAccount() || !personal_core_) return;
  content_busy_ = true;
  // Fail closed until the persisted document has been read successfully.
  draft_persistence_blocked_ = true;
  emit contentBusyChanged();
  emit draftPersistenceBlockedChanged();
  const auto core = personal_core_;
  const auto workspace = workspace_root_;
  const auto root = data_root_;
  const auto document = selected_content_id_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto loaded = std::make_shared<LoadedDraft>();
  loaded->code = starter_code_;
  codeweave::backend::TaskRequest request;
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Draft;
  request.work = [core, workspace, root, document, loaded](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("草稿读取已取消");
    if (!core->is_open()) {
      const auto opened = core->open_workspace(workspace, root);
      if (!opened.ok) return opened;
    }
    const auto id = storage_id(document);
    std::error_code error;
    const auto status = std::filesystem::symlink_status(root / "drafts" / (id + ".txt"), error);
    if (status.type() == std::filesystem::file_type::not_found &&
        (!error || error == std::errc::no_such_file_or_directory)) {
      return codeweave::app::Result::success("没有已保存草稿，使用起始代码");
    }
    if (error) return codeweave::app::Result::failure("读取草稿状态失败，已阻止覆盖");
    std::string value;
    const auto result = core->load_draft(id, value);
    if (!result.ok) return result;
    QStringDecoder decoder(QStringDecoder::Utf8);
    loaded->code = decoder.decode(QByteArray::fromStdString(value));
    if (decoder.hasError() || value.find('\0') != std::string::npos) {
      return codeweave::app::Result::failure("草稿不是有效的 UTF-8 文本，已阻止覆盖");
    }
    return result;
  };
  const auto task_name = QStringLiteral("qt-draft-load-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  draft_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, loaded, document, account, generation, task_name](codeweave::backend::TaskResult result) {
     QMetaObject::invokeMethod(this, [this, loaded, document, account, generation, task_name, result] {
       if (task_name != draft_task_id_) return;
       draft_task_id_.clear();
        content_busy_ = false;
       emit contentBusyChanged();
       if (account != active_account_id_ || generation != account_generation_ || document != selected_content_id_) return;
        if (result.result.ok) {
          draft_code_ = loaded->code;
          draft_saved_code_ = loaded->code;
          saved_revision_ = ++draft_revision_;
          draft_persistence_blocked_ = false;
          emit draftChanged();
          emit draftDirtyChanged();
        }
        emit draftPersistenceBlockedChanged();
        setStatus(result.cancelled ? QStringLiteral("草稿读取已取消")
                                   : QString::fromUtf8(result.result.message));
      }, Qt::QueuedConnection);
    });
  if (!submitted.ok) {
    draft_task_id_.clear();
    content_busy_ = false;
    emit contentBusyChanged();
    setStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::saveDraft() {
  if (closing_ || operation_busy_ || execution_busy_ || account_busy_) return;
  if (!hasActiveAccount()) { setStatus(QStringLiteral("保存草稿前必须先登录账户")); return; }
  if (selected_content_id_.isEmpty() || starter_language_.isEmpty()) {
    setStatus(QStringLiteral("没有选中的课程文档，无法保存草稿")); return;
  }
  if (content_busy_ || draft_saving_) return;
  if (draft_persistence_blocked_ || !personal_core_) {
    setStatus(QStringLiteral("草稿读取失败，已阻止覆盖")); return;
  }
  if (!draftDirty()) return;
  const auto core = personal_core_;
  const auto document = selected_content_id_;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto revision = draft_revision_;
  const auto code = draft_code_;
  draft_saving_ = true;
  emit draftSavingChanged();
  codeweave::backend::TaskRequest request;
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Draft;
  request.work = [core, document, code](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("草稿保存已取消");
    return core->save_draft(storage_id(document), code.toUtf8().toStdString());
  };
  const auto task_name = QStringLiteral("qt-draft-save-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  draft_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, document, account, generation, revision, code, task_name](codeweave::backend::TaskResult result) {
     QMetaObject::invokeMethod(this, [this, document, account, generation, revision, code, task_name, result] {
       if (task_name != draft_task_id_) return;
       draft_task_id_.clear();
        draft_saving_ = false;
        emit draftSavingChanged();
       if (account != active_account_id_ || generation != account_generation_ || document != selected_content_id_) return;
        if (result.result.ok) {
        // 执行器已保证：ok 意味着写盘确实发生。这里必须以它为准更新已保存基线，
        // 否则会出现「磁盘是新的、UI 说还有未保存修改」的分裂（§14.5）。
        draft_saved_code_ = code;
        saved_revision_ = revision;
        emit draftDirtyChanged();
        setStatus(draftDirty() ? QStringLiteral("已保存提交时的草稿，当前编辑仍未保存") : QStringLiteral("草稿已保存"));
        } else if (result.cancelled) {
        // 走到这里说明 work 在动手前就拒绝了执行，磁盘未被动过 —— 保持 dirty 才是对的。
        setStatus(QStringLiteral("草稿保存已取消，磁盘内容未改变"));
        } else {
          setStatus(QString::fromUtf8(result.result.message));
        }
      }, Qt::QueuedConnection);
    });
  if (!submitted.ok) {
    draft_task_id_.clear();
    draft_saving_ = false;
    emit draftSavingChanged();
    setStatus(QString::fromUtf8(submitted.message));
  }
}
