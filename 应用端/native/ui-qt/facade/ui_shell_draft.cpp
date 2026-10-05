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

bool UiShell::allowDocumentChange() {
  if (!draftDirty()) return true;
  setStatus(QStringLiteral("请先保存草稿，或明确放弃未保存的修改"));
  return false;
}

void UiShell::clearDraft() {
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

bool UiShell::setAccountContext(const codeweave::account::AccountService& session,
    const std::filesystem::path& workspace, const std::filesystem::path& nativeDataRoot) {
  if (content_busy_ || draft_saving_ || backend_tasks_.busy() || !allowDocumentChange()) return false;
  std::filesystem::path account_root;
  const auto resolved = session.learning_data_root(nativeDataRoot, account_root);
  if (!resolved.ok) { setStatus(QString::fromUtf8(resolved.message)); return false; }
  active_account_id_ = QString::fromUtf8(session.current()->id);
  ++account_generation_;
  workspace_root_ = workspace;
  data_root_ = account_root;
  // All core I/O runs on the serial worker. The previous core is idle here.
  personal_core_ = std::make_shared<codeweave::app::ApplicationCore>();
  clearDraft();
  emit accountChanged();
  if (hasSelectedContent()) loadStarterCode();
  return true;
}

bool UiShell::clearAccountContext() {
  if (content_busy_ || draft_saving_ || backend_tasks_.busy() || !allowDocumentChange()) return false;
  active_account_id_.clear();
  ++account_generation_;
  workspace_root_.clear();
  data_root_.clear();
  personal_core_.reset();
  clearDraft();
  emit accountChanged();
  return true;
}

void UiShell::discardDraftChanges() {
  if (content_busy_ || draft_saving_) return;
  updateDraftCode(draft_saved_code_);
}

bool UiShell::requestClose() {
  if (content_busy_ || draft_saving_) {
    setStatus(QStringLiteral("后台任务正在完成，请稍后关闭"));
    return false;
  }
  return allowDocumentChange();
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
  request.task_id = QStringLiteral("qt-draft-load-%1").arg(next_task_id_++).toStdString();
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
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, loaded, document, account, generation](codeweave::backend::TaskResult result) {
    QMetaObject::invokeMethod(this, [this, loaded, document, account, generation, result] {
      if (account != active_account_id_ || generation != account_generation_ || document != selected_content_id_) return;
      content_busy_ = false;
      if (result.result.ok) {
        draft_code_ = loaded->code;
        draft_saved_code_ = loaded->code;
        saved_revision_ = ++draft_revision_;
        draft_persistence_blocked_ = false;
        emit draftChanged();
        emit draftDirtyChanged();
      }
      emit contentBusyChanged();
      emit draftPersistenceBlockedChanged();
      setStatus(QString::fromUtf8(result.result.message));
    }, Qt::QueuedConnection);
  });
  if (!submitted.ok) {
    content_busy_ = false;
    emit contentBusyChanged();
    setStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::saveDraft() {
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
  request.task_id = QStringLiteral("qt-draft-save-%1").arg(next_task_id_++).toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Draft;
  request.work = [core, document, code](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("草稿保存已取消");
    return core->save_draft(storage_id(document), code.toUtf8().toStdString());
  };
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, document, account, generation, revision, code](codeweave::backend::TaskResult result) {
    QMetaObject::invokeMethod(this, [this, document, account, generation, revision, code, result] {
      if (account != active_account_id_ || generation != account_generation_ || document != selected_content_id_) return;
      draft_saving_ = false;
      emit draftSavingChanged();
      if (result.result.ok) {
        draft_saved_code_ = code;
        saved_revision_ = revision;
        emit draftDirtyChanged();
        setStatus(draftDirty() ? QStringLiteral("已保存提交时的草稿，当前编辑仍未保存") : QStringLiteral("草稿已保存"));
      } else {
        setStatus(QString::fromUtf8(result.result.message));
      }
    }, Qt::QueuedConnection);
  });
  if (!submitted.ok) {
    draft_saving_ = false;
    emit draftSavingChanged();
    setStatus(QString::fromUtf8(submitted.message));
  }
}
