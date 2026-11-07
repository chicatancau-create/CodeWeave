#pragma once

#include "app_core.hpp"
#include <QDate>
#include <QStringList>

class CheckinStore final {
 public:
  explicit CheckinStore(QString accountRoot);
  codeweave::app::Result read(QStringList& dates) const;
  codeweave::app::Result checkIn(const QDate& today, QStringList& dates) const;
  static int streak(const QStringList& dates, const QDate& today);

 private:
  QString root_;
};
