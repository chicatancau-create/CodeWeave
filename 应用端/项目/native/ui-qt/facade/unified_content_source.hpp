#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QUrl>
#include <QVariant>
#include <functional>

class UnifiedContentSource final : public QObject {
  Q_OBJECT
  Q_PROPERTY(QVariantMap catalog READ catalog NOTIFY changed FINAL)
  Q_PROPERTY(QVariantMap page READ page NOTIFY changed FINAL)
  Q_PROPERTY(QString status READ status NOTIFY changed FINAL)
  Q_PROPERTY(QString defaultOrigin READ defaultOrigin CONSTANT FINAL)
  Q_PROPERTY(QStringList checkinDates READ checkinDates NOTIFY changed FINAL)
  Q_PROPERTY(QString syncStatus READ syncStatus NOTIFY changed FINAL)
  Q_PROPERTY(QString offlineStatus READ offlineStatus NOTIFY changed FINAL)
  Q_PROPERTY(bool connected READ connected NOTIFY changed FINAL)
  Q_PROPERTY(bool busy READ busy NOTIFY changed FINAL)

public:
  explicit UnifiedContentSource(QObject* parent = nullptr);
  void configureCache(const QString& path);
  void restoreAccount();
  QVariantMap catalog() const { return catalog_; }
  QVariantMap page() const { return page_; }
  QString status() const { return status_; }
  QString defaultOrigin() const;
  QStringList checkinDates() const { return checkinDates_; }
  QString syncStatus() const { return syncStatus_; }
  QString offlineStatus() const { return offlineStatus_; }
  bool connected() const { return !cookie_.isEmpty(); }
  bool busy() const { return busy_; }

  Q_INVOKABLE void connectAccount(const QString& origin, const QString& identifier, const QString& password);
  Q_INVOKABLE void loadCatalog();
  Q_INVOKABLE void openLesson(const QString& contentId);
  Q_INVOKABLE void refreshLearningFacts();
  Q_INVOKABLE void recordCheckin();
  Q_INVOKABLE void saveOfflineBundle();
  Q_INVOKABLE void disconnectAccount();

signals:
  void changed();

private:
  using Reply = std::function<void(int, const QByteArray&, const QNetworkReply&)>;
  void run(const QString& path, const QByteArray& body, Reply callback, const QByteArray& idempotencyKey = {});
  void finish(const QString& status);
  void clearAccount();
  void saveSession() const;
  QString sessionFile() const;
  QString cacheFile(const QString& record) const;
  bool saveCache(const QString& record, const QByteArray& bytes) const;
  QByteArray readCache(const QString& record) const;
  QString contextKey() const;
  bool acceptCatalog(const QByteArray& bytes);
  void loadAttachments(const QVariantList& assets, int index, bool offline);
  void pullLearningFacts(const QString& cursor, QStringList dates);
  QString learningScope() const;
  QString checkinOutboxPath() const;
  void flushCheckinOutbox(const QString& scope, const QString& path);
  QString offlineRoot() const;
  QVariantMap verifiedOfflineBundle(QVariantMap* pointer = nullptr) const;
  QVariantMap offlineLesson(const QString& contentId) const;
  void finishOffline(const QString& message);
  void saveOfflineAssets(const QVariantList& assets, int index, const QString& bundle, const QString& hash, const QString& target);

  QNetworkAccessManager network_;
  QUrl origin_;
  QByteArray cookie_;
  QString account_;
  QString cacheDir_;
  QVariantMap catalog_;
  QVariantMap page_;
  QString status_;
  QStringList checkinDates_;
  QString syncStatus_;
  QString offlineStatus_;
  bool offlineBusy_ = false;
  bool syncBusy_ = false;
  quint64 generation_ = 0;
  bool busy_ = false;
};
