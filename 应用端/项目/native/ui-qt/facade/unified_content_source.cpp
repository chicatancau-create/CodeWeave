#include "unified_content_source.hpp"

#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkCookie>
#include <QNetworkReply>
#include <QSaveFile>
#include <QRegularExpression>
#include <QSysInfo>
#include <QTimeZone>
#include <QUuid>

#ifdef Q_OS_WIN
#include <windows.h>
#include <dpapi.h>
#endif

namespace {
QByteArray digest(const QByteArray& bytes) {
  return QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex();
}

QVariantMap responseData(const QByteArray& bytes) {
  return QJsonDocument::fromJson(bytes).object().value(QStringLiteral("data")).toObject().toVariantMap();
}

QString parameter(const QString& value) { return QString::fromLatin1(QUrl::toPercentEncoding(value)); }

bool saveFile(const QString& path, const QByteArray& bytes) {
  QSaveFile file(path);
  return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size() && file.commit();
}

bool validDigest(const QString& value) {
  static const QRegularExpression pattern(QStringLiteral("^[a-f0-9]{64}$"));
  return pattern.match(value).hasMatch();
}

bool validBundle(const QString& value) {
  static const QRegularExpression pattern(QStringLiteral("^[a-f0-9]{32}$"));
  return pattern.match(value).hasMatch();
}

QByteArray loadFile(const QString& path) {
  QFile file(path);
  return file.open(QIODevice::ReadOnly) && file.size() <= 8 * 1024 * 1024 ? file.readAll() : QByteArray{};
}

QUrl localOrigin(const QString& value) {
  const QUrl address(value.trimmed(), QUrl::StrictMode);
  if (!address.isValid() || address.scheme() != QStringLiteral("http") || address.host() != QStringLiteral("127.0.0.1") ||
      address.port() < 1 || (!address.path().isEmpty() && address.path() != QStringLiteral("/")) ||
      address.hasQuery() || address.hasFragment() || !address.userInfo().isEmpty()) return {};
  return address.adjusted(QUrl::RemovePath);
}

#ifdef Q_OS_WIN
QByteArray protectSession(QByteArray input, bool encrypt) {
  if (input.isEmpty() || input.size() > 16384) return {};
  DATA_BLOB source{static_cast<DWORD>(input.size()), reinterpret_cast<BYTE*>(input.data())};
  DATA_BLOB output{};
  const BOOL ok = encrypt
    ? CryptProtectData(&source, L"CodeWeave session", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)
    : CryptUnprotectData(&source, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output);
  SecureZeroMemory(input.data(), static_cast<size_t>(input.size()));
  if (!ok) return {};
  const QByteArray result(reinterpret_cast<const char*>(output.pbData), output.cbData);
  SecureZeroMemory(output.pbData, output.cbData);
  LocalFree(output.pbData);
  return result;
}
#endif
}

UnifiedContentSource::UnifiedContentSource(QObject* parent) : QObject(parent) {}

QString UnifiedContentSource::defaultOrigin() const {
  const auto origin = qEnvironmentVariable("CODEWEAVE_UNIFIED_ORIGIN");
  return origin.isEmpty() ? QStringLiteral("http://127.0.0.1:4173") : origin;
}

void UnifiedContentSource::configureCache(const QString& path) { cacheDir_ = path; }

QString UnifiedContentSource::sessionFile() const {
  return cacheDir_.isEmpty() ? QString{} : QDir(cacheDir_).filePath(QStringLiteral("session.dpapi"));
}

void UnifiedContentSource::saveSession() const {
#ifdef Q_OS_WIN
  if (sessionFile().isEmpty() || !connected() || !QDir().mkpath(cacheDir_)) return;
  const auto payload = QJsonDocument(QJsonObject{
    {"origin", origin_.toString()}, {"id", account_}, {"cookie", QString::fromLatin1(cookie_)},
    {"validatedAt", QDateTime::currentSecsSinceEpoch()},
  }).toJson(QJsonDocument::Compact);
  const auto protectedSession = protectSession(payload, true);
  if (!protectedSession.isEmpty()) saveFile(sessionFile(), protectedSession);
#endif
}

