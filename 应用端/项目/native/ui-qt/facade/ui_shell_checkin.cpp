#include "ui_shell.hpp"
#include "checkin_store.hpp"

#include <QMetaObject>

QVariantMap UiShell::checkinSummary() const {
  const auto today = local_date_();
  const bool checked = checkin_ready_ && checkin_dates_.contains(today.toString(Qt::ISODate));
  return {{"ready", checkin_ready_}, {"busy", checkin_busy_}, {"status", checkin_status_},
      {"todayKey", today.toString(Qt::ISODate)}, {"checkedIn", checked},
      {"streakDays", checkin_ready_ ? CheckinStore::streak(checkin_dates_, today) : 0},
      {"dates", checkin_dates_}, {"totalDays", checkin_dates_.size()}};
}

QVariantMap UiShell::analysisSnapshot() const {
  auto snapshot = analysis_snapshot_;
  if (snapshot.isEmpty()) return snapshot;
  const auto checkin = checkinSummary();
  snapshot["streakDays"] = checkin_ready_ ? checkin.value("streakDays") : QVariant(QStringLiteral("暂无数据"));
  snapshot["todayCheckin"] = checkin_ready_
      ? (checkin.value("checkedIn").toBool() ? QStringLiteral("已打卡") : QStringLiteral("未打卡"))
      : QStringLiteral("暂无数据");
  return snapshot;
}

void UiShell::refreshLocalDay() {
  const auto today = local_date_();
  if (today == checkin_day_) return;
  checkin_day_ = today;
  if (checkin_ready_) checkin_status_.clear();
  emit checkinChanged();
  emit reviewSummaryChanged();
}

void UiShell::clearCheckin() {
  checkin_task_id_.clear();
  checkin_dates_.clear();
  checkin_busy_ = false;
  checkin_write_ = false;
  checkin_ready_ = false;
  checkin_status_.clear();
  checkin_day_ = local_date_();
  emit checkinChanged();
}

void UiShell::refreshCheckin() { performCheckinTask(false); }
void UiShell::checkIn() { performCheckinTask(true); }

void UiShell::performCheckinTask(bool write) {
  if (closing_ || checkin_busy_ || account_busy_ || !hasActiveAccount()) return;
  const auto root = QString::fromStdWString(data_root_.wstring());
  const auto account = active_account_id_;
  const auto generation = account_generation_;
  const auto today = local_date_();
  const auto dates = std::make_shared<QStringList>();
  checkin_busy_ = true;
  checkin_write_ = write;
  emit checkinChanged();
  codeweave::backend::TaskRequest request;
  const auto task = QStringLiteral("qt-checkin-%1").arg(next_task_id_++);
  request.task_id = task.toStdString();
  request.account_id = account.toStdString();
  request.account_generation = generation;
  request.kind = write ? codeweave::backend::TaskKind::Evidence : codeweave::backend::TaskKind::Read;
  request.work = [root, today, dates, write](const auto& token) {
    if (token.cancelled()) return codeweave::app::Result::failure("打卡操作已取消");
    const CheckinStore store(root);
    return write ? store.checkIn(today, *dates) : store.read(*dates);
  };
  checkin_task_id_ = task;
  const auto submitted = backend_tasks_.submit(std::move(request),
      [this, dates, account, generation, task](auto result) {
    QMetaObject::invokeMethod(this, [this, dates, account, generation, task, result] {
      if (task != checkin_task_id_) return;
      checkin_task_id_.clear();
      checkin_busy_ = false;
      if (closing_ || account != active_account_id_ || generation != account_generation_) return;
      checkin_ready_ = result.result.ok && !result.cancelled;
      checkin_dates_ = checkin_ready_ ? *dates : QStringList{};
      checkin_status_ = result.cancelled ? QStringLiteral("打卡操作已取消") : QString::fromUtf8(result.result.message);
      checkin_day_ = local_date_();
      emit checkinChanged();
      emit reviewSummaryChanged();
    }, Qt::QueuedConnection);
  });
  if (!submitted.ok) {
    checkin_task_id_.clear();
    checkin_busy_ = false;
    checkin_status_ = QString::fromUtf8(submitted.message);
    emit checkinChanged();
  }
}
