#pragma once

#include "app_core.hpp"

#include <QString>
#include <QVariantList>
#include <QVariantMap>

// One account-scoped, atomically replaced document owns submissions and reviews.
// It never rewrites course evidence or treats external material as auto-verified.
class ChallengeSubmissionStore final {
 public:
  explicit ChallengeSubmissionStore(QString accountRoot);
  codeweave::app::Result read(QVariantList& records) const;
  codeweave::app::Result append(const QVariantMap& record, QVariantList& records) const;
  codeweave::app::Result review(const QString& id, bool passed,
      const QString& observation, QVariantList& records) const;

 private:
  QString root_;
};