void UnifiedContentSource::restoreAccount() {
#ifdef Q_OS_WIN
  if (connected() || busy_ || sessionFile().isEmpty()) return;
  auto plaintext = protectSession(loadFile(sessionFile()), false);
  const auto session = QJsonDocument::fromJson(plaintext).object();
  SecureZeroMemory(plaintext.data(), static_cast<size_t>(plaintext.size()));
  const auto address = localOrigin(session.value("origin").toString());
  const auto account = session.value("id").toString();
  const auto cookie = session.value("cookie").toString().toLatin1();
  const auto elapsed = QDateTime::currentSecsSinceEpoch() - session.value("validatedAt").toInteger();
  static const QRegularExpression token(QStringLiteral("^code_canvas_session=[a-f0-9]{48}$"));
  if (address.isEmpty() || address != localOrigin(defaultOrigin()) || account.isEmpty() ||
      !token.match(QString::fromLatin1(cookie)).hasMatch() || elapsed < 0 || elapsed >= 7 * 24 * 60 * 60) return;
  origin_ = address;
  cookie_ = cookie;
  account_ = account;
  busy_ = true;
  status_ = QStringLiteral("正在恢复会话");
  emit changed();
  run(QStringLiteral("/api/auth/me"), {}, [this](int status, const QByteArray& reply, const QNetworkReply&) {
    if (status != 0 && (status != 200 || responseData(reply).value("id").toString() != account_)) {
      clearAccount();
      finish(QStringLiteral("请重新登录统一服务"));
      return;
    }
    if (status == 200) saveSession();
    busy_ = false;
    loadCatalog();
  });
#endif
}

void UnifiedContentSource::finish(const QString& status) {
  busy_ = false;
  status_ = status;
  emit changed();
}

void UnifiedContentSource::clearAccount() {
  ++generation_;
  if (!sessionFile().isEmpty()) QFile::remove(sessionFile());
  if (!account_.isEmpty() && !cacheDir_.isEmpty()) {
    const auto prefix = QString::fromLatin1(digest(origin_.toEncoded() + '\0' + account_.toUtf8())) + '-';
    QDir cache(cacheDir_);
    for (const auto& file : cache.entryList({prefix + QStringLiteral("*")}, QDir::Files)) cache.remove(file);
    const auto saved = offlineRoot();
    const auto canonicalCache = QDir(cacheDir_).canonicalPath();
    const auto canonicalSaved = QDir(saved).canonicalPath();
    if (!canonicalCache.isEmpty() && canonicalSaved.startsWith(canonicalCache + '/')) {
      QDir(saved).removeRecursively();
    }
  }
  account_.clear();
  cookie_.clear();
  catalog_.clear();
  page_.clear();
  checkinDates_.clear();
  syncStatus_.clear();
  syncBusy_ = false;
  offlineBusy_ = false;
  offlineStatus_.clear();
}

QString UnifiedContentSource::cacheFile(const QString& record) const {
  if (cacheDir_.isEmpty() || account_.isEmpty()) return {};
  const auto prefix = digest(origin_.toEncoded() + '\0' + account_.toUtf8());
  return QDir(cacheDir_).filePath(QString::fromLatin1(prefix + '-' + digest(record.toUtf8())));
}

bool UnifiedContentSource::saveCache(const QString& record, const QByteArray& bytes) const {
  const auto path = cacheFile(record);
  if (path.isEmpty() || !QDir().mkpath(cacheDir_)) return false;
  return saveFile(path, bytes);
}

QByteArray UnifiedContentSource::readCache(const QString& record) const {
  return loadFile(cacheFile(record));
}

QString UnifiedContentSource::contextKey() const {
  return catalog_.value("serviceInstance").toString() + '/' + catalog_.value("vaultId").toString() + '/' +
         catalog_.value("bundleId").toString() + '/' + catalog_.value("manifestHash").toString();
}

void UnifiedContentSource::run(const QString& path, const QByteArray& body, Reply callback, const QByteArray& idempotencyKey) {
  const auto token = generation_;
  QNetworkRequest request(QUrl::fromEncoded(origin_.toEncoded() + path.toUtf8(), QUrl::StrictMode));
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
  request.setAttribute(QNetworkRequest::CookieLoadControlAttribute, QNetworkRequest::Manual);
  request.setAttribute(QNetworkRequest::CookieSaveControlAttribute, QNetworkRequest::Manual);
  request.setTransferTimeout(7000);
  if (!cookie_.isEmpty()) request.setRawHeader("Cookie", cookie_);
  if (!idempotencyKey.isEmpty()) request.setRawHeader("Idempotency-Key", idempotencyKey);
  if (!body.isEmpty()) request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
  auto* reply = body.isEmpty() ? network_.get(request) : network_.post(request, body);
  connect(reply, &QNetworkReply::downloadProgress, reply, [reply](qint64 received, qint64) {
    if (received > 8 * 1024 * 1024) reply->abort();
  });
  connect(reply, &QNetworkReply::finished, this, [this, token, callback = std::move(callback), reply] {
    reply->deleteLater();
    if (token != generation_) return;
    callback(reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt(), reply->readAll(), *reply);
  });
}

