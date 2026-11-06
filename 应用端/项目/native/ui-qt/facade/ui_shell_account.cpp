#include "ui_shell.hpp"

#include <QMetaObject>


QString UiShell::accountStatus() const { return account_status_; }

QString UiShell::accountName() const {
  return account_service_ && account_service_->current()
      ? QString::fromUtf8(account_service_->current()->name) : QString();
}

bool UiShell::accountBusy() const { return account_busy_; }

void UiShell::setAccountStatus(const QString& status) {
  account_status_ = status;
  emit accountStatusChanged();
}

void UiShell::configureAccountStorage(const std::filesystem::path& workspace,
    const std::filesystem::path& nativeDataRoot) {
  if (closing_ || hasActiveAccount() || account_busy_ || operation_busy_ || execution_busy_) return;
  workspace_root_ = workspace;
  native_data_root_ = nativeDataRoot;
  data_root_ = nativeDataRoot;
  account_store_ = std::make_shared<codeweave::account::AccountStore>(nativeDataRoot);
  account_service_ = std::make_unique<codeweave::account::AccountService>(*account_store_);
  setAccountStatus(QStringLiteral("访客模式：登录后可保存草稿"));
}

void UiShell::authenticate(const QString& name, const QString& identifier,
    const QString& password, bool registration) {
  if (account_busy_ || content_busy_ || draft_saving_) return;
  if (!account_store_ || workspace_root_.empty() || data_root_.empty()) {
    setAccountStatus(QStringLiteral("账户存储尚未准备好"));
    return;
  }
  if ((!registration && (identifier.isEmpty() || password.isEmpty())) ||
      (registration && (name.isEmpty() || identifier.isEmpty() || password.isEmpty()))) {
    setAccountStatus(QStringLiteral("请完整填写账户信息"));
    return;
  }
  if (!allowDocumentChange()) return;
  account_busy_ = true;
  emit accountBusyChanged();
  setAccountStatus(registration ? QStringLiteral("正在创建账户…") : QStringLiteral("正在验证账户…"));
  const auto store = account_store_;
  const auto generation = account_generation_;
  const auto record = std::make_shared<codeweave::account::Record>();
  const auto utf8_name = name.toUtf8().toStdString();
  const auto utf8_identifier = identifier.toUtf8().toStdString();
  const auto utf8_password = password.toUtf8().toStdString();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-account-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Account;
  request.work = [store, record, utf8_name, utf8_identifier, utf8_password, registration](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("账户操作已取消");
    codeweave::account::AccountService service(*store);
    const auto result = registration
        ? service.register_account(utf8_name, utf8_identifier, utf8_password)
        : service.login(utf8_identifier, utf8_password);
    if (result.ok && service.current()) *record = *service.current();
    return result;
  };
  account_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, record, registration, generation, task_name](codeweave::backend::TaskResult result) mutable {
    QMetaObject::invokeMethod(this, [this, record, registration, generation, task_name,
        result = std::move(result)]() mutable {
      if (task_name != account_task_id_) return;
      account_task_id_.clear();
      account_busy_ = false;
      emit accountBusyChanged();
      if (closing_ || generation != account_generation_) return;
      if (result.cancelled) {
        setAccountStatus(QStringLiteral("账户操作已取消"));
        return;
      }
      if (!result.result.ok) { setAccountStatus(QString::fromUtf8(result.result.message)); return; }
      if (!account_service_) { setAccountStatus(QStringLiteral("账户服务未初始化")); return; }
      const auto adopted = account_service_->adopt_authenticated_record(*record);
      if (!adopted.ok) { setAccountStatus(QString::fromUtf8(adopted.message)); return; }
      if (setAccountContext(*account_service_, workspace_root_, native_data_root_)) {
        emit accountChanged();
        setAccountStatus(registration ? QStringLiteral("注册并登录成功") : QStringLiteral("登录成功"));
      }
    }, Qt::QueuedConnection);
  });
  if (!submitted.ok) {
    account_task_id_.clear();
    account_busy_ = false;
    emit accountBusyChanged();
    setAccountStatus(QString::fromUtf8(submitted.message));
  }
}

void UiShell::login(const QString& identifier, const QString& password) {
  authenticate({}, identifier, password, false);
}

void UiShell::registerAccount(const QString& name, const QString& identifier,
    const QString& password) {
  authenticate(name, identifier, password, true);
}

void UiShell::logout() {
  if (account_busy_ || content_busy_ || draft_saving_ || !allowDocumentChange() || !account_service_) return;
  const auto result = account_service_->logout();
  if (!result.ok) { setAccountStatus(QString::fromUtf8(result.message)); return; }
  if (clearAccountContext()) {
    setAccountStatus(QStringLiteral("已退出，当前为访客模式"));
    emit accountChanged();
  }
}

void UiShell::changePassword(const QString& currentPassword, const QString& newPassword) {
  if (closing_ || account_busy_ || execution_busy_ || operation_busy_ || draft_saving_ ||
      content_busy_ || !account_service_ || !account_service_->current()) {
    setAccountStatus(QStringLiteral("请先登录并等待当前操作完成"));
    return;
  }
  const auto store = account_store_;
  const auto record = std::make_shared<codeweave::account::Record>(*account_service_->current());
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  account_busy_ = true;
  emit accountBusyChanged();
  codeweave::backend::TaskRequest request;
  const auto task_name = QStringLiteral("qt-password-%1").arg(next_task_id_++);
  request.task_id = task_name.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = codeweave::backend::TaskKind::Account;
  request.work = [store, record, oldPassword = currentPassword.toUtf8().toStdString(),
      password = newPassword.toUtf8().toStdString()](const auto&) {
    codeweave::account::AccountService service(*store);
    auto result = service.adopt_authenticated_record(*record);
    if (result.ok) result = service.change_password(oldPassword, password);
    if (result.ok) *record = *service.current();
    return result;
  };
  account_task_id_ = task_name;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, record, account, generation, task_name](auto result) {
        QMetaObject::invokeMethod(this, [this, record, account, generation, task_name, result] {
          if (task_name != account_task_id_) return;
          account_task_id_.clear();
          account_busy_ = false;
          emit accountBusyChanged();
          if (closing_ || account != active_account_id_ || generation != account_generation_) return;
          if (result.cancelled) {
            setAccountStatus(QStringLiteral("改密操作已取消"));
            return;
          }
          if (result.result.ok) account_service_->adopt_authenticated_record(*record);
          setAccountStatus(QString::fromUtf8(result.result.message));
        }, Qt::QueuedConnection);
      });
  if (!submitted.ok) {
    account_task_id_.clear();
    account_busy_ = false;
    emit accountBusyChanged();
    setAccountStatus(QString::fromUtf8(submitted.message));
  }
}
