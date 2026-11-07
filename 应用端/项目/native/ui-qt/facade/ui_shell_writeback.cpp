#include "ui_shell.hpp"
#include "vault_writeback_store.hpp"

#include <QMetaObject>
#include <QFileInfo>

QVariantMap UiShell::vaultWriteback() const {
  auto state = vault_writeback_;
  state["connected"] = !vault_root_.empty();
  state["busy"] = vault_busy_;
  state["status"] = vault_status_;
  state["vaultName"] = QFileInfo(QString::fromStdWString(vault_root_.wstring())).fileName();
  return state;
}

void UiShell::clearVaultWriteback() {
  vault_task_id_.clear();
  vault_busy_ = false;
  vault_write_ = false;
  vault_writeback_.clear();
  vault_status_.clear();
  emit vaultWritebackChanged();
}

void UiShell::requestVaultSelection() {
  if (closing_ || !hasActiveAccount() || vault_busy_ || operation_busy_ || account_busy_) return;
  emit vaultSelectionRequested();
}

void UiShell::configureVaultRoot(const std::filesystem::path& root) {
  if (closing_ || vault_busy_ || operation_busy_ || account_busy_) return;
  if (!root.is_absolute()) return;
  vault_root_ = root;
  clearVaultWriteback();
  if (hasActiveAccount()) refreshVaultWriteback();
}

void UiShell::performVaultTask(const QString& action,
    std::function<codeweave::app::Result(VaultWritebackStore&, QVariantMap&)> operation) {
  if (closing_ || vault_busy_ || operation_busy_ || execution_busy_ || account_busy_ ||
      draft_saving_ || !hasActiveAccount()) return;
  const bool write = action != "read";
  if (vault_root_.empty() && action != "read") return;
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto owner_root = native_data_root_;
  const auto account_root = data_root_;
  const auto vault = vault_root_;
  const auto snapshot = std::make_shared<QVariantMap>();
  vault_busy_ = true; vault_write_ = write;
  vault_status_ = write ? QStringLiteral("正在执行已确认的资料库操作…") : QStringLiteral("正在读取证据与资料库状态…");
  emit vaultWritebackChanged();
  codeweave::backend::TaskRequest request;
  const auto task = QStringLiteral("qt-vault-%1").arg(next_task_id_++);
  request.task_id = task.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = write ? codeweave::backend::TaskKind::Evidence : codeweave::backend::TaskKind::Read;
  request.work = [owner_root, account_root, vault, account, operation, snapshot](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("资料库操作已取消");
    VaultWritebackStore store(owner_root, account_root, vault, account.toStdString());
    return operation(store, *snapshot);
  };
  vault_task_id_ = task;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, task, account, generation, snapshot, action](auto result) {
        QMetaObject::invokeMethod(this, [this, task, account, generation, snapshot, action, result] {
          if (vault_task_id_ != task) return;
          vault_task_id_.clear(); vault_busy_ = false; vault_write_ = false;
          if (closing_ || account != active_account_id_ || generation != account_generation_) return;
          if (result.result.ok && !result.cancelled) {
            if (action == "preview") vault_writeback_["preview"] = *snapshot;
            else if (action == "read") vault_writeback_ = *snapshot;
            else vault_writeback_.remove("preview");
          } else if (action == "read") {
            vault_writeback_.clear();
            vault_writeback_["ready"] = false;
          }
          vault_status_ = QString::fromUtf8(result.result.message);
          emit vaultWritebackChanged();
          if (result.result.ok && action != "read" && action != "preview") refreshVaultWriteback();
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    vault_task_id_.clear(); vault_busy_ = false; vault_write_ = false;
    vault_status_ = QString::fromUtf8(submitted.message);
    emit vaultWritebackChanged();
  }
}

void UiShell::refreshVaultWriteback() {
  performVaultTask("read", [](auto& store, auto& state) {
    QVariantList pending, synced;
    auto result = store.readEvidence(pending, synced); if (!result.ok) return result;
    state["pending"] = pending; state["synced"] = synced;
    bool owner = false;
    result = store.ownerStatus(owner); if (!result.ok) return result;
    state["isOwner"] = owner; state["ready"] = true;
    if (owner) {
      QVariantMap progress; QVariantList ledger;
      const auto read = store.readProgress(progress);
      state["progressReady"] = read.ok;
      state["progressStatus"] = QString::fromUtf8(read.message);
      state["progress"] = progress;
      result = store.transactions(ledger); if (!result.ok) return result;
      state["transactions"] = ledger;
    }
    return codeweave::app::Result::success(owner ? "证据、事务与资料库进度已读取" : "暂存证据已读取；资料库尚未绑定当前账户");
  });
}

void UiShell::bindVaultOwner() {
  performVaultTask("bind", [](auto& store, auto&) { return store.bindOwner(); });
}

void UiShell::previewVaultWriteback(const QStringList& evidenceIds) {
  performVaultTask("preview", [evidenceIds](auto& store, auto& result) { return store.preview(evidenceIds, result); });
}

void UiShell::commitVaultWriteback(const QString& operationId, const QVariantMap& expectedHashes) {
  performVaultTask("commit", [operationId, expectedHashes](auto& store, auto& result) {
    return store.commit(operationId, expectedHashes, result);
  });
}

void UiShell::rollbackVaultWriteback(const QString& operationId) {
  performVaultTask("rollback", [operationId](auto& store, auto& result) { return store.rollback(operationId, result); });
}