void UnifiedContentSource::connectAccount(const QString& origin, const QString& identifier, const QString& password) {
  if (busy_) return;
  const auto address = localOrigin(origin);
  if (address.isEmpty()) {
    finish(QStringLiteral("请输入 http://127.0.0.1:端口"));
    return;
  }
  clearAccount();
  origin_ = address;
  busy_ = true;
  status_ = QStringLiteral("正在登录");
  emit changed();
  const auto login = QJsonDocument(QJsonObject{{"identifier", identifier.trimmed()}, {"password", password}}).toJson(QJsonDocument::Compact);
  run(QStringLiteral("/api/auth/login"), login, [this](int status, const QByteArray& bytes, const QNetworkReply& reply) {
    const auto session = QNetworkCookie::parseCookies(reply.rawHeader("Set-Cookie"));
    if (status != 200 || session.isEmpty()) { finish(QStringLiteral("无法登录统一服务")); return; }
    account_ = responseData(bytes).value("id").toString();
    if (account_.isEmpty()) { finish(QStringLiteral("服务未返回账户标识")); return; }
    cookie_ = session.first().toRawForm(QNetworkCookie::NameAndValueOnly);
    saveSession();
    busy_ = false;
    loadCatalog();
  });
}

bool UnifiedContentSource::acceptCatalog(const QByteArray& bytes) {
  auto data = responseData(bytes);
  if (data.value("contractVersion").toInt() != 1 || data.value("bundleId").toString().isEmpty() ||
      data.value("serviceInstance").toString().isEmpty() || data.value("vaultId").toString().isEmpty() ||
      data.value("manifestHash").toString().size() != 64) return false;
  catalog_ = std::move(data);
  return true;
}

void UnifiedContentSource::loadCatalog() {
  if (!connected() || busy_) return;
  busy_ = true;
  page_.clear();
  status_ = QStringLiteral("正在读取课程目录");
  emit changed();
  run(QStringLiteral("/api/content/catalog"), {}, [this](int status, const QByteArray& bytes, const QNetworkReply&) {
    if (status == 200 && acceptCatalog(bytes)) {
      saveSession();
      saveCache(QStringLiteral("catalog"), bytes);
      finish(QStringLiteral("已连接"));
      refreshLearningFacts();
    } else if (status == 0) {
      QVariantMap pointer;
      if (!verifiedOfflineBundle(&pointer).isEmpty()) {
        catalog_ = pointer.value("catalog").toMap();
        finish(QStringLiteral("离线只读"));
      } else if (acceptCatalog(readCache(QStringLiteral("catalog")))) {
        finish(QStringLiteral("离线只读"));
      } else {
        finish(QStringLiteral("请使用内置课程"));
      }
    } else {
      if (status == 401 || status == 403) clearAccount();
      finish(QStringLiteral("无法读取统一课程目录"));
    }
  });
}

void UnifiedContentSource::openLesson(const QString& contentId) {
  if (!connected() || busy_ || catalog_.isEmpty() || contentId.isEmpty()) return;
  const auto bundle = catalog_.value("bundleId").toString();
  const auto key = contextKey() + "/lesson/" + contentId;
  const auto path = QStringLiteral("/api/content/lessons/") + parameter(contentId) + "?bundleId=" + parameter(bundle);
  busy_ = true;
  status_ = QStringLiteral("正在读取课程");
  emit changed();
  run(path, {}, [this, bundle, key, contentId](int status, const QByteArray& body, const QNetworkReply& reply) {
    const auto bytes = status == 0 ? readCache(key) : body;
    auto data = status == 0 ? offlineLesson(contentId) : QVariantMap{};
    const bool savedBundle = !data.isEmpty();
    if (!savedBundle) data = responseData(bytes);
    const auto lesson = data.value("lesson").toMap();
    if ((status != 0 && (status != 200 || reply.rawHeader("X-Content-Bundle") != bundle.toUtf8())) || lesson.value("contentId").toString() != contentId) {
      if (status == 401 || status == 403) clearAccount();
      finish(QStringLiteral("课程不可用或快照版本不一致"));
      return;
    }
    if (status == 200) saveCache(key, bytes);
    page_ = std::move(data);
    if (savedBundle) {
      finish(QStringLiteral("离线只读"));
      return;
    }
    page_["images"] = QVariantList{};
    loadAttachments(page_.value("assets").toList(), 0, status == 0);
  });
}

void UnifiedContentSource::loadAttachments(const QVariantList& assets, int index, bool offline) {
  if (index >= assets.size()) {
    finish(offline ? QStringLiteral("离线只读") : QStringLiteral("已连接"));
    return;
  }
  const auto asset = assets[index].toMap();
  const auto hash = asset.value("sha256").toByteArray();
  const auto source = asset.value("path").toString();
  const auto key = contextKey() + "/asset/" + QString::fromLatin1(hash);
  const auto bundle = catalog_.value("bundleId").toString();
  const auto retain = [this, key, hash, source](const QByteArray& bytes, bool cached) {
    if (bytes.isEmpty() || digest(bytes) != hash || (!cached && !saveCache(key, bytes))) return;
    auto attachments = page_.value("images").toList();
    attachments.append(QVariantMap{{"title", QFileInfo(source).fileName()}, {"url", QUrl::fromLocalFile(cacheFile(key))}});
    page_["images"] = attachments;
  };
  if (offline) {
    retain(readCache(key), true);
    loadAttachments(assets, index + 1, true);
    return;
  }
  run(QStringLiteral("/api/content/asset?bundleId=") + parameter(bundle) + "&path=" + parameter(source), {},
      [this, assets, index, bundle, key, retain](int status, const QByteArray& bytes, const QNetworkReply& reply) {
        if (status == 200 && reply.rawHeader("X-Content-Bundle") == bundle.toUtf8()) retain(bytes, false);
        if (status == 0) retain(readCache(key), true);
        loadAttachments(assets, index + 1, status == 0);
      });
}

void UnifiedContentSource::disconnectAccount() {
  if (!connected()) return;
  run(QStringLiteral("/api/auth/logout"), QByteArrayLiteral("{}"), [](int, const QByteArray&, const QNetworkReply&) {});
  clearAccount();
  finish(QStringLiteral("已退出统一服务"));
}

void UnifiedContentSource::refreshLearningFacts() {
  if (!connected() || syncBusy_ ||
      !catalog_.value("capabilities").toStringList().contains(QStringLiteral("learningSync"))) return;
  syncBusy_ = true;
  syncStatus_ = QStringLiteral("正在同步学习记录");
  emit changed();
  const auto scope = learningScope();
  const auto outbox = checkinOutboxPath();
  if (outbox.isEmpty() || !QFile::exists(outbox)) {
    pullLearningFacts({}, {});
    return;
  }
  run(QStringLiteral("/api/sync/state"), {}, [this, scope, outbox](int status, const QByteArray& bytes, const QNetworkReply&) {
    const auto state = responseData(bytes);
    const auto expected = QStringList{state.value("serviceInstance").toString(), state.value("vaultId").toString(),
      state.value("accountId").toString()}.join(QChar::Null);
    if (status != 200 || expected != scope || scope != learningScope()) {
      syncBusy_ = false;
      syncStatus_ = status == 0 ? QStringLiteral("待同步打卡已保留")
        : QStringLiteral("待同步打卡已保留（同步账户 %1）").arg(status);
      emit changed();
      return;
    }
    flushCheckinOutbox(scope, outbox);
  });
}

QString UnifiedContentSource::learningScope() const {
  return QStringList{catalog_.value("serviceInstance").toString(), catalog_.value("vaultId").toString(), account_}
    .join(QChar::Null);
}

QString UnifiedContentSource::checkinOutboxPath() const {
  if (cacheDir_.isEmpty() || account_.isEmpty() || catalog_.value("vaultId").toString().isEmpty()) return {};
  return QDir(cacheDir_).filePath(QStringLiteral("outbox-") +
    QString::fromLatin1(digest(origin_.toEncoded() + '\0' + learningScope().toUtf8())) + QStringLiteral(".json"));
}

void UnifiedContentSource::recordCheckin() {
  if (!connected() || syncBusy_ ||
      !catalog_.value("capabilities").toStringList().contains(QStringLiteral("learningSync"))) return;
  const auto outbox = checkinOutboxPath();
  if (outbox.isEmpty()) return;
  const auto bytes = loadFile(outbox);
  const auto prior = QJsonDocument::fromJson(bytes);
  if (QFile::exists(outbox) && !prior.isArray()) {
    syncStatus_ = QStringLiteral("待同步打卡文件无法读取");
    emit changed();
    return;
  }
  auto changes = prior.array();
  const auto now = QDateTime::currentDateTime();
  const auto date = now.date().toString(Qt::ISODate);
  if (checkinDates_.contains(date)) return;
  for (const auto& existing : changes) {
    if (existing.toObject().value("localDate").toString() == date) {
      refreshLearningFacts();
      return;
    }
  }
  const auto zone = QTimeZone::systemTimeZoneId();
  changes.append(QJsonObject{
    {"schemaVersion", 1}, {"changeId", QUuid::createUuid().toString(QUuid::WithoutBraces)},
    {"deviceId", QString::fromLatin1(digest(QSysInfo::machineUniqueId() + '\0' + learningScope().toUtf8()))},
    {"kind", QStringLiteral("learning.checkin.recorded")}, {"occurredAt", now.toUTC().toString(Qt::ISODateWithMs)},
    {"localDate", date}, {"timeZone", QString::fromLatin1(zone.isEmpty() ? QByteArrayLiteral("UTC") : zone)},
    {"payload", QJsonObject{}},
  });
  if (!QDir().mkpath(cacheDir_) || !saveFile(outbox, QJsonDocument(changes).toJson(QJsonDocument::Compact))) {
    syncStatus_ = QStringLiteral("无法保存待同步打卡");
    emit changed();
    return;
  }
  refreshLearningFacts();
}

void UnifiedContentSource::flushCheckinOutbox(const QString& scope, const QString& path) {
  if (scope != learningScope()) {
    syncBusy_ = false;
    emit changed();
    return;
  }
  const auto changes = QJsonDocument::fromJson(loadFile(path));
  if (!changes.isArray()) {
    syncBusy_ = false;
    syncStatus_ = QStringLiteral("待同步打卡文件无法读取");
    emit changed();
    return;
  }
  auto pending = changes.array();
  if (pending.isEmpty()) {
    pullLearningFacts({}, {});
    return;
  }
  const auto event = pending.first().toObject();
  const auto id = event.value("changeId").toString().toUtf8();
  run(QStringLiteral("/api/sync/push"), QJsonDocument(event).toJson(QJsonDocument::Compact),
    [this, scope, path, pending = std::move(pending)](int status, const QByteArray& bytes, const QNetworkReply&) mutable {
      if (scope != learningScope() || status != 200 || responseData(bytes).value("status").toString() != QStringLiteral("accepted")) {
        syncBusy_ = false;
        const auto errorCode = QJsonDocument::fromJson(bytes).object().value("code").toString();
        syncStatus_ = status == 0 ? QStringLiteral("待同步打卡已保留")
          : QStringLiteral("待同步打卡已保留（%1）").arg(errorCode.isEmpty() ? QString::number(status) : errorCode);
        emit changed();
        return;
      }
      pending.removeFirst();
      if (!saveFile(path, QJsonDocument(pending).toJson(QJsonDocument::Compact))) {
        syncBusy_ = false;
        syncStatus_ = QStringLiteral("待同步打卡已保留");
        emit changed();
        return;
      }
      flushCheckinOutbox(scope, path);
    }, id);
}

void UnifiedContentSource::pullLearningFacts(const QString& cursor, QStringList dates) {
  auto path = QStringLiteral("/api/sync/pull");
  if (!cursor.isEmpty()) path += QStringLiteral("?cursor=") + parameter(cursor);
  run(path, {}, [this, cursor, dates = std::move(dates)](int status, const QByteArray& bytes, const QNetworkReply&) mutable {
    const auto page = responseData(bytes);
    const auto nextCursor = page.value("cursor").toString();
    if (status != 200 || nextCursor.isEmpty() || nextCursor == cursor) {
      if (status == 401 || status == 403) checkinDates_.clear();
      syncStatus_ = QStringLiteral("当前无法同步学习记录");
    } else {
      for (const auto& item : page.value("events").toList()) {
        const auto event = item.toMap().value("change").toMap();
        const auto date = event.value("localDate").toString();
        if (event.value("kind").toString() == QStringLiteral("learning.checkin.recorded") && !date.isEmpty()) dates.append(date);
      }
      if (page.value("hasMore").toBool()) {
        pullLearningFacts(nextCursor, std::move(dates));
        return;
      }
      dates.removeDuplicates();
      dates.sort(Qt::CaseSensitive);
      checkinDates_ = std::move(dates);
      syncStatus_ = QStringLiteral("已同步学习记录");
    }
    syncBusy_ = false;
    emit changed();
  });
}

QString UnifiedContentSource::offlineRoot() const {
  if (cacheDir_.isEmpty() || account_.isEmpty()) return {};
  const auto scope = digest(origin_.toEncoded() + '\0' + account_.toUtf8());
  return QDir(cacheDir_).filePath(QString::fromLatin1(scope) + QStringLiteral("/content"));
}

void UnifiedContentSource::finishOffline(const QString& message) {
  offlineBusy_ = false;
  offlineStatus_ = message;
  emit changed();
}

void UnifiedContentSource::saveOfflineBundle() {
  const auto root = offlineRoot();
  const auto bundle = catalog_.value("bundleId").toString();
  const auto hash = catalog_.value("manifestHash").toString();
  if (!connected() || offlineBusy_ || root.isEmpty() || !validBundle(bundle) || !validDigest(hash) ||
      !catalog_.value("capabilities").toStringList().contains(QStringLiteral("offlineBundle"))) return;
  const auto identity = contextKey();
  const auto service = catalog_.value("serviceInstance").toString();
  const auto vault = catalog_.value("vaultId").toString();
  const auto url = QStringLiteral("/api/content/bundles/") + bundle;
  const auto target = QDir(root).filePath(bundle);
  offlineBusy_ = true;
  offlineStatus_ = QStringLiteral("正在下载离线课程");
  emit changed();
  run(url + QStringLiteral("/manifest"), {}, [this, identity, service, vault, bundle, hash, url, target](int status, const QByteArray& bytes, const QNetworkReply&) {
    const auto meta = responseData(bytes);
    const auto files = meta.value("files").toList();
    const auto file = files.isEmpty() ? QVariantMap{} : files.first().toMap();
    const auto assets = meta.value("assets").toList();
    if (status != 200 || identity != contextKey() || meta.value("schemaVersion").toInt() != 1 ||
        meta.value("serviceInstance").toString() != service || meta.value("vaultId").toString() != vault ||
        meta.value("bundleId").toString() != bundle || meta.value("manifestHash").toString() != hash ||
        files.size() != 1 || file.value("path").toString() != QStringLiteral("content.json") ||
        file.value("sha256").toString() != hash || assets.size() > 250) {
      finishOffline(QStringLiteral("离线包清单校验失败"));
      return;
    }
    run(url + QStringLiteral("/payload"), {}, [this, identity, bundle, hash, target, file, assets](int payloadStatus, const QByteArray& payload, const QNetworkReply& reply) {
      if (payloadStatus != 200 || identity != contextKey() || reply.rawHeader("X-Content-Bundle") != bundle.toUtf8() ||
          payload.size() != file.value("size").toLongLong() || digest(payload) != hash.toUtf8() ||
          !QDir().mkpath(QDir(target).filePath(QStringLiteral("objects"))) ||
          !saveFile(QDir(target).filePath(QStringLiteral("content.json")), payload)) {
        finishOffline(QStringLiteral("离线课程正文校验失败"));
        return;
      }
      saveOfflineAssets(assets, 0, bundle, hash, target);
    });
  });
}

QVariantMap UnifiedContentSource::verifiedOfflineBundle(QVariantMap* outputPointer) const {
  const auto root = offlineRoot();
  if (root.isEmpty()) return {};
  const auto pointer = QJsonDocument::fromJson(loadFile(QDir(root).filePath(QStringLiteral("current.json")))).object().toVariantMap();
  const auto bundle = pointer.value("bundleId").toString();
  const auto hash = pointer.value("manifestHash").toString();
  const auto catalog = pointer.value("catalog").toMap();
  if (!validBundle(bundle) || !validDigest(hash) || catalog.value("bundleId").toString() != bundle ||
      catalog.value("manifestHash").toString() != hash) return {};
  const auto target = QDir(root).filePath(bundle);
  const auto bytes = loadFile(QDir(target).filePath(QStringLiteral("content.json")));
  if (bytes.isEmpty() || digest(bytes) != hash.toUtf8()) return {};
  const auto payload = QJsonDocument::fromJson(bytes).object().toVariantMap();
  if (payload.value("bundleId").toString() != bundle || payload.value("vaultId") != catalog.value("vaultId")) return {};
  for (const auto& item : payload.value("assets").toList()) {
    const auto asset = item.toMap();
    const auto assetHash = asset.value("sha256").toString();
    if (!validDigest(assetHash)) return {};
    const auto assetBytes = loadFile(QDir(target).filePath(QStringLiteral("objects/") + assetHash));
    if (assetBytes.size() != asset.value("size").toLongLong() || digest(assetBytes) != assetHash.toUtf8()) return {};
  }
  if (outputPointer) *outputPointer = pointer;
  return payload;
}

QVariantMap UnifiedContentSource::offlineLesson(const QString& contentId) const {
  const auto bundle = verifiedOfflineBundle();
  if (bundle.isEmpty() || bundle.value("bundleId") != catalog_.value("bundleId") ||
      bundle.value("vaultId") != catalog_.value("vaultId")) return {};
  QVariantMap lesson;
  for (const auto& item : bundle.value("lessons").toList()) {
    if (item.toMap().value("contentId").toString() == contentId) {
      lesson = item.toMap();
      break;
    }
  }
  if (lesson.isEmpty()) return {};
  QVariantList exercises;
  const auto ids = lesson.value("exerciseIds").toStringList();
  for (const auto& item : bundle.value("exercises").toList()) {
    if (ids.contains(item.toMap().value("exerciseId").toString())) exercises.append(item);
  }
  QVariantList images;
  const auto target = QDir(offlineRoot()).filePath(bundle.value("bundleId").toString());
  const auto markdown = lesson.value("reading").toMap().value("markdown").toString();
  for (const auto& item : bundle.value("assets").toList()) {
    const auto asset = item.toMap();
    const auto path = asset.value("path").toString();
    const auto key = asset.value("sha256").toString();
    if (!validDigest(key) || !markdown.contains('(' + path + ')')) continue;
    const auto filename = QDir(target).filePath(QStringLiteral("objects/") + key);
    images.append(QVariantMap{{"title", QFileInfo(path).fileName()}, {"url", QUrl::fromLocalFile(filename)}});
  }
  return QVariantMap{{"lesson", lesson}, {"exercises", exercises}, {"images", images}};
}

void UnifiedContentSource::saveOfflineAssets(const QVariantList& assets, int index, const QString& bundle, const QString& hash, const QString& target) {
  if (catalog_.value("bundleId").toString() != bundle || catalog_.value("manifestHash").toString() != hash) {
    finishOffline(QStringLiteral("课程快照已切换"));
    return;
  }
  if (index >= assets.size()) {
    const auto pointer = QJsonDocument(QJsonObject{{"bundleId", bundle}, {"manifestHash", hash},
      {"catalog", QJsonObject::fromVariantMap(catalog_)}, {"assets", QJsonArray::fromVariantList(assets)}}).toJson();
    finishOffline(saveFile(QDir(offlineRoot()).filePath(QStringLiteral("current.json")), pointer)
      ? QStringLiteral("离线课程已校验") : QStringLiteral("无法激活离线课程"));
    return;
  }
  const auto asset = assets.at(index).toMap();
  const auto digestValue = asset.value("sha256").toString();
  const auto id = asset.value("assetId").toString();
  static const QRegularExpression idPattern(QStringLiteral("^asset-[a-f0-9]{32}$"));
  if (!validDigest(digestValue) || !idPattern.match(id).hasMatch()) {
    finishOffline(QStringLiteral("离线附件清单无效"));
    return;
  }
  const auto path = QStringLiteral("/api/content/assets/") + id + QStringLiteral("?bundleId=") + bundle;
  run(path, {}, [this, assets, index, bundle, hash, target, asset, digestValue](int status, const QByteArray& bytes, const QNetworkReply& reply) {
    if (status != 200 || reply.rawHeader("X-Content-Bundle") != bundle.toUtf8() ||
        bytes.size() != asset.value("size").toLongLong() || digest(bytes) != digestValue.toUtf8() ||
        !saveFile(QDir(target).filePath(QStringLiteral("objects/") + digestValue), bytes)) {
      finishOffline(QStringLiteral("离线附件校验失败"));
      return;
    }
    saveOfflineAssets(assets, index + 1, bundle, hash, target);
  });
}
