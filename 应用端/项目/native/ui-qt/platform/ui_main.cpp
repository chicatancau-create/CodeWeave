#include "ui_shell.hpp"
#include "performance_probe.hpp"
#include "native_dialogs.hpp"
#include "challenge_runtime.hpp"
#include "challenge_submission_store.hpp"
#include "evidence_store.hpp"

#include <QGuiApplication>
#include <QAccessible>
#include <QColor>
#include <QDir>
#include <QDate>
#include <QFont>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQmlProperty>
#include <QQuickView>
#include <QCloseEvent>
#include <QClipboard>
#include <QCryptographicHash>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QTimer>
#include <QImage>
#include <QFontInfo>
#include <QQuickStyle>
#include <QStandardPaths>
#include <QProcessEnvironment>
#include <QSettings>
#include <QTemporaryDir>
#include <QUuid>
#include <QDesktopServices>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJSValue>
#include <QScreen>
#include <QUrl>

#include <filesystem>
#include <cmath>
#include <algorithm>
#include <iterator>
#include <string_view>

class ShellView final : public QQuickView {
 public:
  explicit ShellView(UiShell& shell) : shell_(shell) {}
 protected:
  void closeEvent(QCloseEvent* event) override {
    if (!shell_.requestClose()) event->ignore();
    else QQuickView::closeEvent(event);
  }
 private:
  UiShell& shell_;
};

std::filesystem::path configured_tool(std::string_view language,
    const std::filesystem::path& data_root) {
  QString suffix;
  QString executable;
  if (language == "cpp") { suffix = QStringLiteral("CPP"); executable = QStringLiteral("g++.exe"); }
  else if (language == "java") { suffix = QStringLiteral("JAVA"); executable = QStringLiteral("java.exe"); }
  else if (language == "python") { suffix = QStringLiteral("PYTHON"); executable = QStringLiteral("python.exe"); }
  else if (language == "javascript") { suffix = QStringLiteral("JAVASCRIPT"); executable = QStringLiteral("node.exe"); }
  else return {};
  const auto environment = QProcessEnvironment::systemEnvironment();
  const auto override = environment.value(QStringLiteral("CODEWEAVE_NATIVE_") + suffix +
      QStringLiteral("_TOOL"));
  if (!override.isEmpty()) return std::filesystem::path(override.toStdWString());

  const auto settings_path = data_root / "tools.ini";
  QSettings settings(QString::fromStdWString(settings_path.wstring()), QSettings::IniFormat);
  const auto stored = settings.value(QStringLiteral("tools/") +
      QString::fromUtf8(language.data(), static_cast<int>(language.size()))).toString();
  if (!stored.isEmpty()) return std::filesystem::path(stored.toStdWString());

  const auto path_value = environment.value(QStringLiteral("PATH"));
  for (const auto& entry : path_value.split(';', Qt::SkipEmptyParts)) {
    auto directory = entry.trimmed();
    if (directory.size() >= 2 && directory.front() == QLatin1Char('"') &&
        directory.back() == QLatin1Char('"')) directory = directory.mid(1, directory.size() - 2);
    if (directory.isEmpty() || directory.contains(QStringLiteral("WindowsApps"))) continue;
    const auto candidate = std::filesystem::path(directory.toStdWString()) /
        executable.toStdWString();
    std::error_code error;
    if (candidate.is_absolute() && std::filesystem::is_regular_file(candidate, error)) return candidate;
  }
  return {};
}

struct U3MatrixContext {
  QTemporaryDir data;
  QJsonArray checks;
  QJsonArray screenshots;
  QString output;
  QString screenshot_dir;
  QString blocked_draft_path;
  QByteArray checkin_bytes;
  QVariantMap review_before;
  QVariantMap workspace_reference;
  QSize detail_restore_size;
  bool detail_large = false;
  bool detail_small = false;
  int step = 0;
  int ticks = 0;
};

void u3_record(U3MatrixContext& context, const QString& name, bool passed,
    const QString& detail = {}) {
  QJsonObject item;
  item.insert(QStringLiteral("name"), name);
  item.insert(QStringLiteral("passed"), passed);
  if (!detail.isEmpty()) item.insert(QStringLiteral("detail"), detail);
  context.checks.append(item);
}

bool u3_screenshot(U3MatrixContext& context, QQuickView& view, const QString& name,
    const QSize& expected_size = {}) {
  const auto path = QDir(context.screenshot_dir).filePath(name + QStringLiteral(".png"));
  const auto image = view.grabWindow();
  const bool saved = view.isExposed() && !image.isNull() &&
      (expected_size.isEmpty() || image.size() == expected_size) && image.save(path);
  if (saved) context.screenshots.append(path);
  return saved;
}

bool u3_write_result(const U3MatrixContext& context) {
  QJsonObject result;
  result.insert(QStringLiteral("schemaVersion"), 1);
  result.insert(QStringLiteral("mode"), QStringLiteral("qt-real-window-input-matrix"));
  result.insert(QStringLiteral("isolatedData"), true);
  result.insert(QStringLiteral("checks"), context.checks);
  result.insert(QStringLiteral("screenshots"), context.screenshots);
  bool passed = true;
  for (const auto& value : context.checks) passed = passed && value.toObject().value("passed").toBool();
  result.insert(QStringLiteral("passed"), passed);
  QFile file(context.output);
  if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) return false;
  file.write(QJsonDocument(result).toJson(QJsonDocument::Indented));
  return file.flush();
}

bool u3_all_passed(const U3MatrixContext& context) {
  if (context.checks.isEmpty()) return false;
  for (const auto& value : context.checks) {
    if (!value.toObject().value(QStringLiteral("passed")).toBool()) return false;
  }
  return true;
}

void send_editor_shortcut(QQuickView& view, int key, Qt::KeyboardModifiers modifiers) {
  QKeyEvent press(QEvent::KeyPress, key, modifiers);
  QCoreApplication::sendEvent(&view, &press);
  QKeyEvent release(QEvent::KeyRelease, key, modifiers);
  QCoreApplication::sendEvent(&view, &release);
}

QQuickItem* u3_find_item(QQuickItem* parent, const QString& name) {
  if (parent->objectName() == name) return parent;
  for (auto* child : parent->childItems()) {
    if (auto* found = u3_find_item(child, name)) return found;
  }
  return nullptr;
}

bool u3_stage_terminal_visible(QQuickItem* root, const QVariantMap& event, bool failed) {
  auto* diagram = u3_find_item(root, QStringLiteral("executionStageDiagram"));
  if (!diagram) return false;
  const auto frame = diagram->property("frame").value<QJSValue>().toVariant().toMap();
  const auto nodes = frame.value(QStringLiteral("nodes")).toList();
  if (nodes.isEmpty()) return false;
  const auto terminal = nodes.last().toMap();
  return terminal.value(QStringLiteral("kind")).toString() == QStringLiteral("end") &&
      terminal.value(QStringLiteral("state")).toString() == QStringLiteral("now") &&
      terminal.value(QStringLiteral("label")) == event.value(QStringLiteral("label")) &&
      terminal.value(QStringLiteral("failed")).toBool() == failed &&
      diagram->property("currentNodeId").toString() ==
          QStringLiteral("event:") + event.value(QStringLiteral("sequence")).toString() &&
      diagram->property("currentNodeVisible").toBool();
}

bool u3_reveal_challenge_item(QQuickItem* root, const QString& name) {
  auto* scroll = u3_find_item(root, QStringLiteral("challengeLabSection"));
  auto* item = u3_find_item(root, name);
  auto* flick = scroll ? qobject_cast<QQuickItem*>(scroll->property("contentItem").value<QObject*>()) : nullptr;
  if (!flick || !item || !item->isVisible()) return false;
  const auto target = flick->property("contentY").toReal() + item->mapToItem(flick, QPointF()).y();
  flick->setProperty("contentY", std::clamp(target, 0.0,
      std::max(0.0, scroll->property("contentHeight").toReal() - flick->height())));
  const auto top = item->mapToItem(flick, QPointF()).y();
  return top >= -1 && top + item->height() <= flick->height() + 1;
}

int main(int argc, char* argv[]) {
  if (argc == 2 && std::string_view(argv[1]) == "--challenge-worker") {
    QCoreApplication application(argc, argv);
    return challenge_worker_main();
  }
  for (int index = 1; index < argc; ++index) {
    if (std::string_view(argv[index]) == "--visual-comparison-json" ||
        std::string_view(argv[index]) == "--u3-matrix-json" ||
        std::string_view(argv[index]) == "--qml-load-smoke")
      QGuiApplication::setHighDpiScaleFactorRoundingPolicy(Qt::HighDpiScaleFactorRoundingPolicy::Floor);
  }
  const double entered = probe_clock();
  MeasuredApplication application(argc, argv);
  const auto arguments = application.arguments();
  const bool qml_smoke = arguments.contains(QStringLiteral("--qml-load-smoke"));
  const auto qml_smoke_arg = arguments.indexOf(QStringLiteral("--qml-load-smoke"));
  const bool smoke_preference_storage_unavailable =
      arguments.contains(QStringLiteral("--qml-load-smoke-preferences-unavailable"));
  const auto topbar_reference = arguments.indexOf(QStringLiteral("--topbar-reference-content"));
  if (topbar_reference >= 0 && (!qml_smoke || topbar_reference + 1 >= arguments.size())) return 2;
  const auto benchmark = arguments.indexOf(QStringLiteral("--benchmark-json"));
  if (benchmark >= 0 && benchmark + 1 >= arguments.size()) return 2;
  const auto matrix = arguments.indexOf(QStringLiteral("--u3-matrix-json"));
  if (matrix >= 0 && matrix + 1 >= arguments.size()) return 2;
  const auto comparison = arguments.indexOf(QStringLiteral("--visual-comparison-json"));
  if (comparison >= 0 && (comparison + 1 >= arguments.size() || matrix >= 0 || benchmark >= 0)) return 2;
  if (qml_smoke && (matrix >= 0 || comparison >= 0 || benchmark >= 0)) return 2;
  if (qml_smoke && (qml_smoke_arg + 1 >= arguments.size())) return 2;
  if (smoke_preference_storage_unavailable && !qml_smoke) return 2;
  const bool isolated_window = matrix >= 0 || comparison >= 0;
  std::unique_ptr<QTemporaryDir> benchmark_data;
  if (benchmark >= 0 || qml_smoke) benchmark_data = std::make_unique<QTemporaryDir>();
  std::unique_ptr<U3MatrixContext> matrix_context;
  if (isolated_window) {
    matrix_context = std::make_unique<U3MatrixContext>();
    matrix_context->output = arguments.at((comparison >= 0 ? comparison : matrix) + 1);
    matrix_context->screenshot_dir = QFileInfo(matrix_context->output).absolutePath();
    if (!matrix_context->data.isValid() || matrix_context->screenshot_dir.isEmpty()) return 2;
    QDir().mkpath(matrix_context->screenshot_dir);
    const auto config_dir = QDir(matrix_context->data.path()).filePath(QStringLiteral("config"));
    if (!QDir().mkpath(config_dir)) return 2;
    QFile workspace_marker(QDir(config_dir).filePath(QStringLiteral("codeweave.config.example.json")));
    if (!workspace_marker.open(QIODevice::WriteOnly | QIODevice::Truncate)) return 2;
    workspace_marker.write("{}\n");
    workspace_marker.close();
  }
  UiShell shell;
  const auto workspace = QProcessEnvironment::systemEnvironment().value(
      QStringLiteral("CODEWEAVE_NATIVE_WORKSPACE"), QCoreApplication::applicationDirPath());
  const auto localAppData = QProcessEnvironment::systemEnvironment().value(
      QStringLiteral("LOCALAPPDATA"), QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation));
  if ((benchmark >= 0 || qml_smoke) && !benchmark_data->isValid()) return 2;
  const auto nativeData = benchmark >= 0 || qml_smoke ? benchmark_data->path() :
      (isolated_window ? QDir(matrix_context->data.path()).filePath(QStringLiteral("data")) :
      QDir(localAppData).filePath(QStringLiteral("CodeWeave")));
  const auto effectiveWorkspace = isolated_window ? matrix_context->data.path() :
      (qml_smoke ? benchmark_data->path() : workspace);
  if (!smoke_preference_storage_unavailable)
    shell.configurePreferenceStorage(std::filesystem::path(nativeData.toStdWString()));
  shell.configureAccountStorage(effectiveWorkspace.toStdWString(), nativeData.toStdWString());
  if (!isolated_window && !qml_smoke && benchmark < 0) {
    QSettings settings(QDir(nativeData).filePath(QStringLiteral("tools.ini")), QSettings::IniFormat);
    const auto vault = settings.value(QStringLiteral("vault/root")).toString();
    if (!vault.isEmpty()) shell.configureVaultRoot(vault.toStdWString());
  }
  const auto nativeDataPath = std::filesystem::path(nativeData.toStdWString());
  for (const auto language : {std::string_view("cpp"), std::string_view("java"),
                              std::string_view("python"), std::string_view("javascript")}) {
    shell.configureExecutionTool(QString::fromUtf8(language.data(),
        static_cast<int>(language.size())), configured_tool(language, nativeDataPath));
  }
  const auto contentRoot = topbar_reference >= 0 ? arguments.at(topbar_reference + 1) :
      QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("content"));
  shell.loadPublishedContent(contentRoot);
  ShellView view(shell);
  QObject::connect(&shell, &UiShell::vaultSelectionRequested, &view, [&] {
    const auto path = choose_native_path(reinterpret_cast<HWND>(view.winId()),
        L"选择资料库根目录（仅连接，确认提交前不修改资料库）", true);
    if (!path.empty()) {
      shell.configureVaultRoot(path);
      if (!isolated_window && !qml_smoke && benchmark < 0) {
        QSettings settings(QDir(nativeData).filePath(QStringLiteral("tools.ini")), QSettings::IniFormat);
        settings.setValue(QStringLiteral("vault/root"), QString::fromStdWString(path.wstring()));
      }
    }
  });
  QObject::connect(&shell, &UiShell::toolSelectionRequested, &view, [&](const QString& language) {
    const auto path = choose_native_path(reinterpret_cast<HWND>(view.winId()),
        L"选择编译器或解释器", false, L"*.exe");
    if (path.empty()) return;
    shell.configureExecutionTool(language, path);
    QSettings settings(QDir(nativeData).filePath(QStringLiteral("tools.ini")), QSettings::IniFormat);
    settings.setValue(QStringLiteral("tools/") + language, QString::fromStdWString(path.wstring()));
  });
  QObject::connect(&shell, &UiShell::dataActionRequested, &view, [&](const QString& action) {
    if (action == "open") {
      QDesktopServices::openUrl(QUrl::fromLocalFile(QString::fromStdWString(shell.nativeDataRoot().wstring())));
      return;
    }
    const auto owner = reinterpret_cast<HWND>(view.winId());
    std::filesystem::path source;
    if (action != "backup") {
      source = choose_native_path(owner, L"选择备份目录或旧数据 JSON", action == "restore", L"*.json");
      if (source.empty()) return;
    }
    const auto parent = choose_native_path(owner, L"选择保存位置（创建新目录，不覆盖已有数据）", true);
    if (parent.empty()) return;
    const auto target = parent / (L"CodeWeave-" + QUuid::createUuid().toString(QUuid::Id128).toStdWString());
    shell.performDataAction(action, source, target);
  });
  // The shell layout needs room for the 240px sidebar plus the 286px learning
  // rail. Below roughly 1100px the hero's copy column starts eliding its title,
  // so size the window to the screen instead of taking the window manager's
  // default (which was landing on the 960x720 minimum).
  view.setMinimumSize(QSize(1100, 720));
  if (const auto* screen = QGuiApplication::primaryScreen()) {
    const auto available = screen->availableGeometry();
    view.resize(qMin(1440, static_cast<int>(available.width() * 0.92)),
        qMin(900, static_cast<int>(available.height() * 0.92)));
  }
  if (comparison >= 0) {
    view.setFlags(Qt::Window | Qt::FramelessWindowHint);
    view.setMinimumSize(QSize(1440, 900));
    view.setMaximumSize(QSize(1440, 900));
    view.resize(1440, 900);
  }
  if (qml_smoke) {
    view.setFlags(Qt::Window | Qt::FramelessWindowHint);
    view.setMinimumSize(QSize(1440, 900));
    view.setMaximumSize(QSize(1440, 900));
    view.resize(1440, 900);
  }
  view.setTitle(shell.appTitle());
  view.rootContext()->setContextProperty(QStringLiteral("uiShell"), &shell);
  view.setResizeMode(QQuickView::SizeRootObjectToView);
  QStringList qml_warnings;
  if (qml_smoke || isolated_window) {
    QObject::connect(view.engine(), &QQmlEngine::warnings, &application,
        [&](const QList<QQmlError>& warnings) {
          for (const auto& warning : warnings) qml_warnings.append(warning.toString());
        });
  }
  view.loadFromModule(QStringLiteral("CodeWeave.Ui"), QStringLiteral("Main"));
  if (view.status() == QQuickView::Error) return 1;
  view.show();
  QTimer qml_smoke_timer;
  int qml_smoke_page = 0;
  int qml_smoke_ticks = 0;
  QSize smoke_expected_size(1440, 900);
  const auto report_path = qml_smoke ? arguments.at(qml_smoke_arg + 1) : QString{};
  QString diagnostic = QStringLiteral("running");
  QStringList smoke_screenshots;
  QJsonArray smoke_geometry;
  QJsonArray smoke_popup_geometry;
  QJsonArray smoke_settings_rows;
  QJsonArray smoke_settings_text;
  QJsonArray smoke_topbar_geometry;
  bool smoke_reference_ready = false;
  bool smoke_reference_registration_started = false;
  QString smoke_preference_draft;
  qulonglong smoke_preference_revision = 0;
  const auto write_smoke_report = [&] {
      QJsonObject report;
      report.insert(QStringLiteral("diagnostic"), diagnostic);
      report.insert(QStringLiteral("qmlWarnings"), QJsonArray::fromStringList(qml_warnings));
      report.insert(QStringLiteral("screenshots"), QJsonArray::fromStringList(smoke_screenshots));
      report.insert(QStringLiteral("geometry"), smoke_geometry);
      report.insert(QStringLiteral("popupGeometry"), smoke_popup_geometry);
      report.insert(QStringLiteral("settingsRows"), smoke_settings_rows);
      report.insert(QStringLiteral("settingsText"), smoke_settings_text);
      report.insert(QStringLiteral("topbarGeometry"), smoke_topbar_geometry);
      report.insert(QStringLiteral("referenceAccount"), topbar_reference >= 0);
      report.insert(QStringLiteral("preferenceStorageReady"), shell.preferenceStorageReady());
      report.insert(QStringLiteral("preferenceStorageUnavailableSmoke"),
          smoke_preference_storage_unavailable);
      report.insert(QStringLiteral("referenceSubject"), topbar_reference >= 0 ? QStringLiteral("Python") : QString());
      report.insert(QStringLiteral("accountName"), shell.accountName());
      report.insert(QStringLiteral("accountContact"), shell.accountContact());
      report.insert(QStringLiteral("lessonCount"), shell.lessonMeta().size());
      QJsonArray lesson_ids;
      for (const auto& lesson : shell.lessonMeta()) lesson_ids.append(lesson.toMap().value("id").toString());
      report.insert(QStringLiteral("lessonIds"), lesson_ids);
      auto* study = view.rootObject()->findChild<QObject*>(QStringLiteral("studyPageRoot"));
      QJsonArray filtered_ids;
      if (study) {
        for (const auto& lesson : study->property("filteredLessons").value<QJSValue>().toVariant().toList())
          filtered_ids.append(lesson.toMap().value("id").toString());
      }
      report.insert(QStringLiteral("filteredLessonIds"), filtered_ids);
      report.insert(QStringLiteral("selectedLesson"), QJsonObject::fromVariantMap(
          view.rootObject()->property("selectedLesson").toMap()));
      QFile report_file(report_path);
      return report_file.open(QIODevice::WriteOnly | QIODevice::Truncate) &&
          report_file.write(QJsonDocument(report).toJson(QJsonDocument::Indented)) >= 0 && report_file.flush();
  };
  const auto capture_topbar = [&](const QString& name) {
    if (name == QStringLiteral("topbar-shell")) {
      const QStringList items{QStringLiteral("topbarBrand"), QStringLiteral("topbarAreas"),
          QStringLiteral("globalSearchBox"), QStringLiteral("topbarActions")};
      for (const auto& item_name : items) {
        auto* item = view.rootObject()->findChild<QQuickItem*>(item_name);
        if (!item || !item->isVisible() || item->width() <= 0 || item->height() <= 0) {
          diagnostic = QStringLiteral("Topbar geometry item is missing: ") + item_name;
          write_smoke_report();
          return false;
        }
        const auto origin = item->mapToItem(view.rootObject(), QPointF());
        smoke_topbar_geometry.append(QJsonObject{{"name", item_name}, {"x", origin.x()},
            {"y", origin.y()}, {"width", item->width()}, {"height", item->height()}});
      }
    }
    if (QGuiApplication::platformName() == QStringLiteral("offscreen")) return true;
    const auto expected = name.endsWith(QStringLiteral("small")) ? QSize(1100, 720) : QSize(1440, 900);
    if (view.size() != expected) {
      diagnostic = QStringLiteral("Capture %1 expected %2x%3, got %4x%5")
          .arg(name).arg(expected.width()).arg(expected.height()).arg(view.width()).arg(view.height());
      write_smoke_report();
      return false;
    }
    const auto popup_name = name == QStringLiteral("topbar-search") ? "searchPopup" :
        name == QStringLiteral("topbar-quick") ? "quickPopup" :
        name == QStringLiteral("topbar-notifications") ? "notificationPopup" :
        name == QStringLiteral("topbar-account") ? "accountPopup" : nullptr;
    if (popup_name) {
      auto* popup = view.rootObject()->findChild<QObject*>(QString::fromLatin1(popup_name));
      auto* anchor = popup ? qobject_cast<QQuickItem*>(popup->property("anchorItem").value<QObject*>()) : nullptr;
      const auto x = popup ? popup->property("x").toReal() : -1;
      const auto y = popup ? popup->property("y").toReal() : -1;
      const auto width = popup ? popup->property("width").toReal() : 0;
      const auto height = popup ? popup->property("height").toReal() : 0;
      const auto origin = anchor ? anchor->mapToItem(view.rootObject(), QPointF(0, anchor->height())) : QPointF();
      const auto gap = popup ? popup->property("anchorGap").toReal() : 0;
      const bool right = popup && popup->property("alignRight").toBool();
      const auto anchor_edge = origin.x() + (anchor && right ? anchor->width() : 0);
      if (!anchor || x < 0 || y < 50 || x + width > view.width() + 1 || y + height > view.height() + 1 ||
          std::abs(y - origin.y() - gap) > 1 || std::abs(x + (right ? width : 0) - anchor_edge) > 1) {
        diagnostic = QStringLiteral("Capture %1 popup is not anchored: %2,%3 %4x%5 anchor %6,%7")
            .arg(name).arg(x).arg(y).arg(width).arg(height).arg(origin.x()).arg(origin.y());
        write_smoke_report();
        return false;
      }
      smoke_popup_geometry.append(QJsonObject{{"name", name}, {"x", x}, {"y", y},
          {"width", width}, {"height", height}, {"anchorBottom", origin.y()}, {"anchorEdge", anchor_edge}});
      if (name == QStringLiteral("topbar-account")) {
        auto* contact = view.rootObject()->findChild<QObject*>(QStringLiteral("accountContactLabel"));
        if (!contact || contact->property("text").toString() != shell.accountContact()) {
          diagnostic = QStringLiteral("Account popup contact does not match the active account");
          write_smoke_report();
          return false;
        }
      }
    }
    const auto image = view.grabWindow();
    if (image.isNull() || image.size() != expected) {
      diagnostic = QStringLiteral("Capture %1 expected image %2x%3, got %4x%5 (DPR %6)")
          .arg(name).arg(expected.width()).arg(expected.height())
          .arg(image.width()).arg(image.height()).arg(view.devicePixelRatio());
      write_smoke_report();
      return false;
    }
    const auto path = QFileInfo(report_path).dir().filePath(name + QStringLiteral(".png"));
    if (!image.save(path)) {
      diagnostic = QStringLiteral("Could not save screenshot: ") + path;
      write_smoke_report();
      return false;
    }
    smoke_screenshots.append(path);
    smoke_geometry.append(QJsonObject{{"name", name}, {"width", view.width()}, {"height", view.height()},
        {"pixelWidth", image.width()}, {"pixelHeight", image.height()},
        {"devicePixelRatio", view.devicePixelRatio()}});
    return true;
  };
  if (qml_smoke) {
    QObject::connect(&qml_smoke_timer, &QTimer::timeout, &application, [&] {
      if (++qml_smoke_ticks > 200) {
        diagnostic = QStringLiteral("QML smoke timed out while waiting for its viewport");
        write_smoke_report();
        application.exit(1);
        return;
      }
      if (shell.accountBusy() || shell.contentBusy()) return;
      if (topbar_reference >= 0 && !smoke_reference_ready) {
        if (!shell.hasActiveAccount()) {
          if (!smoke_reference_registration_started) {
            smoke_reference_registration_started = true;
            shell.registerAccount(QStringLiteral("Reference"), QStringLiteral("topbar@example.test"),
                QStringLiteral("Topbar-Reference-123!"));
          }
          return;
        }
        int selected = -1;
        const auto lessons = shell.lessonMeta();
        for (qsizetype index = 0; index < lessons.size(); ++index)
          if (lessons.at(index).toMap().value("id").toString() == QStringLiteral("python-loop-sum"))
            selected = static_cast<int>(index);
        if (selected < 0) {
          diagnostic = QStringLiteral("Isolated reference account or python-loop-sum content is missing");
          write_smoke_report();
          application.exit(1);
          return;
        }
        view.rootObject()->setProperty("selectedLessonIndex", selected);
        auto* study = view.rootObject()->findChild<QObject*>(QStringLiteral("studyPageRoot"));
        const auto subjects = study ? study->property("subjectOptions").value<QJSValue>().toVariant().toList() : QVariantList{};
        int python = -1;
        for (qsizetype index = 0; index < subjects.size(); ++index)
          if (subjects.at(index).toString() == QStringLiteral("Python")) python = static_cast<int>(index);
        if (python < 0 || !QMetaObject::invokeMethod(study, "selectSubject", Qt::DirectConnection,
                Q_ARG(QVariant, python))) {
          diagnostic = QStringLiteral("Python reference filter is unavailable");
          write_smoke_report();
          application.exit(1);
          return;
        }
        QCoreApplication::processEvents();
        const auto filtered = study->property("filteredLessons").value<QJSValue>().toVariant().toList();
        const bool selected_in_filter = std::any_of(filtered.cbegin(), filtered.cend(), [&](const QVariant& lesson) {
          return lesson.toMap().value("id").toString() == QStringLiteral("python-loop-sum");
        });
        if (study->property("subjectFilter").toInt() != python || filtered.size() != 6 || !selected_in_filter) {
          diagnostic = QStringLiteral("Python reference filter did not apply to the initial visible state");
          write_smoke_report();
          application.exit(1);
          return;
        }
        smoke_reference_ready = true;
      }
      if (view.windowState() != Qt::WindowNoState || view.size() != smoke_expected_size) {
        view.setWindowState(Qt::WindowNoState);
        view.setMinimumSize(smoke_expected_size);
        view.setMaximumSize(smoke_expected_size);
        view.resize(smoke_expected_size);
        return;
      }
      if (!qml_warnings.isEmpty()) {
        diagnostic = QStringLiteral("QML warning: ") + qml_warnings.join(QLatin1Char('\n'));
        write_smoke_report();
        qWarning("QML smoke: %s", qPrintable(qml_warnings.join(QLatin1Char('\n'))));
        application.exit(1);
        return;
      }
      const auto loaders = view.rootObject()->findChildren<QObject*>(QStringLiteral("pageLoader"));
      if (loaders.size() != 9) {
        diagnostic = QStringLiteral("Expected 9 page Loaders, found %1").arg(loaders.size());
        write_smoke_report();
        qWarning("QML smoke: expected 9 page Loaders, found %d", static_cast<int>(loaders.size()));
        application.exit(1);
        return;
      }
      for (auto* loader : loaders) {
        if (loader->property("status").toInt() == 3) {
          diagnostic = QStringLiteral("Page Loader reported an error");
          write_smoke_report();
          application.exit(1);
          return;
        }
      }
      const QStringList pages{QStringLiteral("挑战"), QStringLiteral("草稿"), QStringLiteral("复习与进度"),
          QStringLiteral("分析"), QStringLiteral("账户"), QStringLiteral("账户安全"),
          QStringLiteral("数据与隐私"), QStringLiteral("编辑器")};
      if (qml_smoke_page < pages.size()) {
        shell.selectPage(pages.at(qml_smoke_page++));
        return;
      }
      for (auto* loader : loaders) {
        if (loader->property("status").toInt() != 1) {
          diagnostic = QStringLiteral("Visited page Loader is not ready (status %1)").arg(loader->property("status").toInt());
          write_smoke_report();
          qWarning("QML smoke: visited page Loader is not ready (status %d)", loader->property("status").toInt());
          application.exit(1);
          return;
        }
      }
      auto* quick = view.rootObject()->findChild<QObject*>(QStringLiteral("quickPopup"));
      auto* account = view.rootObject()->findChild<QObject*>(QStringLiteral("accountPopup"));
      auto* trigger = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("quickButton"));
      auto* first = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("continueAction"));
      auto* review = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("reviewAction"));
      auto* help = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("helpAction"));
      auto* profile = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("profileAction"));
      auto* security = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityAction"));
      auto* privacy = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("privacyAction"));
      auto* export_action = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("exportAction"));
      auto* logout_action = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("logoutAction"));
      auto* notifications = view.rootObject()->findChild<QObject*>(QStringLiteral("notificationPopup"));
      auto* notification_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("notificationButton"));
      auto* settings = view.rootObject()->findChild<QObject*>(QStringLiteral("settingsDialog"));
      auto* settings_scroll = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("settingsScroll"));
      auto* settings_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("settingsButton"));
      auto* help_dialog = view.rootObject()->findChild<QObject*>(QStringLiteral("helpDialog"));
      auto* search = view.rootObject()->findChild<QObject*>(QStringLiteral("searchPopup"));
      auto* search_field = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("globalSearchField"));
      auto* search_results = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("searchResultsView"));
      if (!notifications || !notification_button || !settings || !settings_scroll || !settings_button || !help_dialog ||
          !search || !search_field || !search_results) {
        diagnostic = QStringLiteral("Topbar smoke objects are missing");
        write_smoke_report();
        application.exit(1);
        return;
      }
      const auto inspect_settings_text = [&](const QString& viewport) {
        for (int index = 0; index < 8; ++index) {
          auto* row = u3_find_item(settings_scroll,
              QStringLiteral("settingsPreferenceRow%1").arg(index));
          auto* title = row ? u3_find_item(row,
              QStringLiteral("settingsPreferenceTitle%1").arg(index)) : nullptr;
          auto* description = row ? u3_find_item(row,
              QStringLiteral("settingsPreferenceDescription%1").arg(index)) : nullptr;
          const auto text_metrics = [&](QQuickItem* item) {
            if (!item) return QJsonObject{{"found", false}, {"fitsRow", false}};
            const auto metric = [item](const char* name) {
              bool valid = false;
              const auto value = item->property(name).toDouble(&valid);
              return QJsonObject{{"valid", valid}, {"value", value}};
            };
            const auto origin = item->mapToItem(row, QPointF());
            const auto implicit_height = metric("implicitHeight");
            const auto painted_width = metric("paintedWidth");
            const auto painted_height = metric("paintedHeight");
            const auto content_height = metric("contentHeight");
            const auto within = [&](const QJsonObject& value, double limit) {
              const auto number = value.value("value").toDouble();
              return value.value("valid").toBool() && std::isfinite(number) && number <= limit + 1;
            };
            const bool fits_row = row && item->isVisible() && !item->property("truncated").toBool() &&
                item->width() > 0 && item->height() > 0 && origin.x() >= -1 && origin.y() >= -1 &&
                origin.x() + item->width() <= row->width() + 1 &&
                origin.y() + item->height() <= row->height() + 1 &&
                within(implicit_height, item->height()) && within(content_height, item->height()) &&
                within(painted_width, item->width()) && within(painted_height, item->height());
            return QJsonObject{{"found", true}, {"fitsRow", fits_row},
                {"x", origin.x()}, {"y", origin.y()}, {"width", item->width()},
                {"height", item->height()}, {"implicitHeight", implicit_height},
                {"contentHeight", content_height}, {"paintedWidth", painted_width},
                {"paintedHeight", painted_height},
                {"truncated", item->property("truncated").toBool()}};
          };
          const auto title_metrics = text_metrics(title);
          const auto description_metrics = text_metrics(description);
          const bool passed = row && row->isVisible() && title_metrics.value("fitsRow").toBool() &&
              description_metrics.value("fitsRow").toBool() &&
              view.size() == (viewport == QStringLiteral("1440x900")
                  ? QSize(1440, 900) : QSize(1100, 720));
          QJsonObject result{{"viewport", viewport}, {"windowWidth", view.width()},
              {"windowHeight", view.height()}, {"storageReady", shell.preferenceStorageReady()},
              {"index", index}, {"rowWidth", row ? row->width() : -1},
              {"rowHeight", row ? row->height() : -1}, {"title", title_metrics},
              {"description", description_metrics}, {"passed", passed}};
          smoke_settings_text.append(result);
          if (!passed) {
            diagnostic = QStringLiteral("Settings text geometry failed at %1 row %2: %3")
                .arg(viewport).arg(index)
                .arg(QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact)));
            return false;
          }
        }
        return true;
      };
      const auto require_reference_close_style = [&](QObject* dialog) {
        auto* tokens = view.rootObject()->findChild<QObject*>(QStringLiteral("designSystem"));
        auto* close = dialog->findChild<QQuickItem*>(QStringLiteral("shellDialogHeaderClose"));
        const auto move_pointer = [&](const QPointF& point) {
          QMouseEvent move(QEvent::MouseMove, point, point, view.mapToGlobal(point.toPoint()),
              Qt::NoButton, Qt::NoButton, Qt::NoModifier);
          QCoreApplication::sendEvent(&view, &move);
          QCoreApplication::processEvents();
        };
        move_pointer(QPointF(1, 1));
        const bool resting_style = tokens && close && close->isVisible() && std::abs(close->width() - 44) < 0.01 &&
            std::abs(close->height() - 44) < 0.01 && close->property("radius").toReal() == 0 &&
            QQmlProperty::read(close, QStringLiteral("border.width")).toReal() == 1 &&
            QQmlProperty::read(close, QStringLiteral("border.color")).value<QColor>() ==
                tokens->property("line").value<QColor>();
        if (resting_style) {
          move_pointer(close->mapToScene(QPointF(close->width() / 2, close->height() / 2)));
          const bool hovered_style = QQmlProperty::read(close, QStringLiteral("border.color")).value<QColor>() ==
              tokens->property("lineStrong").value<QColor>();
          move_pointer(QPointF(1, 1));
          if (hovered_style && QQmlProperty::read(close, QStringLiteral("border.color")).value<QColor>() ==
              tokens->property("line").value<QColor>()) return true;
        }
        diagnostic = QStringLiteral("Reference dialog close button square outline or hover state is incorrect");
        write_smoke_report();
        application.exit(1);
        return false;
      };
      if (!quick || !account || !trigger || !first || !review || !help || !profile || !security || !privacy ||
          !export_action || !logout_action) {
        diagnostic = QStringLiteral("Menu smoke objects are missing: quick=%1 account=%2 trigger=%3 first=%4 review=%5 help=%6 profile=%7 security=%8 privacy=%9 logout=%10")
            .arg(quick != nullptr).arg(account != nullptr).arg(trigger != nullptr).arg(first != nullptr)
            .arg(review != nullptr).arg(help != nullptr).arg(profile != nullptr).arg(security != nullptr)
            .arg(privacy != nullptr);
        write_smoke_report();
        qWarning("QML smoke: menu objects missing");
        application.exit(1);
        return;
      }
      // Packaged content can enable Continue; the minimal CTest host has no selected lesson.
      first = first->property("enabled").toBool() ? first : review;
      const auto require_focus = [&](QQuickItem* item) {
        if (item->hasActiveFocus()) return true;
        const auto* active = view.activeFocusItem();
        diagnostic = QStringLiteral("Menu focus assertion failed at step %1: quickOpened=%2 accountOpened=%3 windowActive=%4 target=%5 active=%6")
            .arg(qml_smoke_page).arg(quick->property("opened").toBool())
            .arg(account->property("opened").toBool()).arg(view.isActive())
            .arg(QString::fromUtf8(item->objectName().toUtf8()))
            .arg(active ? QString::fromUtf8(active->objectName().toUtf8()) : QStringLiteral("<none>"));
        write_smoke_report();
        qWarning("QML smoke: incorrect menu focus");
        application.exit(1);
        return false;
      };
      switch (qml_smoke_page++ - pages.size()) {
        case 0:
          shell.selectPage(QStringLiteral("学习"));
          view.requestActivate();
          QMetaObject::invokeMethod(quick, "open");
          break;
        case 1:
          if (!require_focus(first)) return;
          send_editor_shortcut(view, Qt::Key_End, Qt::NoModifier);
          break;
        case 2:
          if (!require_focus(help)) return;
          send_editor_shortcut(view, Qt::Key_Down, Qt::NoModifier);
          break;
        case 3:
          if (!require_focus(first)) return;
          send_editor_shortcut(view, Qt::Key_Up, Qt::NoModifier);
          break;
        case 4:
          if (!require_focus(help)) return;
          send_editor_shortcut(view, Qt::Key_Home, Qt::NoModifier);
          break;
        case 5:
          if (!require_focus(first)) return;
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          break;
        case 6:
          if (quick->property("opened").toBool() || !require_focus(trigger)) {
            diagnostic = QStringLiteral("Quick popup did not close or trigger did not regain focus");
            write_smoke_report();
            application.exit(1);
            return;
          }
          QMetaObject::invokeMethod(account, "open");
          break;
        case 7:
          if (!require_focus(profile)) return;
          if (!capture_topbar(QStringLiteral("topbar-account"))) { application.exit(1); return; }
          send_editor_shortcut(view, Qt::Key_End, Qt::NoModifier);
          break;
        case 8:
          if (!require_focus(shell.hasActiveAccount() ? logout_action : privacy)) return;
          send_editor_shortcut(view, Qt::Key_Up, Qt::NoModifier);
          break;
        case 9:
          if (!require_focus(shell.hasActiveAccount() ? export_action : security)) return;
          send_editor_shortcut(view, Qt::Key_Home, Qt::NoModifier);
          break;
        case 10:
          if (!require_focus(profile)) return;
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          break;
        case 11:
          if (account->property("opened").toBool()) {
            diagnostic = QStringLiteral("Account popup did not close on Escape");
            write_smoke_report();
            application.exit(1);
            return;
          }
          if (!QMetaObject::invokeMethod(security, "clicked", Qt::DirectConnection)) {
            diagnostic = QStringLiteral("Account security menu action could not be invoked");
            write_smoke_report();
            application.exit(1);
            return;
          }
          break;
        case 12:
          if (shell.currentPage() != QStringLiteral("账户安全")) {
            diagnostic = QStringLiteral("Account menu did not navigate to security page");
            write_smoke_report();
            application.exit(1);
            return;
          }
          if (!QMetaObject::invokeMethod(privacy, "clicked", Qt::DirectConnection)) {
            diagnostic = QStringLiteral("Account privacy menu action could not be invoked");
            write_smoke_report();
            application.exit(1);
            return;
          }
          break;
        case 13:
          if (shell.currentPage() != QStringLiteral("数据与隐私")) {
            diagnostic = QStringLiteral("Account menu did not navigate to privacy page");
            write_smoke_report();
            application.exit(1);
            return;
          }
          {
            auto* breadcrumb = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbs"));
            auto* accessible_breadcrumb = breadcrumb
                ? QAccessible::queryAccessibleInterface(breadcrumb) : nullptr;
            if (!breadcrumb || breadcrumb->property("text").toString() !=
                    QStringLiteral("Code Canvas / 数据 / 数据与隐私") ||
                !accessible_breadcrumb || accessible_breadcrumb->text(QAccessible::Name) !=
                    QStringLiteral("当前位置：Code Canvas / 数据 / 数据与隐私")) {
              diagnostic = QStringLiteral("Breadcrumb did not follow the current page");
              write_smoke_report();
              application.exit(1);
              return;
            }
          }
          shell.selectPage(QStringLiteral("学习"));
          if (!capture_topbar(QStringLiteral("topbar-shell"))) { application.exit(1); return; }
          QMetaObject::invokeMethod(quick, "open");
          break;
        case 14:
          if (!require_focus(first)) return;
          if (!capture_topbar(QStringLiteral("topbar-quick"))) { application.exit(1); return; }
          QMetaObject::invokeMethod(notification_button, "clicked");
          break;
        case 15:
          if (quick->property("opened").toBool() || !notifications->property("opened").toBool()) {
            diagnostic = QStringLiteral("Notifications did not replace quick actions");
            write_smoke_report();
            application.exit(1);
            return;
          }
          if (!capture_topbar(QStringLiteral("topbar-notifications"))) { application.exit(1); return; }
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          break;
        case 16:
          if (!require_focus(notification_button)) return;
          QMetaObject::invokeMethod(settings_button, "clicked");
          break;
        case 17:
          if (!settings->property("opened").toBool()) {
            diagnostic = QStringLiteral("Settings did not open");
            write_smoke_report();
            application.exit(1);
            return;
          }
          if (!require_reference_close_style(settings)) return;
          if (!inspect_settings_text(QStringLiteral("1440x900"))) {
            write_smoke_report();
            application.exit(1);
            return;
          }
          if (smoke_preference_storage_unavailable) {
            for (const int index : {3, 4, 7}) {
              const auto row_name = QStringLiteral("settingsPreferenceRow%1").arg(index);
              auto* row = u3_find_item(settings_scroll, row_name);
              const auto control_name = index == 3 ? QStringLiteral("settingsReducedMotionToggle") :
                  index == 4 ? QStringLiteral("settingsEditorFontSize") :
                  QStringLiteral("settingsEditorLineNumbersToggle");
              auto* control = row ? u3_find_item(row, control_name) : nullptr;
              auto* description = row ? u3_find_item(row,
                  QStringLiteral("settingsPreferenceDescription%1").arg(index)) : nullptr;
              if (!control || control->property("enabled").toBool() || !description ||
                  !description->property("text").toString().endsWith(QStringLiteral("（本机配置不可用）"))) {
                diagnostic = QStringLiteral("Unavailable preference storage state is missing at row %1").arg(index);
                write_smoke_report();
                application.exit(1);
                return;
              }
            }
            if (!capture_topbar(QStringLiteral("topbar-settings"))) { application.exit(1); return; }
            smoke_expected_size = QSize(1100, 720);
            view.setMinimumSize(QSize(1100, 720));
            view.setMaximumSize(QSize(1100, 720));
            view.setWindowState(Qt::WindowNoState);
            view.resize(1100, 720);
            break;
          }
          {
            auto* toggle = u3_find_item(settings_scroll, QStringLiteral("settingsReducedMotionToggle"));
            auto* design_system = view.rootObject()->findChild<QObject*>(QStringLiteral("designSystem"));
            auto* busy_indicator = u3_find_item(view.rootObject(), QStringLiteral("topbarBusyIndicator"));
            auto* restore = u3_find_item(settings_scroll, QStringLiteral("settingsRestoreDefaults"));
            auto* font_size = u3_find_item(settings_scroll, QStringLiteral("settingsEditorFontSize"));
            auto* line_toggle = u3_find_item(settings_scroll, QStringLiteral("settingsEditorLineNumbersToggle"));
            const auto require_toggle_thumb = [&](QQuickItem* item) {
              auto* thumb = u3_find_item(item, item->objectName() + QStringLiteral("Thumb"));
              const auto expected_x = item->property("checked").toBool() ? 26.0 : 6.0;
              if (thumb && thumb->isVisible() && thumb->parentItem() == item &&
                  std::abs(item->width() - 48) < 0.01 && std::abs(item->height() - 28) < 0.01 &&
                  item->property("radius").toReal() == 0 &&
                  std::abs(thumb->width() - 16) < 0.01 && std::abs(thumb->height() - 16) < 0.01 &&
                  std::abs(thumb->x() - expected_x) < 0.01 && std::abs(thumb->y() - 6) < 0.01) return true;
              diagnostic = QStringLiteral("Settings toggle thumb did not reflect its checked state: %1")
                  .arg(item->objectName());
              write_smoke_report();
              application.exit(1);
              return false;
            };
            auto* spinner = busy_indicator
                ? u3_find_item(busy_indicator, QStringLiteral("motionSpinner")) : nullptr;
            auto* static_ring = busy_indicator
                ? u3_find_item(busy_indicator, QStringLiteral("motionStaticRing")) : nullptr;
            auto* static_dot = busy_indicator
                ? u3_find_item(busy_indicator, QStringLiteral("motionStaticDot")) : nullptr;
            if (!toggle || !design_system || !busy_indicator || !spinner || !static_ring || !static_dot || !restore ||
                !font_size || !line_toggle || !font_size->property("enabled").toBool() ||
                !line_toggle->property("enabled").toBool() || shell.editorFontSize() != 13 ||
                !shell.editorLineNumbers() || font_size->property("currentIndex").toInt() != 1 ||
                !line_toggle->property("checked").toBool() ||
                !shell.preferenceStorageReady() || !toggle->property("enabled").toBool() ||
                toggle->property("checked").toBool() || shell.reducedMotion() ||
                design_system->property("durQuick").toInt() != 150) {
              diagnostic = QStringLiteral("Reduced-motion initial state failed: toggle=%1 design=%2 busy=%3 spinner=%4 ring=%5 dot=%6 restore=%7 storage=%8 enabled=%9 checked=%10 reduced=%11 duration=%12")
                  .arg(toggle != nullptr).arg(design_system != nullptr).arg(busy_indicator != nullptr)
                  .arg(spinner != nullptr).arg(static_ring != nullptr).arg(static_dot != nullptr)
                  .arg(restore != nullptr).arg(shell.preferenceStorageReady())
                  .arg(toggle && toggle->property("enabled").toBool())
                  .arg(toggle && toggle->property("checked").toBool())
                  .arg(shell.reducedMotion())
                  .arg(design_system ? design_system->property("durQuick").toInt() : -1);
              write_smoke_report();
              application.exit(1);
              return;
            }
            if (!require_toggle_thumb(toggle) || !require_toggle_thumb(line_toggle)) return;
            busy_indicator->setProperty("busy", true);
            QCoreApplication::processEvents();
            if (!spinner->isVisible() || !spinner->property("running").toBool() ||
                static_ring->isVisible() || static_dot->isVisible()) {
              diagnostic = QStringLiteral("Default busy indicator did not use its animated state");
              write_smoke_report();
              application.exit(1);
              return;
            }
            toggle->forceActiveFocus();
            send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier);
            QCoreApplication::processEvents();
            if (!require_toggle_thumb(toggle)) return;
            if (!shell.reducedMotion() || !toggle->property("checked").toBool() ||
                design_system->property("durQuick").toInt() != 0 || spinner->isVisible() ||
                spinner->property("running").toBool() || !static_ring->isVisible() || !static_dot->isVisible()) {
              diagnostic = QStringLiteral("Reduced-motion toggle did not disable transitions and spinner motion");
              write_smoke_report();
              application.exit(1);
              return;
            }
            if (!QMetaObject::invokeMethod(restore, "clicked", Qt::DirectConnection)) {
              diagnostic = QStringLiteral("Reduced-motion defaults action could not be invoked");
              write_smoke_report();
              application.exit(1);
              return;
            }
            QCoreApplication::processEvents();
            if (!require_toggle_thumb(toggle)) return;
            if (shell.reducedMotion() || toggle->property("checked").toBool() ||
                design_system->property("durQuick").toInt() != 150 || !spinner->isVisible() ||
                !spinner->property("running").toBool() || static_ring->isVisible() || static_dot->isVisible()) {
              diagnostic = QStringLiteral("Restoring defaults did not restore animated behavior");
              write_smoke_report();
              application.exit(1);
              return;
            }
            auto* accessible_toggle = QAccessible::queryAccessibleInterface(toggle);
            auto* accessible_actions = accessible_toggle ? accessible_toggle->actionInterface() : nullptr;
            if (!accessible_toggle || accessible_toggle->role() != QAccessible::CheckBox ||
                !accessible_actions ||
                !accessible_actions->actionNames().contains(QAccessibleActionInterface::toggleAction())) {
              diagnostic = QStringLiteral("Reduced-motion checkbox did not expose an accessible toggle action");
              write_smoke_report();
              application.exit(1);
              return;
            }
            accessible_actions->doAction(QAccessibleActionInterface::toggleAction());
            QCoreApplication::processEvents();
            if (!require_toggle_thumb(toggle)) return;
            if (!shell.reducedMotion() || !toggle->property("checked").toBool() ||
                design_system->property("durQuick").toInt() != 0 || spinner->isVisible() ||
                spinner->property("running").toBool() || !static_ring->isVisible() || !static_dot->isVisible()) {
              diagnostic = QStringLiteral("Accessible reduced-motion action did not apply its checked state");
              write_smoke_report();
              application.exit(1);
              return;
            }
            QMetaObject::invokeMethod(restore, "clicked", Qt::DirectConnection);
            QCoreApplication::processEvents();
            if (!require_toggle_thumb(toggle)) return;
            if (shell.reducedMotion() || toggle->property("checked").toBool() ||
                design_system->property("durQuick").toInt() != 150) {
              diagnostic = QStringLiteral("Reduced-motion checkbox did not restore after its accessible action");
              write_smoke_report();
              application.exit(1);
              return;
            }
            const auto preference_draft = shell.draftCode();
            const auto preference_revision = shell.draftRevision();
            auto* accessible_lines = QAccessible::queryAccessibleInterface(line_toggle);
            auto* line_actions = accessible_lines ? accessible_lines->actionInterface() : nullptr;
            if (!accessible_lines || accessible_lines->role() != QAccessible::CheckBox || !line_actions ||
                !line_actions->actionNames().contains(QAccessibleActionInterface::toggleAction()) ||
                !QMetaObject::invokeMethod(font_size, "activated", Qt::DirectConnection, Q_ARG(int, 4))) {
              diagnostic = QStringLiteral("Editor preferences did not expose their activation actions");
              write_smoke_report();
              application.exit(1);
              return;
            }
            line_actions->doAction(QAccessibleActionInterface::toggleAction());
            QCoreApplication::processEvents();
            if (!require_toggle_thumb(line_toggle)) return;
            if (shell.editorFontSize() != 16 || shell.editorLineNumbers() ||
                font_size->property("currentIndex").toInt() != 4 || line_toggle->property("checked").toBool() ||
                shell.draftCode() != preference_draft || shell.draftRevision() != preference_revision) {
              diagnostic = QStringLiteral("Editor preferences did not apply or changed the current draft");
              write_smoke_report();
              application.exit(1);
              return;
            }
            if (!QMetaObject::invokeMethod(restore, "clicked", Qt::DirectConnection)) {
              diagnostic = QStringLiteral("Editor preferences defaults action could not be invoked");
              write_smoke_report();
              application.exit(1);
              return;
            }
            QCoreApplication::processEvents();
            if (!require_toggle_thumb(line_toggle)) return;
            if (shell.editorFontSize() != 13 || !shell.editorLineNumbers() ||
                font_size->property("currentIndex").toInt() != 1 || !line_toggle->property("checked").toBool() ||
                shell.draftCode() != preference_draft || shell.draftRevision() != preference_revision) {
              diagnostic = QStringLiteral("Restoring editor preferences changed the draft or missed defaults");
              write_smoke_report();
              application.exit(1);
              return;
            }
            const auto preference_path = QDir(nativeData).filePath(QStringLiteral("preferences.ini"));
            if (!QFile::remove(preference_path) || !QDir().mkpath(preference_path)) {
              diagnostic = QStringLiteral("Could not create isolated preference write-failure fixture");
              write_smoke_report();
              application.exit(1);
              return;
            }
            toggle->forceActiveFocus();
            send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier);
            font_size->setProperty("currentIndex", 4);
            if (!QMetaObject::invokeMethod(font_size, "activated", Qt::DirectConnection, Q_ARG(int, 4))) {
              diagnostic = QStringLiteral("Editor font size failure action could not be invoked");
              write_smoke_report();
              application.exit(1);
              return;
            }
            line_actions->doAction(QAccessibleActionInterface::toggleAction());
            QCoreApplication::processEvents();
            const bool write_failure_preserved_state = !shell.reducedMotion() &&
                !toggle->property("checked").toBool() && design_system->property("durQuick").toInt() == 150 &&
                shell.editorFontSize() == 13 && shell.editorLineNumbers() &&
                font_size->property("currentIndex").toInt() == 1 && line_toggle->property("checked").toBool() &&
                shell.draftCode() == preference_draft && shell.draftRevision() == preference_revision;
            if (!QDir(preference_path).removeRecursively() || !write_failure_preserved_state) {
              diagnostic = QStringLiteral("Failed preference write changed the visible or applied state");
              write_smoke_report();
              application.exit(1);
              return;
            }
            busy_indicator->setProperty("busy", false);
          }
          if (!capture_topbar(QStringLiteral("topbar-settings"))) { application.exit(1); return; }
          smoke_expected_size = QSize(1100, 720);
          view.setMinimumSize(QSize(1100, 720));
          view.setMaximumSize(QSize(1100, 720));
          view.setWindowState(Qt::WindowNoState);
          view.resize(1100, 720);
          break;
        case 18:
          {
            const QPointF dialog_origin(settings->property("x").toReal(), settings->property("y").toReal());
            const auto dialog_width = settings->property("width").toReal();
            const auto dialog_height = settings->property("height").toReal();
            const auto content_width = settings_scroll->property("contentWidth").toReal();
            const auto content_height = settings_scroll->property("contentHeight").toReal();
            const bool layout_valid = view.size() == QSize(1100, 720) &&
                settings_scroll->height() > 0 && settings_scroll->width() > 0 && content_width > 0 &&
                content_width <= settings_scroll->width() + 1 && content_height > 0 &&
                dialog_origin.x() >= 0 && dialog_origin.y() >= 0 &&
                dialog_width > 0 && dialog_height > 0 &&
                dialog_origin.x() + dialog_width <= view.rootObject()->width() + 1 &&
                dialog_origin.y() + dialog_height <= view.rootObject()->height() + 1;
            if (!layout_valid) {
              diagnostic = QStringLiteral("Settings layout is invalid at 1100x720: window=%1x%2 viewport=%3x%4 content=%5x%6 dialog=%7,%8 %9x%10")
                  .arg(view.width()).arg(view.height())
                  .arg(settings_scroll->width()).arg(settings_scroll->height())
                  .arg(content_width).arg(content_height)
                  .arg(dialog_origin.x()).arg(dialog_origin.y())
                  .arg(dialog_width).arg(dialog_height);
              write_smoke_report();
              application.exit(1);
              return;
            }
          }
          if (!inspect_settings_text(QStringLiteral("1100x720"))) {
            write_smoke_report();
            application.exit(1);
            return;
          }
          if (!capture_topbar(QStringLiteral("topbar-settings-small"))) { application.exit(1); return; }
          if (smoke_preference_storage_unavailable) {
            auto* flick = qobject_cast<QQuickItem*>(settings_scroll->property("contentItem").value<QObject*>());
            const auto content_height = flick ? flick->property("contentHeight").toReal() : 0;
            for (int index = 0; index < 8; ++index) {
              auto* row = u3_find_item(settings_scroll,
                  QStringLiteral("settingsPreferenceRow%1").arg(index));
              if (!flick || !row || content_height <= flick->height()) {
                diagnostic = QStringLiteral("Unavailable preference settings content is incomplete");
                write_smoke_report();
                application.exit(1);
                return;
              }
              flick->setProperty("contentY", 0);
              QCoreApplication::processEvents();
              const auto initial = row->mapToItem(flick, QPointF());
              flick->setProperty("contentY", std::clamp(
                  initial.y() + row->height() / 2 - flick->height() / 2,
                  0.0, content_height - flick->height()));
              QCoreApplication::processEvents();
              const auto supported = index == 3 || index == 4 || index == 7;
              const auto control_name = index == 3 ? QStringLiteral("settingsReducedMotionToggle") :
                  index == 4 ? QStringLiteral("settingsEditorFontSize") :
                  index == 7 ? QStringLiteral("settingsEditorLineNumbersToggle") :
                  QStringLiteral("settingsPreference%1%2").arg(index == 5 ? "Select" : "Toggle").arg(index);
              auto* control = u3_find_item(row, control_name);
              auto* title = u3_find_item(row, QStringLiteral("settingsPreferenceTitle%1").arg(index));
              auto* description = u3_find_item(row,
                  QStringLiteral("settingsPreferenceDescription%1").arg(index));
              const auto text_fits_row = [&](QQuickItem* item) {
                if (!item || !item->isVisible() || item->property("truncated").toBool() ||
                    item->width() <= 0 || item->height() <= 0) return false;
                const auto origin = item->mapToItem(row, QPointF());
                const auto implicit_height = item->property("implicitHeight");
                const auto content_height_value = item->property("contentHeight");
                const auto painted_width = item->property("paintedWidth");
                const auto painted_height = item->property("paintedHeight");
                bool implicit_valid = false, content_valid = false, painted_width_valid = false,
                    painted_height_valid = false;
                const auto implicit = implicit_height.toDouble(&implicit_valid);
                const auto content = content_height_value.toDouble(&content_valid);
                const auto painted_w = painted_width.toDouble(&painted_width_valid);
                const auto painted_h = painted_height.toDouble(&painted_height_valid);
                return origin.x() >= -1 && origin.y() >= -1 &&
                    origin.x() + item->width() <= row->width() + 1 &&
                    origin.y() + item->height() <= row->height() + 1 &&
                    implicit_valid && content_valid && painted_width_valid && painted_height_valid &&
                    implicit <= item->height() + 1 && content <= item->height() + 1 &&
                    painted_w <= item->width() + 1 && painted_h <= item->height() + 1;
              };
              const auto status_suffix = QStringLiteral("（本机配置不可用）");
              const bool row_valid = row->isVisible() && control && !control->property("enabled").toBool() &&
                  title && description && text_fits_row(title) && text_fits_row(description) &&
                  (!supported || description->property("text").toString().endsWith(status_suffix));
              if (!row_valid) {
                diagnostic = QStringLiteral("Unavailable preference text or control is invalid at row %1: title=%2x%3 description=%4x%5 row=%6x%7")
                    .arg(index).arg(title ? title->width() : -1).arg(title ? title->height() : -1)
                    .arg(description ? description->width() : -1).arg(description ? description->height() : -1)
                    .arg(row->width()).arg(row->height());
                write_smoke_report();
                application.exit(1);
                return;
              }
            }
            diagnostic = QStringLiteral("passed");
            write_smoke_report();
            application.exit(0);
            return;
          }
          {
            auto* flick = qobject_cast<QQuickItem*>(settings_scroll->property("contentItem").value<QObject*>());
            auto* export_data = u3_find_item(settings_scroll, QStringLiteral("settingsDataExportAction"));
            auto* clear_data = u3_find_item(settings_scroll, QStringLiteral("settingsDataClearAction"));
            const auto content_height = flick ? flick->property("contentHeight").toReal() : 0;
            if (!flick || !export_data || !clear_data || content_height <= flick->height() ||
                export_data->property("enabled").toBool() || clear_data->property("enabled").toBool()) {
              diagnostic = QStringLiteral("Settings bottom controls or scrollable content are missing");
              write_smoke_report();
              application.exit(1);
              return;
            }
            const auto fully_visible = [&](QQuickItem* item) {
              const auto origin = item->mapToItem(flick, QPointF());
              return item->isVisible() && item->width() > 0 && item->height() > 0 &&
                  origin.x() >= -1 && origin.y() >= -1 &&
                  origin.x() + item->width() <= flick->width() + 1 &&
                  origin.y() + item->height() <= flick->height() + 1;
            };
            for (int index = 0; index < 8; ++index) {
              auto* row = u3_find_item(settings_scroll,
                  QStringLiteral("settingsPreferenceRow%1").arg(index));
              if (!row) {
                diagnostic = QStringLiteral("Settings preference row %1 is missing").arg(index);
                write_smoke_report();
                application.exit(1);
                return;
              }
              flick->setProperty("contentY", 0);
              QCoreApplication::processEvents();
              const auto initial = row->mapToItem(flick, QPointF());
              const auto target_y = initial.y() + row->height() / 2 - flick->height() / 2;
              flick->setProperty("contentY", std::clamp(target_y, 0.0, content_height - flick->height()));
              QCoreApplication::processEvents();
              if (!fully_visible(row)) {
                diagnostic = QStringLiteral("Settings preference row %1 is clipped at 1100x720").arg(index);
                write_smoke_report();
                application.exit(1);
                return;
              }
              const auto control_name = index == 3 ? QStringLiteral("settingsReducedMotionToggle") :
                  index == 4 ? QStringLiteral("settingsEditorFontSize") :
                  index == 7 ? QStringLiteral("settingsEditorLineNumbersToggle") :
                  QStringLiteral("settingsPreference%1%2").arg(index == 5 ? "Select" : "Toggle").arg(index);
              auto* control = u3_find_item(row, control_name);
              const auto origin = control ? control->mapToItem(row, QPointF()) : QPointF();
              const auto control_right_inset = control
                  ? row->width() - origin.x() - control->width() : -1.0;
              const auto expected_right_inset = index == 4 || index == 5 ? 0.0 : 3.0;
              if (!control || !fully_visible(control) || origin.x() < 0 || origin.y() < 0 ||
                  origin.x() + control->width() > row->width() + 1 ||
                  origin.y() + control->height() > row->height() + 1 ||
                  std::abs(control_right_inset - expected_right_inset) > 0.01 ||
                  (index == 4 && std::abs(row->width() - 493) > 0.01)) {
                diagnostic = QStringLiteral("Settings preference row %1 control alignment mismatch: width=%2 controlRightInset=%3 expected=%4")
                    .arg(index).arg(row->width()).arg(control_right_inset).arg(expected_right_inset);
                write_smoke_report();
                application.exit(1);
                return;
              }
              const bool supported = index == 3 || index == 4 || index == 7;
              if (control->property("enabled").toBool() != supported) {
                diagnostic = QStringLiteral("Settings preference row %1 has incorrect availability").arg(index);
                write_smoke_report();
                application.exit(1);
                return;
              }
              auto* title_text = u3_find_item(row,
                  QStringLiteral("settingsPreferenceTitle%1").arg(index));
              auto* description_text = u3_find_item(row,
                  QStringLiteral("settingsPreferenceDescription%1").arg(index));
              const auto text_metrics = [&](QQuickItem* item) {
                if (!item) return QJsonObject{{"found", false}};
                const auto metric = [item](const char* name) {
                  bool valid = false;
                  const auto value = item->property(name).toDouble(&valid);
                  return QJsonObject{{"valid", valid}, {"value", value}};
                };
                const auto origin = item->mapToItem(row, QPointF());
                return QJsonObject{{"found", true}, {"visible", item->isVisible()},
                    {"x", origin.x()}, {"y", origin.y()}, {"width", item->width()},
                    {"height", item->height()}, {"implicitHeight", metric("implicitHeight")},
                    {"contentHeight", metric("contentHeight")},
                    {"paintedWidth", metric("paintedWidth")},
                    {"paintedHeight", metric("paintedHeight")},
                    {"truncated", item->property("truncated").toBool()}};
              };
              const auto title_metrics = text_metrics(title_text);
              const auto description_metrics = text_metrics(description_text);
              const auto text_fits_row = [&](QQuickItem* item, const QJsonObject& metrics) {
                if (!item || !metrics.value("visible").toBool() ||
                    metrics.value("truncated").toBool() || item->width() <= 0 || item->height() <= 0)
                  return false;
                const auto metric_fits = [&](const QString& property, double limit) {
                  const auto value = metrics.value(property).toObject();
                  const auto number = value.value("value").toDouble();
                  return value.value("valid").toBool() && std::isfinite(number) && number <= limit + 1;
                };
                const auto x = metrics.value("x").toDouble();
                const auto y = metrics.value("y").toDouble();
                return x >= -1 && y >= -1 && x + item->width() <= row->width() + 1 &&
                    y + item->height() <= row->height() + 1 &&
                    metric_fits(QStringLiteral("implicitHeight"), item->height()) &&
                    metric_fits(QStringLiteral("contentHeight"), item->height()) &&
                    metric_fits(QStringLiteral("paintedWidth"), item->width()) &&
                    metric_fits(QStringLiteral("paintedHeight"), item->height());
              };
              const auto title_fits = text_fits_row(title_text, title_metrics);
              const auto description_fits = text_fits_row(description_text, description_metrics);
              if (!title_fits || !description_fits) {
                diagnostic = QStringLiteral("Settings preference text is clipped at 1100x720: row=%1 title=%2 description=%3 rowSize=%4x%5")
                    .arg(index)
                    .arg(QString::fromUtf8(QJsonDocument(title_metrics).toJson(QJsonDocument::Compact)))
                    .arg(QString::fromUtf8(QJsonDocument(description_metrics).toJson(QJsonDocument::Compact)))
                    .arg(row->width()).arg(row->height());
                write_smoke_report();
                application.exit(1);
                return;
              }
              auto* select_text = u3_find_item(row, control_name + QStringLiteral("Text"));
              if ((index == 4 || index == 5) &&
                  (std::abs(control->width() - (index == 4 ? 81 : 72)) > 0.01 ||
                   std::abs(control->height() - 44) > 0.01 ||
                   !select_text || select_text->property("truncated").toBool() ||
                   select_text->property("font").value<QFont>().pixelSize() != 14 ||
                   !u3_find_item(row, control_name + QStringLiteral("Indicator")) ||
                   !u3_find_item(row, control_name + QStringLiteral("Background")))) {
                diagnostic = QStringLiteral("Settings preference select %1 mismatch: size=%2x%3 text=%4 truncated=%5 font=%6 textWidth=%7 paintedWidth=%8 display=%9 leftPadding=%10 rightPadding=%11")
                    .arg(index).arg(control->width()).arg(control->height()).arg(select_text != nullptr)
                    .arg(select_text && select_text->property("truncated").toBool())
                    .arg(select_text ? select_text->property("font").value<QFont>().pixelSize() : -1)
                    .arg(select_text ? select_text->width() : -1)
                    .arg(select_text ? select_text->property("paintedWidth").toReal() : -1)
                    .arg(select_text ? select_text->property("text").toString() : QString())
                    .arg(select_text ? select_text->property("leftPadding").toReal() : -1)
                    .arg(select_text ? select_text->property("rightPadding").toReal() : -1);
                write_smoke_report();
                application.exit(1);
                return;
              }
              smoke_settings_rows.append(QJsonObject{{"index", index}, {"height", row->height()},
                  {"rowWidth", row->width()}, {"controlRightInset", control_right_inset},
                  {"control", control_name}, {"fullyVisible", true},
                  {"controlEnabled", control->property("enabled").toBool()},
                  {"controlX", control->mapToItem(row, QPointF()).x()},
                  {"controlWidth", control->width()}, {"controlHeight", control->height()},
                  {"textTruncated", select_text && select_text->property("truncated").toBool()},
                  {"titleTextTruncated", title_text && title_text->property("truncated").toBool()},
                  {"descriptionTextTruncated", description_text && description_text->property("truncated").toBool()},
                  {"titleTextMetrics", title_metrics}, {"descriptionTextMetrics", description_metrics},
                  {"titleText", title_text ? title_text->property("text").toString() : QString()},
                  {"descriptionText", description_text ? description_text->property("text").toString() : QString()}});
            }
            auto* middle_row = u3_find_item(settings_scroll, QStringLiteral("settingsPreferenceRow4"));
            const auto middle_origin = middle_row->mapToItem(flick, QPointF());
            const auto middle_content_y = flick->property("contentY").toReal();
            flick->setProperty("contentY", std::clamp(
                middle_content_y + middle_origin.y() + middle_row->height() / 2 - flick->height() / 2,
                0.0, content_height - flick->height()));
            QCoreApplication::processEvents();
            if (!fully_visible(middle_row) ||
                !capture_topbar(QStringLiteral("topbar-settings-middle-small"))) {
              if (diagnostic == QStringLiteral("running"))
                diagnostic = QStringLiteral("Settings middle rows could not be captured");
              write_smoke_report();
              application.exit(1);
              return;
            }
            flick->setProperty("contentY", content_height - flick->height());
            QCoreApplication::processEvents();
            if (flick->property("contentY").toReal() <= 0 || !fully_visible(export_data) ||
                !fully_visible(clear_data)) {
              diagnostic = QStringLiteral("Settings data controls are clipped after scrolling to the bottom");
              write_smoke_report();
              application.exit(1);
              return;
            }
            if (!capture_topbar(QStringLiteral("topbar-settings-bottom-small"))) { application.exit(1); return; }
            flick->setProperty("contentY", 0);
          }
          {
            const QPointF point(12, 12);
            QMouseEvent press(QEvent::MouseButtonPress, point, point, point, Qt::LeftButton,
                Qt::LeftButton, Qt::NoModifier);
            QMouseEvent release(QEvent::MouseButtonRelease, point, point, point, Qt::LeftButton,
                Qt::NoButton, Qt::NoModifier);
            QCoreApplication::sendEvent(&view, &press);
            QCoreApplication::sendEvent(&view, &release);
          }
          break;
        case 19:
          if (settings->property("opened").toBool() || !require_focus(settings_button)) {
            if (diagnostic == QStringLiteral("running")) {
              diagnostic = QStringLiteral("Settings did not close on outside click or return focus");
              write_smoke_report();
              application.exit(1);
            }
            return;
          }
          shell.selectPage(QStringLiteral("分析"));
          {
            auto* breadcrumb = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbs"));
            auto* accessible_breadcrumb = breadcrumb
                ? QAccessible::queryAccessibleInterface(breadcrumb) : nullptr;
            if (!breadcrumb || breadcrumb->property("text").toString() !=
                    QStringLiteral("Code Canvas / 分析 / 05 学习分析") ||
                !accessible_breadcrumb || accessible_breadcrumb->text(QAccessible::Name) !=
                    QStringLiteral("当前位置：Code Canvas / 分析 / 05 学习分析") ||
                view.rootObject()->property("breadcrumbEntry").toMap().value("index").toString() != QStringLiteral("05") ||
                view.rootObject()->property("breadcrumbEntry").toMap().value("label").toString() != QStringLiteral("学习分析")) {
              diagnostic = QStringLiteral("Analytics breadcrumb did not preserve its navigation index and label");
              write_smoke_report();
              application.exit(1);
              return;
            }
          }
          shell.selectPage(QStringLiteral("学习"));
          {
            auto* compact_brand = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("compactSidebarBrand"));
            auto* breadcrumb = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbs"));
            auto* breadcrumb_root = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbRoot"));
            auto* breadcrumb_section = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbSection"));
            auto* breadcrumb_index = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbIndex"));
            auto* breadcrumb_entry = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbEntryLabel"));
            auto* accessible_breadcrumb = breadcrumb
                ? QAccessible::queryAccessibleInterface(breadcrumb) : nullptr;
            if (view.size() != QSize(1100, 720) || !compact_brand || !compact_brand->isVisible() ||
                compact_brand->width() != 240 || compact_brand->height() != 64 ||
                !breadcrumb || breadcrumb->property("text").toString() !=
                    QStringLiteral("Code Canvas / 课程 / 01 学习路径") ||
                !accessible_breadcrumb || accessible_breadcrumb->text(QAccessible::Name) !=
                    QStringLiteral("当前位置：Code Canvas / 课程 / 01 学习路径") ||
                !breadcrumb_root || breadcrumb_root->property("text").toString() != QStringLiteral("Code Canvas") ||
                !breadcrumb_section || breadcrumb_section->property("text").toString() != QStringLiteral("课程") ||
                !breadcrumb_index || !breadcrumb_index->isVisible() ||
                breadcrumb_index->property("text").toString() != QStringLiteral("01") ||
                !breadcrumb_entry || breadcrumb_entry->property("text").toString() != QStringLiteral("学习路径")) {
              diagnostic = QStringLiteral("Compact topbar brand or breadcrumb hierarchy is incomplete");
              write_smoke_report();
              application.exit(1);
              return;
            }
          }
          if (!capture_topbar(QStringLiteral("topbar-shell-small"))) { application.exit(1); return; }
          smoke_expected_size = QSize(1440, 900);
          view.setMinimumSize(QSize(1440, 900));
          view.setMaximumSize(QSize(1440, 900));
          view.setWindowState(Qt::WindowNoState);
          view.resize(1440, 900);
          QMetaObject::invokeMethod(quick, "open");
          break;
        case 20:
          if (!require_focus(first)) return;
          QMetaObject::invokeMethod(help, "clicked");
          break;
        case 21:
          if (!help_dialog->property("opened").toBool()) {
            diagnostic = QStringLiteral("Help did not open");
            write_smoke_report();
            application.exit(1);
            return;
          }
          if (!require_reference_close_style(help_dialog)) return;
          if (!capture_topbar(QStringLiteral("topbar-help"))) { application.exit(1); return; }
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          break;
        case 22:
          if (!require_focus(trigger)) return;
          search_field->forceActiveFocus();
          search_field->setProperty("text", QStringLiteral("no-match-qt-smoke"));
          break;
        case 23:
          if (!search->property("opened").toBool() || search->property("height").toReal() < 92 ||
              search_results->property("count").toInt() != 0) {
            diagnostic = QStringLiteral("Search empty state is missing or clipped");
            write_smoke_report();
            application.exit(1);
            return;
          }
          {
            auto* ring = u3_find_item(view.rootObject(), QStringLiteral("globalSearchFocusRing"));
            if (!ring || !ring->isVisible() || !search_field->hasActiveFocus() ||
                QQmlProperty::read(ring, QStringLiteral("border.width")).toReal() != 2 ||
                std::abs(ring->x() + 4) > 0.01 || std::abs(ring->y() + 4) > 0.01) {
              diagnostic = QStringLiteral("Focused search is missing its visible outer ring");
              write_smoke_report();
              application.exit(1);
              return;
            }
          }
          if (!capture_topbar(QStringLiteral("topbar-search"))) { application.exit(1); return; }
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          break;
        case 24:
          if (!require_focus(search_field)) return;
          if (search->property("opened").toBool()) {
            diagnostic = QStringLiteral("Search did not close on Escape");
            write_smoke_report();
            application.exit(1);
            return;
          }
          if (shell.draftDirty()) {
            diagnostic = QStringLiteral("Editor preference smoke refused to replace an unsaved draft");
            write_smoke_report();
            application.exit(1);
            return;
          }
          shell.selectPage(QStringLiteral("编辑器"));
          if (!shell.publishedIds().isEmpty()) {
            const auto reference_index = shell.publishedIds().indexOf(QStringLiteral("python-loop-sum"));
            shell.openPublishedContent(reference_index >= 0 ? reference_index : 0);
          } else {
            shell.selectPage(QStringLiteral("编辑器"));
          }
          break;
        case 25:
          {
            if (shell.contentBusy()) {
              --qml_smoke_page;
              return;
            }
            auto* editor = u3_find_item(view.rootObject(), QStringLiteral("codeEditor"));
            auto* line_numbers = u3_find_item(view.rootObject(), QStringLiteral("codeLineNumbers"));
            auto* code_scroll = u3_find_item(view.rootObject(), QStringLiteral("codeScroll"));
            auto* font_size = u3_find_item(settings_scroll, QStringLiteral("settingsEditorFontSize"));
            auto* line_toggle = u3_find_item(settings_scroll, QStringLiteral("settingsEditorLineNumbersToggle"));
            if (!editor || !line_numbers || !code_scroll || !font_size || !line_toggle ||
                !line_numbers->parentItem() || !code_scroll->parentItem() ||
                editor->property("font").value<QFont>().pixelSize() != 13 ||
                line_numbers->property("font").value<QFont>().pixelSize() != 13 ||
                !line_numbers->parentItem()->isVisible() ||
                std::abs(line_numbers->parentItem()->width() - 44) > 1 ||
                std::abs(code_scroll->x() - 45) > 1 ||
                (!shell.publishedIds().isEmpty() &&
                    (!shell.hasSelectedContent() || shell.selectedContentBody().isEmpty() ||
                     shell.starterLanguage().isEmpty() || editor->property("text").toString().isEmpty()))) {
              diagnostic = QStringLiteral("Editor preference defaults failed: page=%1 busy=%2 editor=%3 lines=%4 scroll=%5 selected=%6 body=%7 language=%8 editorFont=%9 lineFont=%10 gutterVisible=%11 gutterWidth=%12 scrollX=%13 textEmpty=%14")
                  .arg(shell.currentPage()).arg(shell.contentBusy()).arg(editor != nullptr)
                  .arg(line_numbers != nullptr).arg(code_scroll != nullptr)
                  .arg(shell.hasSelectedContent()).arg(!shell.selectedContentBody().isEmpty())
                  .arg(!shell.starterLanguage().isEmpty())
                  .arg(editor ? editor->property("font").value<QFont>().pixelSize() : -1)
                  .arg(line_numbers ? line_numbers->property("font").value<QFont>().pixelSize() : -1)
                  .arg(line_numbers && line_numbers->parentItem() && line_numbers->parentItem()->isVisible())
                  .arg(line_numbers && line_numbers->parentItem() ? line_numbers->parentItem()->width() : -1)
                  .arg(code_scroll ? code_scroll->x() : -1)
                  .arg(editor && editor->property("text").toString().isEmpty());
              write_smoke_report();
              application.exit(1);
              return;
            }
            smoke_preference_draft = shell.draftCode();
            smoke_preference_revision = shell.draftRevision();
            if (!QMetaObject::invokeMethod(settings, "open", Qt::DirectConnection)) {
              diagnostic = QStringLiteral("Editor preference settings dialog could not be opened");
              write_smoke_report();
              application.exit(1);
              return;
            }
            QCoreApplication::processEvents();
            if (!settings->property("opened").toBool()) {
              diagnostic = QStringLiteral("Editor preference settings dialog did not become visible");
              write_smoke_report();
              application.exit(1);
              return;
            }
            if (!font_size->property("enabled").toBool() || !line_toggle->property("enabled").toBool()) {
              diagnostic = QStringLiteral("Editor preference controls were disabled while storage was ready");
              write_smoke_report();
              application.exit(1);
              return;
            }
            if (!QMetaObject::invokeMethod(font_size, "activated", Qt::DirectConnection, Q_ARG(int, 4))) {
              diagnostic = QStringLiteral("Loaded editor font size action could not be invoked");
              write_smoke_report();
              application.exit(1);
              return;
            }
            auto* line_interface = QAccessible::queryAccessibleInterface(line_toggle);
            auto* line_actions = line_interface ? line_interface->actionInterface() : nullptr;
            if (!line_actions || !line_actions->actionNames().contains(QAccessibleActionInterface::toggleAction())) {
              diagnostic = QStringLiteral("Loaded editor line number toggle action is unavailable");
              write_smoke_report();
              application.exit(1);
              return;
            }
            line_actions->doAction(QAccessibleActionInterface::toggleAction());
            QCoreApplication::processEvents();
          }
          break;
        case 26:
          {
            auto* editor = u3_find_item(view.rootObject(), QStringLiteral("codeEditor"));
            auto* line_numbers = u3_find_item(view.rootObject(), QStringLiteral("codeLineNumbers"));
            auto* code_scroll = u3_find_item(view.rootObject(), QStringLiteral("codeScroll"));
            auto* restore = u3_find_item(settings_scroll, QStringLiteral("settingsRestoreDefaults"));
            if (!editor || !line_numbers || !code_scroll || !restore || !line_numbers->parentItem() ||
                !code_scroll->parentItem() ||
                editor->property("font").value<QFont>().pixelSize() != 16 ||
                line_numbers->property("font").value<QFont>().pixelSize() != 16 ||
                line_numbers->parentItem()->isVisible() || std::abs(code_scroll->x()) > 1 ||
                std::abs(code_scroll->width() - code_scroll->parentItem()->width()) > 1 ||
                shell.draftCode() != smoke_preference_draft || shell.draftRevision() != smoke_preference_revision ||
                editor->property("text").toString() != smoke_preference_draft) {
              diagnostic = QStringLiteral("Editor preferences did not change font and gutter without changing the draft");
              write_smoke_report();
              application.exit(1);
              return;
            }
            if (!QMetaObject::invokeMethod(restore, "clicked", Qt::DirectConnection)) {
              diagnostic = QStringLiteral("Loaded editor defaults action could not be invoked");
              write_smoke_report();
              application.exit(1);
              return;
            }
            QCoreApplication::processEvents();
          }
          break;
        case 27:
          {
            auto* editor = u3_find_item(view.rootObject(), QStringLiteral("codeEditor"));
            auto* line_numbers = u3_find_item(view.rootObject(), QStringLiteral("codeLineNumbers"));
            auto* code_scroll = u3_find_item(view.rootObject(), QStringLiteral("codeScroll"));
            if (!editor || !line_numbers || !code_scroll || !line_numbers->parentItem() ||
                shell.editorFontSize() != 13 ||
                !shell.editorLineNumbers() || editor->property("font").value<QFont>().pixelSize() != 13 ||
                line_numbers->property("font").value<QFont>().pixelSize() != 13 ||
                !line_numbers->parentItem()->isVisible() || std::abs(code_scroll->x() - 45) > 1 ||
                shell.draftCode() != smoke_preference_draft || shell.draftRevision() != smoke_preference_revision ||
                editor->property("text").toString() != smoke_preference_draft) {
              diagnostic = QStringLiteral("Restoring loaded editor defaults changed the draft or missed its layout");
              write_smoke_report();
              application.exit(1);
              return;
            }
          }
          QMetaObject::invokeMethod(settings, "close");
          diagnostic = QStringLiteral("passed");
          write_smoke_report();
          application.exit(0);
          break;
        default:
          diagnostic = QStringLiteral("Unexpected topbar smoke step");
          write_smoke_report();
          application.exit(1);
      }
    });
    qml_smoke_timer.start(200);
  }
  QTimer comparison_timer;
  if (comparison >= 0) {
    QObject::connect(&comparison_timer, &QTimer::timeout, &application, [&, context = matrix_context.get()] {
      if (++context->ticks > 100) { application.exit(3); return; }
      if (shell.contentBusy() || !view.isExposed()) return;
      if (view.windowState() != Qt::WindowNoState || view.size() != QSize(1440, 900)) {
        view.setWindowState(Qt::WindowNoState);
        view.resize(1440, 900);
        return;
      }
      const QStringList pages{QStringLiteral("学习"), QStringLiteral("复习与进度"),
          QStringLiteral("挑战"), QStringLiteral("编辑器")};
      const QStringList names{QStringLiteral("qt-learning"), QStringLiteral("qt-review"),
          QStringLiteral("qt-challenge"), QStringLiteral("qt-workbench")};
      if (context->step >= 12 && context->step < 25) {
        auto* editor = u3_find_item(view.rootObject(), QStringLiteral("editorPageRoot"));
        auto* toggle = u3_find_item(view.rootObject(), QStringLiteral("workspaceCodeModeToggle"));
        auto* guide_button = u3_find_item(view.rootObject(), QStringLiteral("workspaceGuideButton"));
        auto* help_button = u3_find_item(view.rootObject(), QStringLiteral("workspaceHelpButton"));
        auto* guide = view.rootObject()->findChild<QObject*>(QStringLiteral("workspaceCourseGuide"));
        switch (context->step) {
          case 12: {
            auto* code = u3_find_item(view.rootObject(), QStringLiteral("workspaceCodePane"));
            auto* runtime = u3_find_item(view.rootObject(), QStringLiteral("workspaceRuntimePane"));
            auto* reader = u3_find_item(view.rootObject(), QStringLiteral("workspaceLessonReader"));
            const auto lesson = shell.lessonMeta().first().toMap();
            context->workspace_reference = {{"documentId", shell.documentId()}, {"state", "not-run"},
                {"sourceCodeSha256", QString::fromLatin1(QCryptographicHash::hash(
                    shell.draftCode().toUtf8(), QCryptographicHash::Sha256).toHex())}};
            u3_record(*context, QStringLiteral("workspace-code-mode-default-and-full-width"),
                editor && editor->property("codeMode").toBool() &&
                view.rootObject()->property("workspaceCodeMode").toBool() &&
                shell.documentId() == QStringLiteral("python-loop-sum") &&
                shell.draftCode() == lesson.value("code").toString() && shell.executionTrace().isEmpty() &&
                code && runtime && reader && !reader->isVisible() &&
                code->mapToItem(view.rootObject(), QPointF()).x() == 8 &&
                code->width() + runtime->width() > 1300 &&
                code->mapToItem(view.rootObject(), QPointF()).y() ==
                    runtime->mapToItem(view.rootObject(), QPointF()).y());
            if (toggle) { toggle->forceActiveFocus(); send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier); }
            break;
          }
          case 13: {
            auto* reader = u3_find_item(view.rootObject(), QStringLiteral("workspaceLessonReader"));
            u3_record(*context, QStringLiteral("workspace-reading-mode-restores-shell-and-reader"),
                editor && !editor->property("codeMode").toBool() &&
                !view.rootObject()->property("workspaceCodeMode").toBool() && reader && reader->isVisible());
            u3_screenshot(*context, view, QStringLiteral("qt-workbench-reading"));
            if (guide_button) QMetaObject::invokeMethod(guide_button, "clicked", Qt::DirectConnection);
            break;
          }
          case 14: {
            auto* title = guide ? guide->findChild<QQuickItem*>(QStringLiteral("workspaceGuideTitle")) : nullptr;
            u3_record(*context, QStringLiteral("workspace-guide-current-course-and-scrollable-dialog"),
                guide && guide->property("opened").toBool() && title && title->isVisible() &&
                title->property("text").toString() == shell.lessonMeta().first().toMap().value("title").toString());
            u3_screenshot(*context, view, QStringLiteral("qt-workbench-guide"));
            send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
            break;
          }
          case 15:
            u3_record(*context, QStringLiteral("workspace-guide-escape-restores-trigger-focus"),
                guide && !guide->property("opened").toBool() && guide_button && guide_button->hasActiveFocus());
            if (help_button) QMetaObject::invokeMethod(help_button, "clicked", Qt::DirectConnection);
            break;
          case 16:
            u3_record(*context, QStringLiteral("workspace-help-opens-from-page"),
                view.rootObject()->property("helpOpen").toBool());
            u3_screenshot(*context, view, QStringLiteral("qt-workbench-help"));
            send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
            break;
          case 17:
            u3_record(*context, QStringLiteral("workspace-help-escape-restores-trigger-focus"),
                !view.rootObject()->property("helpOpen").toBool() && help_button && help_button->hasActiveFocus());
            if (toggle) { toggle->forceActiveFocus(); send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier); }
            break;
          case 18:
            u3_record(*context, QStringLiteral("workspace-mode-toggle-preserves-code-and-trace"),
                editor && editor->property("codeMode").toBool() &&
                context->workspace_reference.value("sourceCodeSha256").toString() ==
                    QString::fromLatin1(QCryptographicHash::hash(shell.draftCode().toUtf8(),
                        QCryptographicHash::Sha256).toHex()) && shell.executionTrace().isEmpty());
            u3_screenshot(*context, view, QStringLiteral("qt-workbench-code-restored"));
            if (auto* back = u3_find_item(view.rootObject(), QStringLiteral("workspaceBack")))
              QMetaObject::invokeMethod(back, "clicked", Qt::DirectConnection);
            break;
          case 19:
            u3_record(*context, QStringLiteral("workspace-back-restores-learning-shell"),
                shell.currentPage() == QStringLiteral("学习") &&
                !view.rootObject()->property("workspaceCodeMode").toBool());
            shell.openPublishedContent(shell.publishedIds().indexOf(QStringLiteral("python-condition")));
            break;
          case 20:
            shell.loadStarterCode();
            shell.selectPage(QStringLiteral("编辑器"));
            break;
          case 21:
            u3_record(*context, QStringLiteral("workspace-new-course-resets-mode-and-closes-guide"),
                shell.documentId() == QStringLiteral("python-condition") && editor &&
                editor->property("codeMode").toBool() && guide && !guide->property("opened").toBool());
            break;
          case 22:
            if (toggle) { toggle->forceActiveFocus(); send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier); }
            break;
          case 23:
            shell.updateDraftCode(shell.draftCode() + QStringLiteral("\n# mode remains a user choice\n"));
            break;
          case 24:
            u3_record(*context, QStringLiteral("workspace-code-edit-preserves-selected-reading-mode"),
                editor && !editor->property("codeMode").toBool());
            break;
        }
        ++context->step;
        return;
      }
      const int page_index = context->step / 3;
      if (page_index >= pages.size()) {
        u3_record(*context, QStringLiteral("qml-no-warnings"), qml_warnings.isEmpty());
        QJsonObject result;
        result.insert(QStringLiteral("mode"), QStringLiteral("qt-isolated-visual-comparison"));
        result.insert(QStringLiteral("isolatedData"), true);
        result.insert(QStringLiteral("width"), view.width());
        result.insert(QStringLiteral("height"), view.height());
        result.insert(QStringLiteral("devicePixelRatio"), view.devicePixelRatio());
        result.insert(QStringLiteral("qmlWarnings"), QJsonArray::fromStringList(qml_warnings));
        result.insert(QStringLiteral("workspaceReference"), QJsonObject::fromVariantMap(context->workspace_reference));
        result.insert(QStringLiteral("checks"), context->checks);
        result.insert(QStringLiteral("screenshots"), context->screenshots);
        result.insert(QStringLiteral("passed"), u3_all_passed(*context));
        QFile file(context->output);
        if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate) ||
            file.write(QJsonDocument(result).toJson(QJsonDocument::Indented)) < 0 || !file.flush()) {
          application.exit(3);
          return;
        }
        application.exit(u3_all_passed(*context) ? 0 : 3);
        return;
      }
      if (context->step % 3 == 0) {
        if (shell.publishedIds().isEmpty()) return;
        if (page_index == 3) {
          const auto index = shell.publishedIds().indexOf(QStringLiteral("python-loop-sum"));
          if (index < 0) { application.exit(3); return; }
          shell.openPublishedContent(index);
          shell.loadStarterCode();
        }
        shell.selectPage(pages.at(page_index));
      } else if (context->step % 3 == 1 && page_index == 3) {
        shell.loadStarterCode();
      } else if (context->step % 3 == 2) {
        // Allow a complete render tick after changing the Loader's page.
        const bool saved = u3_screenshot(*context, view, names.at(page_index), QSize(1440, 900));
        u3_record(*context, names.at(page_index), saved && shell.currentPage() == pages.at(page_index) &&
            view.width() == 1440 && view.height() == 900);
      }
      ++context->step;
    });
    comparison_timer.start(200);
  }
  // Read-only, real-window smoke. Never creates an account or a data root.
  const auto smoke = arguments.indexOf(QStringLiteral("--smoke-screenshot"));
  std::unique_ptr<WindowProbe> probe;
  if (benchmark >= 0) probe = std::make_unique<WindowProbe>(application, shell, view,
      arguments.at(benchmark + 1), entered);
  QTimer smoke_timer;
  int smoke_step = 0;
  int smoke_ticks = 0;
  if (smoke >= 0) {
    if (smoke + 1 >= arguments.size()) return 2;
    const auto screenshot = arguments.at(smoke + 1);
    // Optional "--page <name>": capture a specific page instead of the default.
    // Visual-comparison affordance only; it calls the same selectPage the UI does.
    const auto page_arg = arguments.indexOf(QStringLiteral("--page"));
    if (page_arg >= 0 && page_arg + 1 < arguments.size())
      shell.selectPage(arguments.at(page_arg + 1));
    QObject::connect(&smoke_timer, &QTimer::timeout, &application, [&, screenshot] {
      if (++smoke_ticks > 100) { application.exit(3); return; }
      if (shell.contentBusy()) return;
      if (smoke_step == 0 && !shell.publishedTitles().isEmpty()) {
        shell.openPublishedContent(0);
        ++smoke_step;
        return;
      }
      if (smoke_step == 1 && !shell.selectedContentBody().isEmpty()) {
        shell.loadStarterCode();
        ++smoke_step;
        return;
      }
      if (smoke_step < 2 || shell.starterLanguage().isEmpty()) return;
      const auto frame = view.grabWindow();
      const bool ok = view.isExposed() && !frame.isNull() &&
          !shell.contentBusy() && !shell.publishedTitles().isEmpty() && frame.save(screenshot);
      application.exit(ok ? 0 : 3);
    });
    smoke_timer.start(100);
  }
  QTimer matrix_timer;
  if (matrix >= 0) {
    QObject::connect(&matrix_timer, &QTimer::timeout, &application, [&, context = matrix_context.get()] {
      if (++context->ticks > 500) {
        u3_record(*context, QStringLiteral("matrix-timeout"), false,
            QStringLiteral("验收步骤超过 50 秒"));
        u3_write_result(*context);
        application.exit(3);
        return;
      }
      switch (context->step) {
        case 0:
          if (shell.contentBusy() || shell.publishedIds().isEmpty()) return;
          shell.selectPage(QStringLiteral("学习"));
          u3_record(*context, QStringLiteral("window-content-loaded"),
              !shell.publishedIds().isEmpty());
          u3_record(*context, QStringLiteral("page-learning"), shell.currentPage() == QStringLiteral("学习"));
          {
            auto* calendar = u3_find_item(view.rootObject(), QStringLiteral("checkinCalendarButton"));
            u3_record(*context, QStringLiteral("checkin-guest-calendar-disabled"), calendar &&
                !calendar->property("enabled").toBool() && !shell.checkinSummary().value("ready").toBool());
          }
          u3_screenshot(*context, view, QStringLiteral("u3-learning"));
          context->step++;
          return;
        case 1: {
          auto* completed = u3_find_item(view.rootObject(), QStringLiteral("lessonStatusFilter-2"));
          const bool guest_disabled = completed && !completed->property("available").toBool();
          if (completed) QMetaObject::invokeMethod(completed, "choose", Qt::DirectConnection);
          u3_record(*context, QStringLiteral("learning-guest-completion-filter-disabled"),
              guest_disabled && view.rootObject()->property("lessonStatusFilter").toInt() == 0);
          const auto index = shell.publishedIds().indexOf(QStringLiteral("python-loop-sum"));
          if (index < 0) {
            u3_record(*context, QStringLiteral("course-selection"), false,
                QStringLiteral("缺少 python-loop-sum 内容"));
            context->step = 99;
            return;
          }
          shell.openPublishedContent(index);
          context->step++;
          return;
        }
        case 2:
          if (shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("course-selection"), shell.hasSelectedContent());
          u3_screenshot(*context, view, QStringLiteral("u3-course"));
          shell.loadStarterCode();
          context->step++;
          return;
        case 3:
          if (shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("starter-code"), shell.starterLanguage() == QStringLiteral("python") &&
              !shell.starterCode().isEmpty());
          shell.selectPage(QStringLiteral("编辑器"));
          u3_screenshot(*context, view, QStringLiteral("u3-editor"));
          {
            const auto original_size = view.size();
            view.resize(QSize(1100, 720));
            QCoreApplication::processEvents();
            auto* mode_toggle = u3_find_item(view.rootObject(), QStringLiteral("workspaceCodeModeToggle"));
            const bool code_mode_initial = mode_toggle && mode_toggle->property("checked").toBool();
            if (code_mode_initial) {
              mode_toggle->forceActiveFocus();
              send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier);
              QCoreApplication::processEvents();
            }
            auto* breadcrumb = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbs"));
            auto* breadcrumb_index = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbIndex"));
            auto* breadcrumb_label = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbEntryLabel"));
            auto* accessible_breadcrumb = breadcrumb
                ? QAccessible::queryAccessibleInterface(breadcrumb) : nullptr;
            const auto selected = view.rootObject()->property("selectedLesson").toMap();
            const auto lesson_index = view.rootObject()->property("safeSelectedLessonIndex").toInt();
            const auto expected_breadcrumb = QStringLiteral("Code Canvas / 课程 / %1 %2")
                .arg(QString::number(lesson_index + 1).rightJustified(2, QLatin1Char('0')),
                    selected.value(QStringLiteral("title")).toString());
            u3_record(*context, QStringLiteral("selected-course-breadcrumb-visible-and-accessible"),
                code_mode_initial && !view.rootObject()->property("workspaceCodeMode").toBool() &&
                shell.documentId() == QStringLiteral("python-loop-sum") &&
                selected.value(QStringLiteral("id")).toString() == shell.documentId() &&
                breadcrumb && breadcrumb->isVisible() && breadcrumb->property("text").toString() == expected_breadcrumb &&
                accessible_breadcrumb && accessible_breadcrumb->text(QAccessible::Name) ==
                    QStringLiteral("当前位置：") + expected_breadcrumb &&
                breadcrumb_index && breadcrumb_index->isVisible() &&
                breadcrumb_index->property("text").toString() ==
                    QString::number(lesson_index + 1).rightJustified(2, QLatin1Char('0')) &&
                breadcrumb_label && breadcrumb_label->isVisible() &&
                breadcrumb_label->property("text").toString() == selected.value(QStringLiteral("title")).toString());
            u3_record(*context, QStringLiteral("selected-course-breadcrumb-narrow-screenshot"),
                u3_screenshot(*context, view, QStringLiteral("u3-workspace-breadcrumb-narrow"), QSize(1100, 720)));
            if (code_mode_initial) {
              mode_toggle->forceActiveFocus();
              send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier);
              QCoreApplication::processEvents();
            }
            view.resize(original_size);
            QCoreApplication::processEvents();
          }
          shell.registerAccount(QStringLiteral("Qt U3 Fixture"), QStringLiteral("qt-u3@example.test"),
              QStringLiteral("Qt-U3-Test-Password-123!"));
          context->step++;
          return;
        case 4:
          if (shell.accountBusy() || shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("account-registration"), shell.hasActiveAccount());
          if (!shell.hasActiveAccount()) { context->step = 99; return; }
          shell.updateDraftCode(QStringLiteral("total = 7\nprint(15)\n"));
          shell.saveDraft();
          context->step++;
          return;
        case 5:
          if (shell.draftSaving()) return;
          u3_record(*context, QStringLiteral("draft-save"), !shell.draftDirty() &&
              shell.draftCode() == QStringLiteral("total = 7\nprint(15)\n") &&
              shell.contentStatus() == QStringLiteral("草稿已保存"),
              shell.contentStatus());
          shell.runCode();
          context->step++;
          return;
        case 6:
          if (shell.executionBusy() || shell.operationBusy()) return;
          u3_record(*context, QStringLiteral("python-execution"), shell.executionOutput().contains(QStringLiteral("15")),
              shell.executionOutput());
          {
            auto* panel = u3_find_item(view.rootObject(), QStringLiteral("executionTracePanel"));
            auto* events = u3_find_item(view.rootObject(), QStringLiteral("executionEventList"));
            auto* previous = u3_find_item(view.rootObject(), QStringLiteral("executionTracePrevious"));
            auto* next = u3_find_item(view.rootObject(), QStringLiteral("executionTraceNext"));
            auto* trace_output = u3_find_item(view.rootObject(), QStringLiteral("executionTraceOutput"));
            const int final_event_index = events ? events->property("count").toInt() - 1 : -1;
            const bool initial = panel && events && events->property("count").toInt() >= 4 &&
                events->property("currentIndex").toInt() == final_event_index && trace_output &&
                trace_output->property("text").toString() == QStringLiteral("15\n");
            u3_record(*context, QStringLiteral("execution-trace-events-and-current-output"), initial);
            const auto trace_events = shell.executionTrace().value(QStringLiteral("events")).toList();
            int source_step_index = -1;
            for (qsizetype index = 0; index < trace_events.size(); ++index) {
              const auto event = trace_events.at(index).toMap();
              if (event.value(QStringLiteral("kind")).toString() == QStringLiteral("source_step") &&
                  event.value(QStringLiteral("sourceLine")).toInt() == 2 &&
                  event.value(QStringLiteral("variables")).toMap().value(QStringLiteral("total")).toString() == "7") {
                source_step_index = static_cast<int>(index);
                break;
              }
            }
            auto* source_line = u3_find_item(view.rootObject(), QStringLiteral("executionTraceSourceLine"));
            auto* variables = u3_find_item(view.rootObject(), QStringLiteral("executionTraceVariables"));
            const bool source_snapshot_selected = initial && source_step_index >= 0 && source_line && variables &&
                events->setProperty("currentIndex", source_step_index) &&
                source_line->property("visible").toBool() &&
                source_line->property("text").toString() == QStringLiteral("源码第 2 行") &&
                variables->property("visible").toBool() &&
                variables->property("text").toString().contains(QStringLiteral("total = 7"));
            u3_record(*context, QStringLiteral("python-source-snapshot-line-and-local-variable"),
                source_snapshot_selected);
            auto* diagram = u3_find_item(view.rootObject(), QStringLiteral("executionStageDiagram"));
            auto* variable_table = u3_find_item(view.rootObject(), QStringLiteral("executionVariableTable"));
            u3_record(*context, QStringLiteral("execution-stage-source-pointer-edges-and-variable-table"),
                source_snapshot_selected && diagram && variable_table &&
                diagram->property("nodeCount").toInt() >= 2 && diagram->property("edgeCount").toInt() >= 1 &&
                diagram->property("currentNodeId").toString() == QStringLiteral("line:2") &&
                variable_table->property("variableCount").toInt() == 1 &&
                variable_table->property("snapshotLabel").toString().contains(QStringLiteral("L2")));
            u3_record(*context, QStringLiteral("execution-stage-current-node-and-pointer-fit-viewport"),
                diagram && diagram->property("currentNodeVisible").toBool());
            if (initial) events->setProperty("currentIndex", final_event_index);
            bool previous_invoked = initial && previous;
            for (int index = 0; previous_invoked && index < final_event_index; ++index) {
              previous_invoked = QMetaObject::invokeMethod(previous, "clicked", Qt::DirectConnection);
            }
            previous_invoked = previous_invoked && events->property("currentIndex").toInt() == 0;
            u3_record(*context, QStringLiteral("execution-trace-previous-shows-before-output"),
                previous_invoked &&
                trace_output->property("text").toString().isEmpty());
            u3_record(*context, QStringLiteral("execution-stage-rewind-clears-future-nodes-and-variables"),
                previous_invoked && diagram && variable_table &&
                diagram->property("nodeCount").toInt() == 1 && diagram->property("edgeCount").toInt() == 0 &&
                diagram->property("currentNodeId").toString() == QStringLiteral("event:1") &&
                variable_table->property("variableCount").toInt() == 0);
            int output_event_index = -1;
            for (qsizetype index = 0; index < trace_events.size(); ++index) {
              if (trace_events.at(index).toMap().value(QStringLiteral("kind")).toString() == "output") {
                output_event_index = static_cast<int>(index);
                break;
              }
            }
            bool next_invoked = previous_invoked && next && output_event_index >= 0;
            for (int index = 0; next_invoked && index < output_event_index; ++index) {
              next_invoked = QMetaObject::invokeMethod(next, "clicked", Qt::DirectConnection);
            }
            next_invoked = next_invoked && events->property("currentIndex").toInt() == output_event_index;
            u3_record(*context, QStringLiteral("execution-trace-next-restores-output"), next_invoked &&
                trace_output->property("text").toString() == QStringLiteral("15\n"));
            if (events) events->forceActiveFocus();
            send_editor_shortcut(view, Qt::Key_Home, Qt::NoModifier);
            const bool home = events && events->property("currentIndex").toInt() == 0;
            send_editor_shortcut(view, Qt::Key_End, Qt::NoModifier);
            u3_record(*context, QStringLiteral("execution-trace-keyboard-home-end"), home &&
                events->property("currentIndex").toInt() == final_event_index);
            u3_screenshot(*context, view, QStringLiteral("u3-execution-trace-completed"));
          }
          {
            auto* copy_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("copyOutputButton"));
            auto* clear_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("clearOutputButton"));
            auto* output_area = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("outputArea"));
            const bool copy_invoked = copy_button && copy_button->property("enabled").toBool() &&
                QMetaObject::invokeMethod(copy_button, "clicked", Qt::DirectConnection);
            const bool copied = copy_invoked && QGuiApplication::clipboard()->text() == shell.executionOutput();
            u3_record(*context, QStringLiteral("console-copy-output"), copied);
            const bool clear_invoked = clear_button && output_area &&
                clear_button->property("enabled").toBool() &&
                QMetaObject::invokeMethod(clear_button, "clicked", Qt::DirectConnection);
            u3_record(*context, QStringLiteral("console-clear-display-preserves-result"),
                clear_invoked && output_area->property("text").toString().isEmpty() &&
                shell.executionOutput() == QStringLiteral("15\n"));
          }
          view.resize(1100, 720);
          context->step = 600;
          return;
        case 600: {
          auto* editor = u3_find_item(view.rootObject(), QStringLiteral("editorPageRoot"));
          if (editor) QMetaObject::invokeMethod(editor, "revealExecutionTrace", Qt::DirectConnection);
          context->step = 602;
          return;
        }
        case 602: {
          auto* panel = u3_find_item(view.rootObject(), QStringLiteral("executionTracePanel"));
          auto* output = u3_find_item(view.rootObject(), QStringLiteral("executionTraceOutput"));
          const auto point = output ? output->mapToScene(QPointF()) : QPointF(-1, -1);
          u3_record(*context, QStringLiteral("execution-trace-narrow-framed"), panel && panel->height() >= 150 &&
              output && point.x() >= 0 && point.y() >= 0 && point.x() + output->width() <= view.width() &&
              point.y() + output->height() <= view.height() &&
              u3_screenshot(*context, view, QStringLiteral("u3-execution-trace-narrow"), QSize(1100, 720)));
          shell.updateDraftCode(QStringLiteral("print(16)\n"));
          context->step = 601;
          return;
        }
        case 601: {
          auto* version = u3_find_item(view.rootObject(), QStringLiteral("executionTraceVersion"));
          u3_record(*context, QStringLiteral("execution-trace-edit-marks-old-revision"), version &&
              version->property("text").toString().contains(QStringLiteral("代码已修改")) &&
              shell.executionTrace().value(QStringLiteral("sourceRevision")).toULongLong() != shell.draftRevision());
          u3_screenshot(*context, view, QStringLiteral("u3-execution-trace-stale"), QSize(1100, 720));
          shell.discardDraftChanges();
          view.resize(1440, 900);
          {
            const auto index = shell.publishedIds().indexOf(QStringLiteral("java-loop-sum"));
            if (index < 0) { u3_record(*context, QStringLiteral("java-execution"), false,
                QStringLiteral("缺少 java-loop-sum 内容")); context->step = 99; return; }
            shell.openPublishedContent(index);
          }
          context->step = 50;
          return;
        }
        case 50:
          if (shell.contentBusy()) return;
          shell.loadStarterCode();
          context->step++;
          return;
        case 51:
          if (shell.contentBusy()) return;
          shell.runCode();
          context->step++;
          return;
        case 52:
          if (shell.executionBusy() || shell.operationBusy()) return;
          u3_record(*context, QStringLiteral("java-execution"), shell.executionOutput().contains(QStringLiteral("15")),
              shell.executionOutput());
          {
            const auto trace_events = shell.executionTrace().value(QStringLiteral("events")).toList();
            int snapshot_index = -1;
            for (qsizetype index = 0; index < trace_events.size(); ++index) {
              const auto event = trace_events.at(index).toMap();
              if (event.value(QStringLiteral("kind")).toString() == QStringLiteral("source_step") &&
                  event.value(QStringLiteral("sourceLine")).toInt() == 7 &&
                  event.value(QStringLiteral("variables")).toMap().value(QStringLiteral("total")).toString() == "15") {
                snapshot_index = static_cast<int>(index);
                break;
              }
            }
            auto* events = u3_find_item(view.rootObject(), QStringLiteral("executionEventList"));
            auto* line = u3_find_item(view.rootObject(), QStringLiteral("executionTraceSourceLine"));
            auto* variables = u3_find_item(view.rootObject(), QStringLiteral("executionTraceVariables"));
            u3_record(*context, QStringLiteral("java-source-snapshot-line-and-local-variable"),
                events && line && variables && snapshot_index >= 0 &&
                events->setProperty("currentIndex", snapshot_index) && line->property("visible").toBool() &&
                line->property("text").toString() == QStringLiteral("源码第 7 行") &&
                variables->property("visible").toBool() &&
                variables->property("text").toString().contains(QStringLiteral("total = 15")));
            u3_record(*context, QStringLiteral("java-source-snapshot-screenshot"),
                u3_screenshot(*context, view, QStringLiteral("u3-java-source-snapshot")));
          }
          {
            const auto index = shell.publishedIds().indexOf(QStringLiteral("javascript-loop-sum"));
            if (index < 0) { u3_record(*context, QStringLiteral("javascript-execution"), false,
                QStringLiteral("缺少 javascript-loop-sum 内容")); context->step = 99; return; }
            shell.openPublishedContent(index);
          }
          context->step = 53;
          return;
        case 53:
          if (shell.contentBusy()) return;
          shell.loadStarterCode();
          context->step++;
          return;
        case 54:
          if (shell.contentBusy()) return;
          shell.runCode();
          context->step++;
          return;
        case 55:
          if (shell.executionBusy() || shell.operationBusy()) return;
          u3_record(*context, QStringLiteral("javascript-execution"), shell.executionOutput().contains(QStringLiteral("15")),
              shell.executionOutput());
          {
            const auto trace_events = shell.executionTrace().value(QStringLiteral("events")).toList();
            int snapshot_index = -1;
            for (qsizetype index = 0; index < trace_events.size(); ++index) {
              const auto event = trace_events.at(index).toMap();
              if (event.value(QStringLiteral("kind")).toString() == QStringLiteral("source_step") &&
                  event.value(QStringLiteral("sourceLine")).toInt() == 5 &&
                  event.value(QStringLiteral("variables")).toMap().value(QStringLiteral("total")).toString() == "15") {
                snapshot_index = static_cast<int>(index);
                break;
              }
            }
            auto* events = u3_find_item(view.rootObject(), QStringLiteral("executionEventList"));
            auto* line = u3_find_item(view.rootObject(), QStringLiteral("executionTraceSourceLine"));
            auto* variables = u3_find_item(view.rootObject(), QStringLiteral("executionTraceVariables"));
            const bool snapshot_visible = events && line && variables && snapshot_index >= 0 &&
                events->setProperty("currentIndex", snapshot_index) && line->property("visible").toBool() &&
                line->property("text").toString() == QStringLiteral("源码第 5 行") &&
                variables->property("visible").toBool() &&
                variables->property("text").toString().contains(QStringLiteral("total = 15")) &&
                !variables->property("text").toString().contains(QStringLiteral("Symbol("));
            u3_record(*context, QStringLiteral("javascript-source-snapshot-line-and-local-variable"), snapshot_visible);
            u3_record(*context, QStringLiteral("javascript-snapshots-exclude-module-wrapper-lines"),
                std::none_of(trace_events.begin(), trace_events.end(), [](const auto& value) {
                  const auto event = value.toMap();
                  return event.value(QStringLiteral("kind")).toString() == QStringLiteral("source_step") &&
                      event.value(QStringLiteral("sourceLine")).toInt() > 5;
                }));
            auto* editor = u3_find_item(view.rootObject(), QStringLiteral("codeEditor"));
            auto* numbers = u3_find_item(view.rootObject(), QStringLiteral("codeLineNumbers"));
            const auto fifth_line = shell.draftCode().lastIndexOf(QStringLiteral("console.log"));
            QRectF rectangle;
            const bool aligned = editor && numbers && fifth_line >= 0 &&
                QMetaObject::invokeMethod(editor, "positionToRectangle", Q_RETURN_ARG(QRectF, rectangle),
                    Q_ARG(int, static_cast<int>(fifth_line))) &&
                std::abs(numbers->y() + 4 * numbers->property("lineAdvance").toReal() -
                    rectangle.y()) < 1.0;
            u3_record(*context, QStringLiteral("editor-gutter-matches-source-line-position"), aligned);
            u3_record(*context, QStringLiteral("javascript-source-snapshot-screenshot"),
                u3_screenshot(*context, view, QStringLiteral("u3-javascript-source-snapshot")));
          }
          shell.openFreeProgram(QStringLiteral("javascript"));
          context->step = 551;
          return;
        case 551:
          if (shell.contentBusy()) return;
          shell.updateDraftCode(QStringLiteral("import path from 'node:path';\nlet total = 7;\n"
              "total += await Promise.resolve(8);\nconsole.log(total, path.sep.length);\n"));
          shell.runCode();
          context->step = 552;
          return;
        case 552:
          if (shell.executionBusy() || shell.operationBusy()) return;
          {
            const auto events = shell.executionTrace().value(QStringLiteral("events")).toList();
            const auto module_step = std::find_if(events.begin(), events.end(), [](const auto& value) {
              const auto event = value.toMap();
              return event.value(QStringLiteral("kind")).toString() == QStringLiteral("source_step") &&
                  event.value(QStringLiteral("sourceLine")).toInt() == 4 &&
                  event.value(QStringLiteral("variables")).toMap().value(QStringLiteral("total")).toString() == "15";
            });
            u3_record(*context, QStringLiteral("javascript-module-source-snapshot"),
                shell.executionOutput() == QStringLiteral("15 1\n") && module_step != events.end());
            auto* event_list = u3_find_item(view.rootObject(), QStringLiteral("executionEventList"));
            auto* line = u3_find_item(view.rootObject(), QStringLiteral("executionTraceSourceLine"));
            auto* variables = u3_find_item(view.rootObject(), QStringLiteral("executionTraceVariables"));
            u3_record(*context, QStringLiteral("javascript-module-source-snapshot-visible"),
                event_list && line && variables && module_step != events.end() &&
                event_list->setProperty("currentIndex", static_cast<int>(module_step - events.begin())) &&
                line->property("visible").toBool() && line->property("text").toString() == QStringLiteral("源码第 4 行") &&
                variables->property("visible").toBool() &&
                variables->property("text").toString().contains(QStringLiteral("total = 15")));
            u3_record(*context, QStringLiteral("javascript-module-source-snapshot-screenshot"),
                u3_screenshot(*context, view, QStringLiteral("u3-javascript-module-source-snapshot")));
          }
          shell.discardDraftChanges();
          {
            const auto index = shell.publishedIds().indexOf(QStringLiteral("b1-array-basics"));
            if (index < 0) { u3_record(*context, QStringLiteral("cpp-execution"), false,
                QStringLiteral("缺少 b1-array-basics 内容")); context->step = 99; return; }
            shell.openPublishedContent(index);
          }
          context->step = 56;
          return;
        case 56:
          if (shell.contentBusy()) return;
          shell.loadStarterCode();
          context->step++;
          return;
        case 57:
          if (shell.contentBusy()) return;
          shell.runCode();
          context->step++;
          return;
        case 58:
          if (shell.executionBusy() || shell.operationBusy()) return;
          u3_record(*context, QStringLiteral("cpp-execution"), shell.executionOutput().contains(QStringLiteral("0: 3")),
              shell.executionOutput());
          shell.openFreeProgram(QStringLiteral("cpp"));
          context->step = 580;
          return;
        case 580:
          if (shell.contentBusy()) return;
          shell.updateDraftCode(QStringLiteral("#include <iostream>\nint main() {\n int total = 7;\n total += 8;\n"
              " std::cout << total << '\\n';\n return 0;\n}\n"));
          shell.setExecutionTimeout(10000);
          shell.runCode();
          context->step = 581;
          return;
        case 581:
          if (shell.executionBusy() || shell.operationBusy()) return;
          {
            const auto events = shell.executionTrace().value(QStringLiteral("events")).toList();
            const auto source_step = std::find_if(events.begin(), events.end(), [](const auto& value) {
              const auto event = value.toMap();
              return event.value(QStringLiteral("kind")).toString() == QStringLiteral("source_step") &&
                  event.value(QStringLiteral("sourceLine")).toInt() == 5 &&
                  event.value(QStringLiteral("variables")).toMap().value(QStringLiteral("total")).toString() == "15";
            });
            auto* list = u3_find_item(view.rootObject(), QStringLiteral("executionEventList"));
            auto* line = u3_find_item(view.rootObject(), QStringLiteral("executionTraceSourceLine"));
            auto* variables = u3_find_item(view.rootObject(), QStringLiteral("executionTraceVariables"));
            u3_record(*context, QStringLiteral("cpp-source-snapshot-line-and-variables"),
                shell.documentId() == "free-cpp" && shell.executionOutput() == "15\n" &&
                source_step != events.end() && list && line && variables &&
                list->setProperty("currentIndex", static_cast<int>(std::distance(events.begin(), source_step))) &&
                line->property("visible").toBool() && line->property("text").toString() == QStringLiteral("源码第 5 行") &&
                variables->property("visible").toBool() &&
                variables->property("text").toString().contains(QStringLiteral("total = 15")));
            u3_record(*context, QStringLiteral("cpp-source-snapshot-screenshot"),
                u3_screenshot(*context, view, QStringLiteral("u3-cpp-source-snapshot")));
          }
          shell.discardDraftChanges();
          shell.openFreeProgram(QStringLiteral("python"));
          context->step = 59;
          return;
        case 59:
          if (shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("execution-trace-free-program-clears-lesson"),
              shell.documentId() == QStringLiteral("free-python") && shell.selectedContentBody().isEmpty() &&
              shell.executionTrace().isEmpty());
          shell.updateDraftCode(QStringLiteral("import time\nfor i in range(100):\n    print(i, flush=True)\n    time.sleep(0.02)\n"));
          shell.setExecutionTimeout(5000);
          shell.runCode();
          context->step++;
          return;
        case 60:
          if (!shell.executionBusy()) {
            u3_record(*context, QStringLiteral("execution-pause"), false,
                QStringLiteral("长任务未进入运行状态；status=%1；content=%2；language=%3；active=%4；dirty=%5；blocked=%6")
                    .arg(shell.operationStatus(), shell.contentStatus(), shell.starterLanguage())
                    .arg(shell.hasActiveAccount()).arg(shell.draftDirty()).arg(shell.draftPersistenceBlocked()));
            context->step = 99;
            return;
          }
          {
            const auto events = shell.executionTrace().value(QStringLiteral("events")).toList();
            const bool source_seen = std::any_of(events.begin(), events.end(), [](const auto& value) {
              return value.toMap().value(QStringLiteral("kind")).toString() == "source_step";
            });
            if (!source_seen || !shell.executionOutput().contains(QStringLiteral("0\n"))) return;
            u3_record(*context, QStringLiteral("execution-live-output-and-source-before-exit"), shell.executionBusy());
          }
          shell.pauseExecution();
          if (!shell.executionPaused()) return;
          u3_record(*context, QStringLiteral("execution-pause"), true);
          context->step++;
          return;
        case 61:
          if (!shell.executionPaused()) {
            u3_record(*context, QStringLiteral("execution-step"), false,
                QStringLiteral("暂停状态丢失"));
            context->step = 99;
            return;
          }
          {
            const auto events = shell.executionTrace().value(QStringLiteral("events")).toList();
            if (std::none_of(events.begin(), events.end(), [](const auto& value) {
                  return value.toMap().value(QStringLiteral("kind")).toString() == "paused";
                })) return;
            u3_record(*context, QStringLiteral("execution-live-paused-screenshot"),
                u3_screenshot(*context, view, QStringLiteral("u3-execution-trace-live")));
            if (auto* list = u3_find_item(view.rootObject(), QStringLiteral("executionEventList"))) {
              list->forceActiveFocus();
              send_editor_shortcut(view, Qt::Key_Home, Qt::NoModifier);
            }
          }
          shell.stepExecution();
          u3_record(*context, QStringLiteral("execution-step"), shell.executionPaused());
          shell.resumeExecution();
          context->step++;
          return;
        case 62:
          if (shell.executionPaused()) return;
          {
            const auto events = shell.executionTrace().value(QStringLiteral("events")).toList();
            if (std::none_of(events.begin(), events.end(), [](const auto& value) {
                  return value.toMap().value(QStringLiteral("kind")).toString() == "resumed";
                })) return;
            auto* list = u3_find_item(view.rootObject(), QStringLiteral("executionEventList"));
            u3_record(*context, QStringLiteral("execution-live-preserves-browsed-event"),
                list && list->property("currentIndex").toInt() == 0);
            if (list) list->forceActiveFocus();
            send_editor_shortcut(view, Qt::Key_End, Qt::NoModifier);
            u3_record(*context, QStringLiteral("execution-live-end-follows-latest"),
                list && list->property("currentIndex").toInt() == events.size() - 1);
          }
          u3_record(*context, QStringLiteral("execution-resume"), shell.executionBusy());
          shell.cancelExecution();
          context->step++;
          return;
        case 63:
          if (shell.executionBusy()) return;
          u3_record(*context, QStringLiteral("execution-cancel"),
              shell.executionOutput().contains(QStringLiteral("取消")), shell.executionOutput());
          {
            const auto events = shell.executionTrace().value(QStringLiteral("events")).toList();
            u3_record(*context, QStringLiteral("execution-trace-cancelled-event"), !events.isEmpty() &&
                events.last().toMap().value(QStringLiteral("kind")).toString() == QStringLiteral("cancelled"));
            bool paused = false;
            bool resumed = false;
            for (const auto& event : events) {
              paused = paused || event.toMap().value(QStringLiteral("kind")).toString() == QStringLiteral("paused");
              resumed = resumed || event.toMap().value(QStringLiteral("kind")).toString() == QStringLiteral("resumed");
            }
            u3_record(*context, QStringLiteral("execution-trace-pause-resume-events"), paused && resumed);
            u3_record(*context, QStringLiteral("execution-stage-cancelled-terminal-visible-without-success"),
                !events.isEmpty() && u3_stage_terminal_visible(view.rootObject(), events.last().toMap(), false));
            u3_screenshot(*context, view, QStringLiteral("u3-execution-trace-cancelled"));
          }
          shell.setExecutionTimeout(100);
          shell.updateDraftCode(QStringLiteral("import time\ntime.sleep(2)\n"));
          shell.runCode();
          context->step++;
          return;
        case 64:
          if (shell.executionBusy()) return;
          u3_record(*context, QStringLiteral("execution-timeout"),
              shell.executionOutput().contains(QStringLiteral("超时")), shell.executionOutput());
          {
            const auto events = shell.executionTrace().value(QStringLiteral("events")).toList();
            u3_record(*context, QStringLiteral("execution-trace-failed-event"), !events.isEmpty() &&
                events.last().toMap().value(QStringLiteral("kind")).toString() == QStringLiteral("failed"));
            auto* error = u3_find_item(view.rootObject(), QStringLiteral("executionTraceError"));
            u3_record(*context, QStringLiteral("execution-stage-failed-terminal-and-error-visible"),
                !events.isEmpty() && u3_stage_terminal_visible(view.rootObject(), events.last().toMap(), true) &&
                error && error->isVisible() && !error->property("text").toString().isEmpty() &&
                error->property("text").toString() == events.last().toMap().value(QStringLiteral("payload")).toString());
            u3_screenshot(*context, view, QStringLiteral("u3-execution-trace-failed"));
          }
          {
            auto* output_area = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("outputArea"));
            auto* design_system = view.rootObject()->findChild<QObject*>(QStringLiteral("designSystem"));
            const auto color = output_area ? output_area->property("color").value<QColor>() : QColor();
            const auto danger = design_system ? design_system->property("danger").value<QColor>() : QColor();
            u3_record(*context, QStringLiteral("console-error-row-style"),
                shell.executionOutputError() && danger.isValid() && color == danger);
          }
          shell.setExecutionTimeout(5000);
          shell.openFreeProgram(QStringLiteral("python"));
          context->step = 65;
          return;
        case 65:
          if (shell.contentBusy()) return;
          shell.updateDraftCode(QStringLiteral("中文🙂 e\u0301\n第二行\t缩进\n") + QString(1024 * 1024, QChar('x')));
          u3_record(*context, QStringLiteral("editor-long-unicode-input"),
              shell.draftCode().startsWith(QStringLiteral("中文🙂 e\u0301\n第二行\t缩进\n")) &&
              shell.draftCode().size() > 1024 * 1024);
          shell.resetDraftCode();
          u3_record(*context, QStringLiteral("editor-undo-reset"), !shell.draftDirty());
          if (auto* editor = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("codeEditor"))) {
            editor->forceActiveFocus();
            view.requestActivate();
            context->step++;
            return;
          }
          u3_record(*context, QStringLiteral("editor-focus"), false,
              QStringLiteral("代码编辑器对象未找到"));
          context->step = 99;
          return;
        case 66: {
          auto* editor = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("codeEditor"));
          if (!editor || !editor->property("activeFocus").toBool()) return;
          const QString marker = QStringLiteral("剪贴板🙂\n");
          QGuiApplication::clipboard()->setText(marker);
          send_editor_shortcut(view, Qt::Key_V, Qt::ControlModifier);
          context->step++;
          return;
        }
        case 67: {
          auto* editor = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("codeEditor"));
          if (!editor) { context->step = 99; return; }
          const auto text = editor->property("text").toString();
          u3_record(*context, QStringLiteral("editor-clipboard-paste"), text.contains(QStringLiteral("剪贴板🙂")));
          send_editor_shortcut(view, Qt::Key_Z, Qt::ControlModifier);
          context->step++;
          return;
        }
        case 68: {
          auto* editor = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("codeEditor"));
          if (!editor) { context->step = 99; return; }
          u3_record(*context, QStringLiteral("editor-undo"),
              !editor->property("text").toString().contains(QStringLiteral("剪贴板🙂")));
          send_editor_shortcut(view, Qt::Key_Y, Qt::ControlModifier);
          context->step++;
          return;
        }
        case 69: {
          auto* editor = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("codeEditor"));
          if (!editor) { context->step = 99; return; }
          u3_record(*context, QStringLiteral("editor-redo"),
              editor->property("text").toString().contains(QStringLiteral("剪贴板🙂")));
          shell.selectPage(QStringLiteral("学习"));
          context->step++;
          return;
        }
        case 70: {
          auto* list = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("courseList"));
          if (!list || !list->isVisible() || list->height() <= 0) return;
          const auto content_height = list->property("contentHeight").toDouble();
          if (content_height <= list->height()) {
            u3_record(*context, QStringLiteral("course-scroll"), false,
                QStringLiteral("课程列表没有可滚动内容"));
            context->step = 99;
            return;
          }
          list->setProperty("contentY", content_height - list->height());
          const bool reached_end = list->property("contentY").toDouble() > 0;
          list->setProperty("contentY", 0);
          u3_record(*context, QStringLiteral("course-scroll"), reached_end);
          shell.selectPage(QStringLiteral("复习与进度"));
          shell.refreshReviewSummary();
          context->step = 7;
          return;
        }
        case 7:
          if (shell.operationBusy()) return;
          u3_record(*context, QStringLiteral("review-progress"), shell.currentPage() == QStringLiteral("复习与进度"));
          u3_screenshot(*context, view, QStringLiteral("u3-review"));
          shell.selectPage(QStringLiteral("挑战"));
          context->step++;
          return;
        case 8:
          u3_record(*context, QStringLiteral("page-challenge"), shell.currentPage() == QStringLiteral("挑战"));
          {
            auto* challenge_page = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengePageRoot"));
            auto* search = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeSearch"));
            auto* previous = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengePreviousPage"));
            auto* next = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeNextPage"));
            const auto challenges = shell.challengeMeta();
            const bool page_loaded = challenge_page && search && previous && next && !challenges.isEmpty();
            if (!page_loaded) {
              u3_record(*context, QStringLiteral("challenge-filter-controls-loaded"), false);
            } else {
              u3_record(*context, QStringLiteral("challenge-filter-controls-loaded"), true);
              const auto sample = challenges.first().toMap();
              challenge_page->setProperty("stageFilter", sample.value(QStringLiteral("stageId")));
              challenge_page->setProperty("trackFilter", sample.value(QStringLiteral("track")));
              challenge_page->setProperty("difficultyFilter", sample.value(QStringLiteral("difficulty")));
              challenge_page->setProperty("runnerFilter", sample.value(QStringLiteral("runner")));
              const auto filtered = challenge_page->property("filteredChallenges").toList();
              QVariantList expected_filtered;
              for (const auto& value : challenges) {
                const auto item = value.toMap();
                if (item.value(QStringLiteral("stageId")) == sample.value(QStringLiteral("stageId")) &&
                    item.value(QStringLiteral("track")) == sample.value(QStringLiteral("track")) &&
                    item.value(QStringLiteral("difficulty")) == sample.value(QStringLiteral("difficulty")) &&
                    item.value(QStringLiteral("runner")) == sample.value(QStringLiteral("runner"))) {
                  expected_filtered.append(value);
                }
              }
              const bool combined_filter = !expected_filtered.isEmpty() && filtered == expected_filtered;
              u3_record(*context, QStringLiteral("challenge-filter-combination"), combined_filter);

              search->setProperty("text", sample.value(QStringLiteral("title")));
              const auto searched = challenge_page->property("filteredChallenges").toList();
              const bool search_match = !searched.isEmpty() && std::all_of(searched.cbegin(), searched.cend(),
                  [&](const QVariant& value) {
                    return value.toMap().value(QStringLiteral("title")) == sample.value(QStringLiteral("title"));
                  });
              u3_record(*context, QStringLiteral("challenge-title-search"), search_match);

              QMetaObject::invokeMethod(challenge_page, "clearFilters", Qt::DirectConnection);
              challenge_page->setProperty("sortFilter", QStringLiteral("标题"));
              const auto sorted = challenge_page->property("filteredChallenges").toList();
              bool title_sorted = !sorted.isEmpty();
              for (qsizetype index = 1; index < sorted.size(); ++index) {
                if (QString::localeAwareCompare(
                        sorted.at(index - 1).toMap().value(QStringLiteral("title")).toString(),
                        sorted.at(index).toMap().value(QStringLiteral("title")).toString()) > 0) {
                  title_sorted = false;
                  break;
                }
              }
              u3_record(*context, QStringLiteral("challenge-title-sort"), title_sorted);

              QMetaObject::invokeMethod(challenge_page, "clearFilters", Qt::DirectConnection);
              const int all_count = static_cast<int>(
                  challenge_page->property("filteredChallenges").toList().size());
              const int page_size = challenge_page->property("pageSize").toInt();
              const int expected_pages = std::max(1, (all_count + page_size - 1) / page_size);
              challenge_page->setProperty("currentPage", expected_pages);
              const auto page_rows = challenge_page->property("pageChallenges").toList();
              const auto first_id = page_rows.isEmpty() ? QString{} :
                  page_rows.first().toMap().value(QStringLiteral("id")).toString();
              const auto original_index = std::find_if(challenges.cbegin(), challenges.cend(), [&](const QVariant& value) {
                return value.toMap().value(QStringLiteral("id")).toString() == first_id;
              });
              const auto expected_sequence = original_index == challenges.cend() ? QString{} :
                  (std::distance(challenges.cbegin(), original_index) + 1 < 10 ? QStringLiteral("0") : QString{}) +
                  QString::number(std::distance(challenges.cbegin(), original_index) + 1);
              QVariant actual_sequence;
              const bool sequence_invoked = !page_rows.isEmpty() && QMetaObject::invokeMethod(challenge_page,
                  "challengeSequence", Qt::DirectConnection, Q_RETURN_ARG(QVariant, actual_sequence),
                  Q_ARG(QVariant, page_rows.first()));
              const bool paging = challenge_page->property("pageCount").toInt() == expected_pages &&
                  challenge_page->property("currentPage").toInt() == expected_pages &&
                  previous->property("enabled").toBool() == (expected_pages > 1) &&
                  !next->property("enabled").toBool() &&
                  (expected_pages == 1 || (sequence_invoked && actual_sequence.toString() == expected_sequence));
              u3_record(*context, QStringLiteral("challenge-pagination-boundaries-and-stable-sequence"), paging);

              search->setProperty("text", QStringLiteral("no-challenge-can-match-20261107"));
              auto* empty = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeEmptyState"));
              const bool empty_state = challenge_page->property("filteredChallenges").toList().isEmpty() &&
                  empty && empty->property("visible").toBool() &&
                  challenge_page->property("currentPage").toInt() == 1 &&
                  !previous->property("enabled").toBool() && !next->property("enabled").toBool();
              u3_record(*context, QStringLiteral("challenge-empty-filter-state"), empty_state);
              QMetaObject::invokeMethod(challenge_page, "clearFilters", Qt::DirectConnection);
              const bool reset = challenge_page->property("searchText").toString().isEmpty() &&
                  challenge_page->property("stageFilter").toString() == QStringLiteral("全部") &&
                  challenge_page->property("trackFilter").toString() == QStringLiteral("全部") &&
                  challenge_page->property("difficultyFilter").toString() == QStringLiteral("全部") &&
                  challenge_page->property("runnerFilter").toString() == QStringLiteral("全部") &&
                  challenge_page->property("sortFilter").toString() == QStringLiteral("A—M 顺序") &&
                  challenge_page->property("currentPage").toInt() == 1 &&
                  challenge_page->property("filteredChallenges").toList() == challenges &&
                  !previous->property("enabled").toBool() && next->property("enabled").toBool() == (expected_pages > 1);
              u3_record(*context, QStringLiteral("challenge-filter-reset"), reset);

              context->step = 205;
              return;
            }
          }
          u3_screenshot(*context, view, QStringLiteral("u3-challenge"));
          shell.discardDraftChanges();
          shell.selectPage(QStringLiteral("账户"));
          context->step = 9;
          return;
        case 205: {
          const auto sample = shell.challengeMeta().first().toMap();
          auto* card = u3_find_item(view.rootObject(),
              QStringLiteral("challengeCard-") + sample.value(QStringLiteral("id")).toString());
          if (!card) return;
          card->forceActiveFocus();
          send_editor_shortcut(view, Qt::Key_Return, Qt::NoModifier);
          u3_record(*context, QStringLiteral("challenge-card-keyboard-opens-detail"),
              shell.challengeDetailOpen() && shell.selectedChallenge() == sample);
          context->step = 209;
          return;
        }
        case 209: {
          const auto sample = shell.challengeMeta().first().toMap();
          auto* detail_title = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeDetailTitle"));
          auto* overview = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeOverviewSection"));
          auto* lab = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeLabSection"));
          auto* starter = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeStarterCode"));
          auto* unavailable = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeRunUnavailable"));
          auto* back = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeDetailBack"));
          const bool detail_loaded = shell.challengeDetailOpen() && detail_title && overview && lab && starter && unavailable &&
              detail_title->property("text").toString() == sample.value(QStringLiteral("title")).toString() &&
              overview->isVisible() && lab->isVisible() && !unavailable->property("enabled").toBool() &&
              starter->property("text").toString() == sample.value(QStringLiteral("starterCode")).toString();
          u3_record(*context, QStringLiteral("challenge-detail-metadata-and-honest-run-state"), detail_loaded);
          u3_record(*context, QStringLiteral("challenge-detail-focuses-back-button"), back && back->hasActiveFocus());
          context->detail_restore_size = view.size();
          view.resize(1440, 900);
          context->step = 206;
          return;
        }
        case 206:
          if (view.size() != QSize(1440, 900)) return;
          context->detail_large = u3_screenshot(*context, view,
              QStringLiteral("u3-challenge-detail"), QSize(1440, 900));
          view.resize(1100, 720);
          context->step = 207;
          return;
        case 207:
          if (view.size() != QSize(1100, 720)) return;
          context->detail_small = u3_screenshot(*context, view,
              QStringLiteral("u3-challenge-detail-small"), QSize(1100, 720));
          view.resize(context->detail_restore_size);
          context->step = 208;
          return;
        case 208:
          if (view.size() != context->detail_restore_size) return;
          u3_record(*context, QStringLiteral("challenge-detail-window-matrix"),
              context->detail_large && context->detail_small && context->detail_restore_size.isValid());
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          context->step = 210;
          return;
        case 210: {
          const auto sample = shell.challengeMeta().first().toMap();
          auto* card = u3_find_item(view.rootObject(),
              QStringLiteral("challengeCard-") + sample.value(QStringLiteral("id")).toString());
          auto* list = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeListRoot"));
          u3_record(*context, QStringLiteral("challenge-detail-escape-restores-list-and-focus"),
              !shell.challengeDetailOpen() && list && list->isVisible() && card && card->hasActiveFocus());
          u3_screenshot(*context, view, QStringLiteral("u3-challenge"));
          shell.openChallenge(QStringLiteral("stage-d"));
          context->step = 211;
          return;
        }
        case 211: {
          auto* starter = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeStarterCode"));
          const bool opened = shell.challengeDetailOpen() &&
              shell.selectedChallenge().value(QStringLiteral("id")).toString() == QStringLiteral("stage-d") &&
              starter && starter->property("text").toString() == shell.challengeCode() &&
              starter->property("readOnly").toBool() == false;
          u3_record(*context, QStringLiteral("challenge-runner-editor-is-challenge-scoped"), opened);
          shell.runChallenge();
          u3_record(*context, QStringLiteral("challenge-run-starts-with-busy-state"), shell.challengeRunBusy());
          context->step = 212;
          return;
        }
        case 212: {
          if (shell.challengeRunBusy()) return;
          const auto result = shell.challengeRunResult();
          auto* verdict = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeJudgementStatus"));
          auto* first_case = u3_find_item(view.rootObject(), QStringLiteral("challengeJudgementCase-0"));
          auto* third_case = u3_find_item(view.rootObject(), QStringLiteral("challengeJudgementCase-2"));
          const bool passed = result.value(QStringLiteral("passed")).toBool() &&
              result.value(QStringLiteral("cases")).toList().size() == 3 && verdict && first_case && third_case &&
              verdict->property("text").toString() == QStringLiteral("验收点全部命中") &&
              first_case->property("text").toString().contains(QStringLiteral("命中")) &&
              third_case->property("text").toString().contains(QStringLiteral("跑一次构建"));
          const QString passed_detail = QStringLiteral("result=%1 cases=%2 verdict=%3 first=%4 third=%5")
              .arg(result.value(QStringLiteral("passed")).toBool())
              .arg(result.value(QStringLiteral("cases")).toList().size())
              .arg(verdict ? verdict->property("text").toString() : QStringLiteral("<missing>"))
              .arg(first_case ? first_case->property("text").toString() : QStringLiteral("<missing>"))
              .arg(third_case ? third_case->property("text").toString() : QStringLiteral("<missing>"));
          u3_record(*context, QStringLiteral("challenge-run-and-per-checkpoint-result-visible"), passed,
              passed ? QString() : passed_detail);
          u3_screenshot(*context, view, QStringLiteral("u3-challenge-judgement-passed"));
          shell.updateChallengeCode(QStringLiteral("console.log('待办数量: 20');"));
          shell.runChallenge();
          context->step = 213;
          return;
        }
        case 213: {
          if (shell.challengeRunBusy()) return;
          const auto result = shell.challengeRunResult();
          auto* verdict = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("challengeJudgementStatus"));
          auto* first_case = u3_find_item(view.rootObject(), QStringLiteral("challengeJudgementCase-0"));
          auto* extra = u3_find_item(view.rootObject(), QStringLiteral("challengeExtraLines"));
          const bool failed = !result.value(QStringLiteral("passed")).toBool() &&
              result.value(QStringLiteral("cases")).toList().size() == 3 && verdict && first_case && extra &&
              first_case->property("text").toString().startsWith(QStringLiteral("未命中 ·")) &&
              first_case->property("text").toString().contains(QStringLiteral("只有包含验收点")) &&
              extra->property("visible").toBool() && extra->property("text").toString().contains(QStringLiteral("待办数量: 20"));
          const QString failed_detail = QStringLiteral("result=%1 cases=%2 verdict=%3 first=%4 extraVisible=%5 extra=%6")
              .arg(result.value(QStringLiteral("passed")).toBool())
              .arg(result.value(QStringLiteral("cases")).toList().size())
              .arg(verdict ? verdict->property("text").toString() : QStringLiteral("<missing>"))
              .arg(first_case ? first_case->property("text").toString() : QStringLiteral("<missing>"))
              .arg(extra ? extra->property("visible").toBool() : false)
              .arg(extra ? extra->property("text").toString() : QStringLiteral("<missing>"));
          u3_record(*context, QStringLiteral("challenge-run-reports-near-miss-and-extra-output"), failed,
              failed ? QString() : failed_detail);
          u3_screenshot(*context, view, QStringLiteral("u3-challenge-judgement-failed"));
          shell.closeChallenge();
          shell.openChallenge(QStringLiteral("stage-d"));
          context->step = 214;
          return;
        }
        case 214: {
          u3_record(*context, QStringLiteral("challenge-code-draft-restored-after-reopen"),
              shell.challengeCode() == QStringLiteral("console.log('待办数量: 20');"));
          shell.updateChallengeCode(shell.selectedChallenge().value(QStringLiteral("starterCode")).toString());
          shell.runChallenge();
          context->step = 215;
          return;
        }
        case 215: {
          if (shell.challengeRunBusy() || shell.challengeHistoryBusy()) return;
          auto* note = u3_find_item(view.rootObject(), QStringLiteral("challengeEvidenceNote"));
          auto* submit = u3_find_item(view.rootObject(), QStringLiteral("challengeSubmit"));
          if (note) note->setProperty("text", QStringLiteral("已运行当前代码，输出命中全部验收点。<b>原文保留</b>"));
          const bool submitted = submit && submit->property("enabled").toBool() &&
              QMetaObject::invokeMethod(submit, "clicked", Qt::DirectConnection) && shell.challengeHistoryBusy();
          u3_record(*context, QStringLiteral("challenge-form-submits-successful-local-snapshot"), submitted);
          context->step = 216;
          return;
        }
        case 216: {
          if (shell.challengeHistoryBusy()) return;
          auto* status = u3_find_item(view.rootObject(), QStringLiteral("challengeSubmissionStatus-0"));
          const auto history = shell.challengeHistory();
          u3_record(*context, QStringLiteral("challenge-local-history-and-progress-visible"),
              history.size() == 1 && history.first().toMap().value("status") == "passed" && status &&
              status->property("text").toString().contains(QStringLiteral("自动判定通过")) &&
              shell.challengeProgress().value("stage-d").toMap().value("status") == "passed",
              shell.challengeHistoryStatus());
          auto* evidence = u3_find_item(view.rootObject(), QStringLiteral("challengeSubmissionEvidence-0"));
          u3_record(*context, QStringLiteral("challenge-evidence-is-rendered-as-plain-text"),
              evidence && evidence->property("textFormat").toInt() == int(Qt::PlainText) &&
              evidence->property("text").toString().contains(QStringLiteral("<b>原文保留</b>")));
          view.resize(1440, 900);
          context->step = 217;
          return;
        }
        case 217:
          if (view.size() != QSize(1440, 900)) return;
          u3_record(*context, QStringLiteral("challenge-history-scroll-reaches-submission"),
              u3_reveal_challenge_item(view.rootObject(), QStringLiteral("challengeSubmissionStatus-0")));
          u3_screenshot(*context, view, QStringLiteral("u3-challenge-submitted"), QSize(1440, 900));
          view.resize(1100, 720);
          context->step = 218;
          return;
        case 218: {
          if (view.size() != QSize(1100, 720)) return;
          auto* scroll = u3_find_item(view.rootObject(), QStringLiteral("challengeLabSection"));
          u3_record(*context, QStringLiteral("challenge-history-small-window-scroll-without-overflow"),
              scroll && scroll->property("contentWidth").toReal() <= scroll->width() + 1 &&
              u3_reveal_challenge_item(view.rootObject(), QStringLiteral("challengeSubmissionStatus-0")));
          u3_screenshot(*context, view, QStringLiteral("u3-challenge-submitted-small"), QSize(1100, 720));
          shell.openChallenge(QStringLiteral("stage-a"));
          context->step = 219;
          return;
        }
        case 219: {
          const std::pair<const char*, QString> fields[]{
              {"challengeExternalEnvironment", QStringLiteral("Windows 11 隔离验收环境")},
              {"challengeExternalCommand", QStringLiteral("codeweave-check --isolated")},
              {"challengeExternalSummary", QStringLiteral("已完成外部实验，保存一次构建报错的完整日志供人工检查。")},
              {"challengeExternalArtifact", QStringLiteral("isolated-build-report.txt")},
              {"challengeExternalDate", QDate::currentDate().toString(Qt::ISODate)}};
          bool filled = true;
          for (const auto& [name, value] : fields) {
            auto* field = u3_find_item(view.rootObject(), QString::fromLatin1(name));
            filled = filled && field && field->setProperty("text", value);
          }
          auto* submit = u3_find_item(view.rootObject(), QStringLiteral("challengeSubmit"));
          u3_record(*context, QStringLiteral("challenge-external-form-submits-pending-evidence"),
              filled && submit && submit->property("enabled").toBool() &&
              QMetaObject::invokeMethod(submit, "clicked", Qt::DirectConnection) && shell.challengeHistoryBusy());
          context->step = 220;
          return;
        }
        case 220: {
          if (shell.challengeHistoryBusy()) return;
          auto* status = u3_find_item(view.rootObject(), QStringLiteral("challengeSubmissionStatus-0"));
          u3_record(*context, QStringLiteral("challenge-external-pending-does-not-auto-pass"),
              shell.challengeHistory().size() == 1 && status &&
              status->property("text").toString().contains(QStringLiteral("待人工确认")) &&
              shell.challengeProgress().value("stage-a").toMap().value("status") == "submitted",
              shell.challengeHistoryStatus());
          u3_reveal_challenge_item(view.rootObject(), QStringLiteral("challengeVerify-0"));
          u3_screenshot(*context, view, QStringLiteral("u3-challenge-pending-small"), QSize(1100, 720));
          auto* observation = u3_find_item(view.rootObject(), QStringLiteral("challengeObservation-0"));
          if (observation) observation->setProperty("currentIndex", 2);
          auto* verify = u3_find_item(view.rootObject(), QStringLiteral("challengeVerify-0"));
          u3_record(*context, QStringLiteral("challenge-manual-verification-button-dispatches"),
              verify && QMetaObject::invokeMethod(verify, "clicked", Qt::DirectConnection) && shell.challengeHistoryBusy());
          context->step = 221;
          return;
        }
        case 221: {
          if (shell.challengeHistoryBusy()) return;
          const auto record = shell.challengeHistory().isEmpty() ? QVariantMap{} : shell.challengeHistory().first().toMap();
          u3_record(*context, QStringLiteral("challenge-manual-verification-persists-observation"),
              record.value("status") == "verified" && record.value("observation") == "partially-completed" &&
              !record.value("reviewedAt").toString().isEmpty());
          u3_reveal_challenge_item(view.rootObject(), QStringLiteral("challengeSubmissionStatus-0"));
          u3_screenshot(*context, view, QStringLiteral("u3-challenge-verified-small"), QSize(1100, 720));
          auto* summary = u3_find_item(view.rootObject(), QStringLiteral("challengeExternalSummary"));
          if (summary) summary->setProperty("text", QStringLiteral("第二次实验的错误原因与修复步骤说明已留存，尚需人工复查。"));
          auto* submit = u3_find_item(view.rootObject(), QStringLiteral("challengeSubmit"));
          if (submit) QMetaObject::invokeMethod(submit, "clicked", Qt::DirectConnection);
          context->step = 222;
          return;
        }
        case 222: {
          if (shell.challengeHistoryBusy()) return;
          auto* reject = u3_find_item(view.rootObject(), QStringLiteral("challengeReject-0"));
          u3_record(*context, QStringLiteral("challenge-manual-rejection-button-dispatches"),
              shell.challengeHistory().size() == 2 && reject &&
              QMetaObject::invokeMethod(reject, "clicked", Qt::DirectConnection) && shell.challengeHistoryBusy());
          context->step = 223;
          return;
        }
        case 223:
          if (shell.challengeHistoryBusy()) return;
          u3_record(*context, QStringLiteral("challenge-rejection-preserves-previous-review"),
              shell.challengeHistory().size() == 2 &&
              shell.challengeHistory().first().toMap().value("status") == "rejected" &&
              shell.challengeHistory().last().toMap().value("status") == "verified");
          view.resize(context->detail_restore_size);
          context->step = 224;
          return;
        case 224: {
          if (view.size() != context->detail_restore_size) return;
          u3_reveal_challenge_item(view.rootObject(), QStringLiteral("challengeSubmissionStatus-0"));
          u3_screenshot(*context, view, QStringLiteral("u3-challenge-review-history"));
          shell.closeChallenge();
          shell.discardDraftChanges();
          shell.selectPage(QStringLiteral("账户"));
          context->step = 9;
          return;
        }
        case 9: {
          if (shell.operationBusy()) return;
          auto* profile_page = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("profilePageRoot"));
          auto* security_link = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("profileSecurityLink"));
          auto* privacy_link = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("profilePrivacyLink"));
          const bool profile_loaded = shell.currentPage() == QStringLiteral("账户") && profile_page &&
              security_link && privacy_link && shell.hasActiveAccount();
          u3_record(*context, QStringLiteral("account-profile-page-and-sibling-links"), profile_loaded);
          u3_screenshot(*context, view, QStringLiteral("u3-profile"));
          const bool navigated = security_link &&
              QMetaObject::invokeMethod(security_link, "clicked", Qt::DirectConnection) &&
              shell.currentPage() == QStringLiteral("账户安全");
          u3_record(*context, QStringLiteral("profile-to-security-navigation"), navigated);
          context->step++;
          return;
        }
        case 10: {
          if (shell.operationBusy()) return;
          auto* security_page = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityPageRoot"));
          auto* password_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityPasswordButton"));
          auto* delete_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityDeleteButton"));
          auto* privacy_link = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityPrivacyLink"));
          auto* current_password = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityCurrentPassword"));
          auto* new_password = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityNewPassword"));
          auto* confirm_password = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityConfirmPassword"));
          const bool security_loaded = shell.currentPage() == QStringLiteral("账户安全") && security_page &&
              password_button && delete_button && privacy_link && current_password && new_password && confirm_password &&
              !password_button->property("enabled").toBool() && !delete_button->property("enabled").toBool();
          u3_record(*context, QStringLiteral("account-security-page-and-disabled-boundaries"), security_loaded);
          u3_screenshot(*context, view, QStringLiteral("u3-security"));
          const bool navigated = privacy_link &&
              QMetaObject::invokeMethod(privacy_link, "clicked", Qt::DirectConnection) &&
              shell.currentPage() == QStringLiteral("数据与隐私");
          u3_record(*context, QStringLiteral("security-to-privacy-navigation"), navigated);
          context->step++;
          return;
        }
        case 11: {
          if (shell.operationBusy()) return;
          auto* privacy_page = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("privacyPageRoot"));
          auto* export_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("privacyExportButton"));
          auto* import_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("privacyImportButton"));
          auto* security_link = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("privacySecurityLink"));
          const bool privacy_loaded = shell.currentPage() == QStringLiteral("数据与隐私") && privacy_page &&
              export_button && import_button && security_link && export_button->property("enabled").toBool() &&
              import_button->property("enabled").toBool();
          u3_record(*context, QStringLiteral("account-privacy-page-and-data-actions"), privacy_loaded);
          u3_screenshot(*context, view, QStringLiteral("u3-privacy"));
          const bool navigated = security_link &&
              QMetaObject::invokeMethod(security_link, "clicked", Qt::DirectConnection) &&
              shell.currentPage() == QStringLiteral("账户安全");
          u3_record(*context, QStringLiteral("privacy-to-security-navigation"), navigated);
          context->step++;
          return;
        }
        case 12: {
          auto* profile_link = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("securityProfileLink"));
          const bool navigated = profile_link &&
              QMetaObject::invokeMethod(profile_link, "clicked", Qt::DirectConnection) &&
              shell.currentPage() == QStringLiteral("账户");
          u3_record(*context, QStringLiteral("security-to-profile-navigation"), navigated);
          context->step++;
          return;
        }
        case 13: {
          if (shell.accountBusy() || shell.operationBusy() || shell.contentBusy()) return;
          shell.logout();
          const bool logged_out = !shell.hasActiveAccount();
          u3_record(*context, QStringLiteral("account-logout"), logged_out);
          shell.selectPage(QStringLiteral("账户"));
          context->step++;
          return;
        }
        case 14: {
          auto* intro = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("accountLoginIntro"));
          const bool intro_visible = !shell.hasActiveAccount() && shell.currentPage() == QStringLiteral("账户") &&
              intro && intro->property("visible").toBool() &&
              intro->width() > view.width() / 2;
          u3_record(*context, QStringLiteral("account-login-intro-visible-for-guest"), intro_visible);
          u3_screenshot(*context, view, QStringLiteral("u3-login-intro"));
          shell.login(QStringLiteral("qt-u3@example.test"), QStringLiteral("Qt-U3-Test-Password-123!"));
          context->step++;
          return;
        }
        case 15:
          if (shell.accountBusy() || shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("account-login"), shell.hasActiveAccount());
          if (!shell.hasActiveAccount()) { context->step = 99; return; }
          {
            const auto index = shell.publishedIds().indexOf(QStringLiteral("python-loop-sum"));
            if (index < 0) { u3_record(*context, QStringLiteral("draft-course-selection"), false); context->step = 99; return; }
            shell.openPublishedContent(index);
          }
          context->step++;
          return;
        case 16:
          if (shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("draft-course-selection"), shell.hasSelectedContent());
          shell.loadStarterCode();
          context->step++;
          return;
        case 17: {
          if (shell.contentBusy() || shell.starterLanguage().isEmpty()) return;
          shell.selectPage(QStringLiteral("草稿"));
          auto* drafts = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftsPageRoot"));
          auto* name_field = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftNameField"));
          auto* description = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftDescription"));
          auto* file_list = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftFileList"));
          auto* file_name = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftFileName"));
          auto* line_count = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftLineCount"));
          auto* snapshot = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSnapshotPanel"));
          auto* snapshot_status = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSnapshotStatus"));
          auto* save_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSaveButton"));
          auto* checkpoint_button = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftCheckpointButton"));
          auto* error_banner = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSaveError"));
          const auto lessons = shell.lessonMeta();
          const auto lesson = std::find_if(lessons.cbegin(), lessons.cend(), [&](const QVariant& value) {
            return value.toMap().value(QStringLiteral("id")).toString() == shell.documentId();
          });
          const bool draft_structure = drafts && drafts->property("visible").toBool() && name_field && description &&
              lesson != lessons.cend() && name_field->property("readOnly").toBool() &&
              name_field->property("text").toString() == lesson->toMap().value(QStringLiteral("title")).toString() &&
              description->property("readOnly").toBool() &&
              description->property("text").toString() == lesson->toMap().value(QStringLiteral("description")).toString() &&
              file_list && file_name && file_name->property("text").toString() == QStringLiteral("main.py") &&
              line_count && line_count->property("text").toString() ==
                  QStringLiteral("%1 行").arg(shell.draftCode().isEmpty() ? 0 : shell.draftCode().count('\n') + 1) && snapshot &&
              snapshot_status && snapshot_status->property("text").toString().contains(QStringLiteral("暂无历史快照")) &&
              save_button && !save_button->property("enabled").toBool() && checkpoint_button &&
              !checkpoint_button->property("enabled").toBool();
          u3_record(*context, QStringLiteral("draft-structure-and-actual-capabilities"), draft_structure);
          u3_record(*context, QStringLiteral("draft-loaded-success-hides-error-banner"),
              error_banner && !error_banner->property("visible").toBool(), shell.contentStatus());
          u3_screenshot(*context, view, QStringLiteral("u3-drafts"));
          shell.updateDraftCode({});
          u3_record(*context, QStringLiteral("draft-empty-code-has-zero-lines"),
              drafts && drafts->property("draftLineCount").toInt() == 0 &&
              line_count && line_count->property("text").toString() == QStringLiteral("0 行"));
          shell.updateDraftCode(QStringLiteral("print('draft page save')\n# 第二行"));
          u3_record(*context, QStringLiteral("draft-line-count-updates-after-edit"),
              drafts && drafts->property("draftLineCount").toInt() == 2 &&
              save_button && save_button->property("enabled").toBool());
          // Replace only the isolated fixture's saved file with a directory to force a real write failure.
          const auto storage_id = QStringLiteral("lesson-") + QString::fromLatin1(QCryptographicHash::hash(
              shell.documentId().toUtf8(), QCryptographicHash::Sha256).toHex());
          context->blocked_draft_path = QDir(QString::fromStdWString(shell.nativeDataRoot().wstring()))
              .filePath(QStringLiteral("accounts/") + shell.activeAccountId() + QStringLiteral("/drafts/") +
                  storage_id + QStringLiteral(".txt"));
          const auto blocked_path = std::filesystem::path(context->blocked_draft_path.toStdWString());
          std::error_code error;
          const bool removed = std::filesystem::remove(blocked_path, error);
          const bool blocked = removed && !error && std::filesystem::create_directory(blocked_path, error);
          u3_record(*context, QStringLiteral("draft-save-fault-fixture-created"), blocked && !error);
          if (!blocked || error) { context->step = 99; return; }
          const bool invoked = save_button && QMetaObject::invokeMethod(save_button, "clicked", Qt::DirectConnection);
          u3_record(*context, QStringLiteral("draft-save-action-starts-and-disables"),
              invoked && shell.draftSaving() && !save_button->property("enabled").toBool());
          context->step++;
          return;
        }
        case 18: {
          if (shell.draftSaving()) return;
          auto* banner = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSaveError"));
          auto* dismiss = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftDismissError"));
          u3_record(*context, QStringLiteral("draft-save-failure-visible-and-preserves-edit"),
              banner && banner->property("visible").toBool() && shell.draftDirty() &&
              shell.draftCode() == QStringLiteral("print('draft page save')\n# 第二行"));
          u3_screenshot(*context, view, QStringLiteral("u3-drafts-save-error"));
          const bool dismissed = dismiss && QMetaObject::invokeMethod(dismiss, "clicked", Qt::DirectConnection);
          u3_record(*context, QStringLiteral("draft-save-error-dismiss-preserves-edit"),
              dismissed && banner && !banner->property("visible").toBool() && shell.draftDirty());
          shell.saveDraft();
          context->step++;
          return;
        }
        case 19: {
          if (shell.draftSaving()) return;
          auto* banner = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSaveError"));
          auto* retry = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftRetrySave"));
          std::error_code error;
          const bool unblocked = std::filesystem::remove(
              std::filesystem::path(context->blocked_draft_path.toStdWString()), error);
          u3_record(*context, QStringLiteral("draft-save-fault-fixture-removed"), unblocked && !error);
          const bool retried = unblocked && !error && banner && banner->property("visible").toBool() &&
              retry && retry->property("enabled").toBool() &&
              QMetaObject::invokeMethod(retry, "clicked", Qt::DirectConnection);
          u3_record(*context, QStringLiteral("draft-save-retry-starts"), retried && shell.draftSaving());
          context->step++;
          return;
        }
        case 20: {
          if (shell.draftSaving()) return;
          auto* banner = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSaveError"));
          QFile saved(context->blocked_draft_path);
          const bool persisted = saved.open(QIODevice::ReadOnly) &&
              saved.readAll() == shell.draftCode().toUtf8();
          u3_record(*context, QStringLiteral("draft-save-retry-persists-and-hides-error"),
              persisted && !shell.draftDirty() && shell.savedRevision() == shell.draftRevision() &&
              banner && !banner->property("visible").toBool());
          u3_record(*context, QStringLiteral("page-drafts"), shell.currentPage() == QStringLiteral("草稿"));
          view.resize(1100, 720);
          context->step++;
          return;
        }
        case 21: {
          auto* scroll = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftScrollView"));
          auto* save = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSaveButton"));
          auto* checkpoint = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("draftSnapshotPanel"));
          const bool scrollable = scroll && scroll->property("contentHeight").toReal() >= scroll->height() &&
              scroll->property("contentWidth").toReal() <= scroll->width() && save && checkpoint &&
              save->mapToItem(checkpoint, QPointF(0, save->height())).y() <= 0;
          u3_record(*context, QStringLiteral("draft-small-window-scrolls-without-overlap"), scrollable);
          u3_screenshot(*context, view, QStringLiteral("u3-drafts-small"));
          view.resize(1440, 900);
          context->step++;
          return;
        }
        case 22:
          shell.selectPage(QStringLiteral("学习"));
          context->step = 80;
          return;
        case 80: {
          if (shell.contentBusy() || shell.operationBusy() || shell.accountBusy()) return;
          auto* study = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("studyPageRoot"));
          u3_record(*context, QStringLiteral("learning-completion-evidence-loaded"),
              study && shell.lessonEvidenceReady() && study->property("completedLessonCount").toInt() == 0);
          if (!study || !shell.lessonEvidenceReady()) { context->step = 99; return; }
          const auto subjects = study->property("subjectOptions").toStringList();
          QMetaObject::invokeMethod(study, "selectSubject", Qt::DirectConnection,
              Q_ARG(QVariant, subjects.indexOf(QStringLiteral("Python"))));
          const auto lessons = shell.lessonMeta();
          for (qsizetype index = 0; index < lessons.size(); ++index) {
            if (lessons.at(index).toMap().value(QStringLiteral("id")) == QStringLiteral("python-condition"))
              QMetaObject::invokeMethod(study, "selectCourse", Qt::DirectConnection, Q_ARG(QVariant, index));
          }
          context->step++;
          return;
        }
        case 81: {
          auto* study = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("studyPageRoot"));
          auto* hero = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningHeroTitle"));
          auto* plan = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningPlanTitle"));
          auto* code = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningCodePreview"));
          const auto selected = view.rootObject()->property("selectedLesson").toMap();
          u3_record(*context, QStringLiteral("learning-selection-updates-hero-plan-and-code"),
              study && hero && plan && code && selected.value(QStringLiteral("id")) == QStringLiteral("python-condition") &&
              hero->property("text") == selected.value(QStringLiteral("title")) &&
              plan->property("text") == selected.value(QStringLiteral("title")) &&
              code->property("text").toString() == selected.value(QStringLiteral("code")).toString().split('\n').mid(0, 13).join('\n'));
          auto* completed = u3_find_item(view.rootObject(), QStringLiteral("lessonStatusFilter-2"));
          if (completed) QMetaObject::invokeMethod(completed, "choose", Qt::DirectConnection);
          context->step++;
          return;
        }
        case 82: {
          auto* study = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("studyPageRoot"));
          auto* empty = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningEmptyFilter"));
          u3_record(*context, QStringLiteral("learning-completed-filter-empty-state"),
              study && study->property("filteredLessons").toList().isEmpty() && empty && empty->isVisible());
          u3_record(*context, QStringLiteral("learning-empty-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-learning-empty")));
          // All records are written inside the matrix's disposable account, never the user's workspace.
          codeweave::learning::MasteryStore mastery(shell.nativeDataRoot() / "accounts" / shell.activeAccountId().toStdWString());
          using Kind = codeweave::learning::MasteryEvidenceKind;
          using Verification = codeweave::learning::CompletionVerification;
          const auto append = [&](const std::string& id, const std::string& ref, Kind kind, bool passed,
              Verification verification, const std::string& note) {
            const codeweave::learning::MasteryEvidence record{id, kind, ref, note, "2025-01-01T00:00:00Z", passed,
                verification, codeweave::learning::RanBy::Learner, true, "L1", "op-matrix-" +
                    QCryptographicHash::hash(QByteArray::fromStdString(id), QCryptographicHash::Sha256).toHex().left(6).toStdString()};
            bool duplicate = false;
            return mastery.append_idempotent(record, duplicate).ok && !duplicate;
          };
          const bool seeded = append("matrix-read", "python-loop-sum", Kind::Lesson, false, Verification::SelfDeclared,
                  "学习信号：已阅读 · 已读原文") &&
              append("matrix-self", "python-condition", Kind::Lesson, true, Verification::SelfDeclared, "完成声明") &&
              append("matrix-auto", "java-loop-sum", Kind::Lesson, true, Verification::AutoVerified, "自动验证 fixture") &&
              append("matrix-review", "c-loop-sum", Kind::Review, true, Verification::SelfDeclared, "复测通过") &&
              append("matrix-challenge", "javascript-loop-sum", Kind::Challenge, true, Verification::AutoVerified, "挑战 fixture");
          u3_record(*context, QStringLiteral("learning-isolated-evidence-fixture-created"), seeded);
          shell.refreshReviewSummary();
          context->step++;
          return;
        }
        case 83: {
          if (shell.operationBusy()) return;
          auto* study = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("studyPageRoot"));
          if (!study) { u3_record(*context, QStringLiteral("learning-filter-controls"), false); context->step = 99; return; }
          const auto subjects = study->property("subjectOptions").toStringList();
          const auto lessons = shell.lessonMeta();
          const QStringList completed_ids{QStringLiteral("python-condition"), QStringLiteral("java-loop-sum"), QStringLiteral("c-loop-sum")};
          bool combinations = shell.lessonEvidenceReady();
          for (int subject = -1; subject < subjects.size(); ++subject) {
            QMetaObject::invokeMethod(study, "selectSubject", Qt::DirectConnection, Q_ARG(QVariant, subject));
            int expected_completed = 0;
            for (int status = 0; status < 3; ++status) {
              auto* filter = u3_find_item(view.rootObject(), QStringLiteral("lessonStatusFilter-") + QString::number(status));
              combinations = combinations && filter && filter->property("available").toBool();
              if (filter) QMetaObject::invokeMethod(filter, "choose", Qt::DirectConnection);
              QStringList expected;
              for (const auto& value : lessons) {
                const auto lesson = value.toMap();
                const auto label = lesson.value(QStringLiteral("languageLabel")).toString().isEmpty()
                    ? lesson.value(QStringLiteral("language")).toString() : lesson.value(QStringLiteral("languageLabel")).toString();
                const auto id = lesson.value(QStringLiteral("id")).toString();
                if ((subject < 0 || label == subjects.at(subject)) &&
                    (status == 0 || completed_ids.contains(id) == (status == 2))) expected.append(id);
              }
              QStringList actual;
              for (const auto& value : study->property("filteredLessons").toList()) {
                const auto lesson = value.toMap();
                const auto original = lesson.value(QStringLiteral("originalIndex")).toInt();
                combinations = combinations && original >= 0 && original < lessons.size() &&
                    lessons.at(original).toMap().value(QStringLiteral("id")) == lesson.value(QStringLiteral("id"));
                actual.append(lesson.value(QStringLiteral("id")).toString());
              }
              combinations = combinations && actual == expected;
              if (status == 2) expected_completed = expected.size();
            }
            combinations = combinations && study->property("completedLessonCount").toInt() == expected_completed;
          }
          u3_record(*context, QStringLiteral("learning-all-subject-status-combinations-and-original-indices"), combinations);
          u3_record(*context, QStringLiteral("learning-reading-and-challenge-not-completion"),
              shell.lessonEvidenceStates().value(QStringLiteral("python-loop-sum")).toMap().value(QStringLiteral("read")).toBool() &&
              !shell.lessonEvidenceStates().value(QStringLiteral("javascript-loop-sum")).toMap().value(QStringLiteral("selfDeclaredPassed")).toBool() &&
              !shell.lessonEvidenceStates().value(QStringLiteral("javascript-loop-sum")).toMap().value(QStringLiteral("autoVerifiedPassed")).toBool() &&
              !shell.lessonEvidenceStates().value(QStringLiteral("javascript-loop-sum")).toMap().value(QStringLiteral("reviewMastered")).toBool());
          QMetaObject::invokeMethod(study, "selectSubject", Qt::DirectConnection,
              Q_ARG(QVariant, subjects.indexOf(QStringLiteral("Python"))));
          const auto filtered = study->property("filteredLessons").toList();
          if (!filtered.isEmpty()) QMetaObject::invokeMethod(study, "selectCourse", Qt::DirectConnection,
              Q_ARG(QVariant, filtered.first().toMap().value(QStringLiteral("originalIndex"))));
          context->step++;
          return;
        }
        case 84: {
          auto* number = u3_find_item(view.rootObject(), QStringLiteral("lessonNumber-python-condition"));
          auto* count = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningCompletionCount"));
          auto* study = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("studyPageRoot"));
          u3_record(*context, QStringLiteral("learning-filtered-sequence-starts-at-one-and-count-is-subject-scoped"),
              number && number->property("text").toString() == QStringLiteral("01") && count && study &&
              count->property("text").toString() == QStringLiteral("1 / %1 个单元已有完成证据")
                  .arg(study->property("subjectLessons").toList().size()));
          u3_record(*context, QStringLiteral("learning-completed-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-learning-completed")));
          auto* enter = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningContinue"));
          u3_record(*context, QStringLiteral("learning-enter-selected-course-action"),
              enter && enter->property("enabled").toBool() && QMetaObject::invokeMethod(enter, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 85: {
          if (shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("learning-enter-resolves-published-id-and-syncs-selection"),
              shell.currentPage() == QStringLiteral("编辑器") && shell.documentId() == QStringLiteral("python-condition") &&
              view.rootObject()->property("selectedLesson").toMap().value(QStringLiteral("id")) == shell.documentId());
          shell.updateDraftCode(QStringLiteral("print('preserve unsaved selection')"));
          const auto selected = view.rootObject()->property("selectedLessonIndex");
          QVariant opened;
          QMetaObject::invokeMethod(view.rootObject(), "openLesson", Qt::DirectConnection,
              Q_RETURN_ARG(QVariant, opened), Q_ARG(QVariant, 0));
          u3_record(*context, QStringLiteral("learning-changing-course-preserves-unsaved-draft"),
              !opened.toBool() && shell.documentId() == QStringLiteral("python-condition") && shell.draftDirty() &&
              shell.draftCode() == QStringLiteral("print('preserve unsaved selection')") &&
              view.rootObject()->property("selectedLessonIndex") == selected);
          shell.discardDraftChanges();
          shell.refreshReviewSummary();
          shell.selectPage(QStringLiteral("学习"));
          context->step++;
          return;
        }
        case 86: {
          if (shell.operationBusy() || shell.contentBusy()) return;
          auto* study = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("studyPageRoot"));
          u3_record(*context, QStringLiteral("learning-queued-refresh-finishes-after-busy"),
              study && !study->property("evidenceRefreshPending").toBool() && shell.lessonEvidenceReady());
          auto* details = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningDetailsOpen"));
          u3_record(*context, QStringLiteral("learning-details-open-action"), details &&
              QMetaObject::invokeMethod(details, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 87: {
          auto* details = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningDetailsRoot"));
          const auto groups = details ? details->property("groups").toList() : QVariantList{};
          const auto lessons = details ? details->property("lessons").toList() : QVariantList{};
          bool stages = details && details->isVisible() && !lessons.isEmpty() &&
              details->property("statistics").toList().size() == 5 && groups.size() == 11 &&
              details->property("publishedStageCount").toInt() == 0 && details->property("stageGapCount").toInt() == 0 &&
              details->property("unitGapCount").toInt() == lessons.size();
          for (int index = 0; index < std::min(10, static_cast<int>(groups.size())); ++index) {
            stages = stages && groups.at(index).toMap().value(QStringLiteral("key")) == QStringLiteral("S%1").arg(index) &&
                groups.at(index).toMap().value(QStringLiteral("lessons")).toList().isEmpty();
          }
          stages = stages && !groups.isEmpty() && groups.last().toMap().value(QStringLiteral("lessons")).toList().size() == lessons.size();
          u3_record(*context, QStringLiteral("learning-details-five-statistics-and-truthful-stage-groups"), stages);
          auto* source_banner = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningSourceBanner"));
          auto* welcome = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningWelcome"));
          auto* statistics = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningDetailsStatistics"));
          auto* first_statistic = u3_find_item(view.rootObject(), QStringLiteral("detailStatistic-0"));
          auto* last_statistic = u3_find_item(view.rootObject(), QStringLiteral("detailStatistic-4"));
          u3_record(*context, QStringLiteral("learning-details-preserves-header-and-vertical-statistics"),
              source_banner && source_banner->isVisible() && welcome && welcome->isVisible() && details &&
              source_banner->mapToItem(welcome, QPointF(0, source_banner->height())).y() <= 0 &&
              welcome->mapToItem(details, QPointF(0, welcome->height())).y() <= 0 &&
              statistics && statistics->width() <= 470 && first_statistic && last_statistic &&
              first_statistic->mapToItem(last_statistic, QPointF(0, first_statistic->height())).y() <= 0);
          auto* python_meta = u3_find_item(view.rootObject(), QStringLiteral("detailSubjectMeta-0"));
          auto* evidence = u3_find_item(view.rootObject(), QStringLiteral("detailEvidence-python-condition"));
          u3_record(*context, QStringLiteral("learning-details-actual-subject-metadata-and-evidence-labels"),
              python_meta && python_meta->property("text").toString().contains(QStringLiteral("6 个单元")) &&
              evidence && evidence->property("text").toString() == QStringLiteral("证据：自评通过"));
          auto* title = u3_find_item(view.rootObject(), QStringLiteral("learningDetailsTitle"));
          u3_record(*context, QStringLiteral("learning-details-resolves-windows-ui-font"), title &&
              QFontInfo(title->property("font").value<QFont>()).family() == QStringLiteral("Microsoft YaHei UI"));
          auto* rail = u3_find_item(view.rootObject(), QStringLiteral("detailStageRail-S0"));
          auto* body = u3_find_item(view.rootObject(), QStringLiteral("detailStageBody-S0"));
          u3_record(*context, QStringLiteral("learning-details-stage-number-rail-precedes-content"), rail && body &&
              rail->width() >= 56 && rail->height() >= body->height() &&
              rail->mapToItem(body, QPointF(rail->width(), 0)).x() < 0);
          u3_record(*context, QStringLiteral("learning-details-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-learning-details")));
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          auto* open = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningDetailsOpen"));
          auto* study = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("studyPageRoot"));
          u3_record(*context, QStringLiteral("learning-details-escape-restores-trigger-focus"),
              study && !study->property("showDetails").toBool() && open && open->hasActiveFocus());
          if (open) QMetaObject::invokeMethod(open, "clicked", Qt::DirectConnection);
          context->step++;
          return;
        }
        case 88: {
          auto* study = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("studyPageRoot"));
          const auto subjects = study ? study->property("subjectOptions").toStringList() : QStringList{};
          auto* subject = u3_find_item(view.rootObject(), QStringLiteral("detailSubject-") +
              QString::number(subjects.indexOf(QStringLiteral("Java"))));
          u3_record(*context, QStringLiteral("learning-details-subject-selection"), subject &&
              QMetaObject::invokeMethod(subject, "clicked", Qt::DirectConnection) && study &&
              study->property("subjectFilter").toInt() == subjects.indexOf(QStringLiteral("Java")));
          context->step++;
          return;
        }
        case 89: {
          auto* lesson = u3_find_item(view.rootObject(), QStringLiteral("detailLesson-java-loop-sum"));
          if (lesson) lesson->forceActiveFocus();
          send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier);
          auto* selected = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("detailSelectedTitle"));
          u3_record(*context, QStringLiteral("learning-details-lesson-keyboard-selection"), lesson && selected &&
              view.rootObject()->property("selectedLesson").toMap().value(QStringLiteral("id")) == QStringLiteral("java-loop-sum") &&
              selected->property("text") == lesson->property("text"));
          auto* scroll = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningDetailsScroll"));
          const auto lesson_top = lesson && scroll ? lesson->mapToItem(scroll, QPointF(0, 0)).y() : -1;
          u3_record(*context, QStringLiteral("learning-details-keyboard-focus-scrolls-to-lesson"),
              lesson && scroll && lesson_top >= 0 && lesson_top + lesson->height() <= scroll->height() + 1);
          auto* header = u3_find_item(view.rootObject(), QStringLiteral("detailLedgerHeader-unnumbered"));
          auto* lesson_body = u3_find_item(view.rootObject(), QStringLiteral("detailLessonBody-java-loop-sum"));
          const auto header_children = header ? header->childItems() : QList<QQuickItem*>{};
          u3_record(*context, QStringLiteral("learning-details-ledger-title-column-aligns-with-header"),
              header_children.size() >= 3 && lesson_body &&
              std::abs(header_children.at(1)->mapToItem(lesson_body, QPointF(0, 0)).x()) <= 1);
          view.resize(1100, 720);
          context->step++;
          return;
        }
        case 90: {
          auto* scroll = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningDetailsScroll"));
          auto* enter = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningDetailsContinue"));
          auto* title = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("detailSelectedTitle"));
          u3_record(*context, QStringLiteral("learning-details-small-window-scrolls-without-overlap"),
              scroll && scroll->property("contentHeight").toReal() > scroll->height() &&
              scroll->property("contentWidth").toReal() <= scroll->width() && enter && title &&
              title->mapToItem(enter, QPointF(0, title->height())).y() <= 0);
          u3_record(*context, QStringLiteral("learning-details-small-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-learning-details-small")));
          if (scroll) {
            auto* flickable = scroll->property("contentItem").value<QObject*>();
            if (flickable) flickable->setProperty("contentY", std::max(0.0,
                scroll->property("contentHeight").toReal() - scroll->property("availableHeight").toReal()));
          }
          context->step++;
          return;
        }
        case 91: {
          u3_record(*context, QStringLiteral("learning-details-selected-unit-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-learning-details-selected")));
          auto* enter = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("learningDetailsContinue"));
          u3_record(*context, QStringLiteral("learning-details-enter-action"), enter && enter->property("enabled").toBool() &&
              QMetaObject::invokeMethod(enter, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 92:
          if (shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("learning-details-enter-target"), shell.currentPage() == QStringLiteral("编辑器") &&
              shell.documentId() == QStringLiteral("java-loop-sum"));
          view.resize(1440, 900);
          context->step = 200;
          return;
        case 200: {
          if (shell.operationBusy()) return;
          codeweave::learning::MasteryStore mastery(shell.nativeDataRoot() / "accounts" / shell.activeAccountId().toStdWString());
          const QStringList ids{QStringLiteral("python-loop-sum"), QStringLiteral("python-condition"), QStringLiteral("java-loop-sum")};
          bool seeded = true;
          for (int index = 0; index < ids.size(); ++index) {
            const auto timestamp = QDate::currentDate().addDays(index - 2).toString(Qt::ISODate) + QStringLiteral("T00:00:00Z");
            const codeweave::learning::MasteryEvidence record{
                "matrix-schedule-" + std::to_string(index), codeweave::learning::MasteryEvidenceKind::Lesson,
                ids.at(index).toStdString(), "isolated review schedule fixture", timestamp.toStdString(), true,
                codeweave::learning::CompletionVerification::SelfDeclared,
                codeweave::learning::RanBy::Learner, true, "L1", "op-matrixschedule-0123a" + std::to_string(index)};
            bool duplicate = false;
            const auto appended = mastery.append_idempotent(record, duplicate);
            seeded = appended.ok && !duplicate && seeded;
            if (!appended.ok) u3_record(*context, QStringLiteral("review-fixture-append-error"), false,
                QString::fromUtf8(appended.message));
          }
          u3_record(*context, QStringLiteral("review-three-group-fixture-created"), seeded);
          shell.selectPage(QStringLiteral("复习与进度"));
          shell.refreshReviewSummary();
          context->step++;
          return;
        }
        case 201: {
          if (shell.operationBusy()) return;
          auto* page = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("reviewPageRoot"));
          const QStringList ids{QStringLiteral("python-loop-sum"), QStringLiteral("python-condition"), QStringLiteral("java-loop-sum")};
          const QStringList groups{QStringLiteral("overdue"), QStringLiteral("today"), QStringLiteral("upcoming")};
          bool grouped = page && page->isVisible();
          for (int index = 0; index < ids.size(); ++index) {
            QVariantMap actual;
            for (const auto& value : shell.reviewItems())
              if (value.toMap().value(QStringLiteral("contentId")) == ids.at(index) &&
                  value.toMap().value(QStringLiteral("exerciseId")).toString().isEmpty()) actual = value.toMap();
            QVariant rows;
            const bool invoked = page && QMetaObject::invokeMethod(page, "itemsForGroup", Qt::DirectConnection,
                Q_RETURN_ARG(QVariant, rows), Q_ARG(QVariant, groups.at(index)));
            grouped = grouped && invoked && rows.toList().contains(actual) &&
                actual.value(QStringLiteral("group")) == groups.at(index) &&
                actual.value(QStringLiteral("dueKey")).toString() == QDate::currentDate().addDays(index - 1).toString(Qt::ISODate);
            if (index == 0) context->review_before = actual;
          }
          u3_record(*context, QStringLiteral("review-three-groups-match-real-schedules"), grouped);
          u3_record(*context, QStringLiteral("review-nonempty-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-review-nonempty")));
          auto* pass = u3_find_item(view.rootObject(), QStringLiteral("reviewPass-python-loop-sum"));
          u3_record(*context, QStringLiteral("review-pass-row-action"), pass && pass->property("enabled").toBool() &&
              QMetaObject::invokeMethod(pass, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 202: {
          if (shell.operationBusy()) return;
          QVariantMap updated;
          for (const auto& value : shell.reviewItems())
            if (value.toMap().value(QStringLiteral("contentId")) == QStringLiteral("python-loop-sum") &&
                value.toMap().value(QStringLiteral("exerciseId")).toString().isEmpty()) updated = value.toMap();
          u3_record(*context, QStringLiteral("review-pass-refreshes-level-step-and-due-date"),
              updated.value(QStringLiteral("masteryLevel")).toInt() == context->review_before.value(QStringLiteral("masteryLevel")).toInt() + 1 &&
              updated.value(QStringLiteral("nextNodeIndex")).toInt() == 1 &&
              updated.value(QStringLiteral("dueKey")).toString() == QDate::currentDate().addDays(3).toString(Qt::ISODate) &&
              updated.value(QStringLiteral("group")) == QStringLiteral("upcoming"),
              QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(updated)).toJson(QJsonDocument::Compact)));
          for (const auto& value : shell.reviewItems())
            if (value.toMap().value(QStringLiteral("contentId")) == QStringLiteral("python-condition") &&
                value.toMap().value(QStringLiteral("exerciseId")).toString().isEmpty()) context->review_before = value.toMap();
          auto* snooze = u3_find_item(view.rootObject(), QStringLiteral("reviewSnooze-python-condition"));
          u3_record(*context, QStringLiteral("review-snooze-row-action"), snooze && snooze->property("enabled").toBool() &&
              QMetaObject::invokeMethod(snooze, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 203: {
          if (shell.operationBusy()) return;
          QVariantMap updated;
          for (const auto& value : shell.reviewItems())
            if (value.toMap().value(QStringLiteral("contentId")) == QStringLiteral("python-condition") &&
                value.toMap().value(QStringLiteral("exerciseId")).toString().isEmpty()) updated = value.toMap();
          u3_record(*context, QStringLiteral("review-snooze-refreshes-date-without-changing-mastery"),
              updated.value(QStringLiteral("masteryLevel")) == context->review_before.value(QStringLiteral("masteryLevel")) &&
              updated.value(QStringLiteral("nextNodeIndex")) == context->review_before.value(QStringLiteral("nextNodeIndex")) &&
              updated.value(QStringLiteral("dueKey")).toString() == QDate::currentDate().addDays(1).toString(Qt::ISODate) &&
              updated.value(QStringLiteral("group")) == QStringLiteral("upcoming"));
          u3_record(*context, QStringLiteral("review-updated-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-review-updated")));
          auto* open = u3_find_item(view.rootObject(), QStringLiteral("reviewOpen-java-loop-sum"));
          u3_record(*context, QStringLiteral("review-open-course-row-action"), open && open->property("enabled").toBool() &&
              QMetaObject::invokeMethod(open, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 204:
          if (shell.contentBusy()) return;
          u3_record(*context, QStringLiteral("review-open-course-resolves-published-id"),
              shell.hasSelectedContent() && shell.documentId() == QStringLiteral("java-loop-sum"),
              QStringLiteral("page=%1 document=%2 selected=%3 body=%4")
                  .arg(shell.currentPage(), shell.documentId()).arg(shell.hasSelectedContent())
                  .arg(!shell.selectedContentBody().isEmpty()));
          shell.openPublishedContent(shell.publishedIds().indexOf(QStringLiteral("stage-d")));
          shell.selectPage(QStringLiteral("编辑器"));
          context->step = 300;
          return;
        case 300: {
          if (shell.contentBusy()) return;
          const auto workspace_size = view.size();
          view.resize(QSize(1100, 720));
          QCoreApplication::processEvents();
          auto* title = u3_find_item(view.rootObject(), QStringLiteral("workspaceLessonTitle"));
          auto* breadcrumb = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbs"));
          auto* breadcrumb_index = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbIndex"));
          auto* breadcrumb_label = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("breadcrumbEntryLabel"));
          auto* accessible_breadcrumb = breadcrumb
              ? QAccessible::queryAccessibleInterface(breadcrumb) : nullptr;
          const auto published_index = shell.publishedIds().indexOf(shell.documentId());
          const auto published_title = published_index >= 0
              ? shell.publishedTitles().value(published_index) : QString{};
          const auto selected = view.rootObject()->property("selectedLesson").toMap();
          const bool is_course = selected.value(QStringLiteral("id")).toString() == shell.documentId();
          const auto expected_header = published_title;
          const auto expected_breadcrumb = QStringLiteral("Code Canvas / 课程 / stage-d");
          const auto actual_breadcrumb = breadcrumb
              ? breadcrumb->property("text").toString() : QString{};
          const auto actual_accessible_name = accessible_breadcrumb
              ? accessible_breadcrumb->text(QAccessible::Name) : QString{};
          const auto detail = QStringLiteral(
              "document=%1 selected=%2 publishedIndex=%3 catalogTitle=%4 header=%5 isCourse=%6 "
              "selectedLessonId=%7 indexVisible=%8 indexText=%9 entryLabel=%10 breadcrumb=%11 accessible=%12")
              .arg(shell.documentId())
              .arg(shell.hasSelectedContent())
              .arg(published_index)
              .arg(published_title)
              .arg(title ? title->property("text").toString() : QString{})
              .arg(is_course)
              .arg(selected.value(QStringLiteral("id")).toString())
              .arg(breadcrumb_index && breadcrumb_index->isVisible())
              .arg(breadcrumb_index ? breadcrumb_index->property("text").toString() : QString{})
              .arg(breadcrumb_label ? breadcrumb_label->property("text").toString() : QString{})
              .arg(actual_breadcrumb)
              .arg(actual_accessible_name);
          u3_record(*context, QStringLiteral("challenge-document-workspace-header-matches-catalog"),
              shell.documentId() == QStringLiteral("stage-d") &&
              shell.hasSelectedContent() && published_index >= 0 &&
              title && title->isVisible() && title->property("text").toString() == expected_header, detail);
          u3_record(*context, QStringLiteral("challenge-document-breadcrumb-is-accessible-without-course-index"),
              !is_course &&
              breadcrumb && breadcrumb->isVisible() &&
              actual_breadcrumb == expected_breadcrumb &&
              accessible_breadcrumb && actual_accessible_name ==
                  QStringLiteral("当前位置：") + expected_breadcrumb &&
              breadcrumb_index && !breadcrumb_index->isVisible() &&
              breadcrumb_label && breadcrumb_label->isVisible() &&
              breadcrumb_label->property("text").toString() == QStringLiteral("stage-d"), detail);
          u3_record(*context, QStringLiteral("lesson-workspace-breadcrumb-narrow-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-workspace-breadcrumb-unlisted-narrow"), QSize(1100, 720)));
          view.resize(workspace_size);
          QCoreApplication::processEvents();
          auto* flow = u3_find_item(view.rootObject(), QStringLiteral("workspaceFlowNodes"));
          u3_record(*context, QStringLiteral("lesson-workspace-missing-metadata-clears-previous-flow"),
              flow && flow->property("nodeCount").isValid() && flow->property("nodeCount").toInt() == 0);
          auto* open = u3_find_item(view.rootObject(), QStringLiteral("lessonEvidenceOpen"));
          u3_record(*context, QStringLiteral("lesson-evidence-opens-from-workspace"), open && open->isVisible() &&
              open->property("enabled").toBool() && QMetaObject::invokeMethod(open, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 301: {
          if (shell.operationBusy()) return;
          auto* read = u3_find_item(view.contentItem(), QStringLiteral("lessonMarkRead"));
          u3_record(*context, QStringLiteral("lesson-contract-unrun-blocks-completion"),
              shell.lessonAssessment().value("cases").toList().size() == 3 &&
              !shell.lessonAssessment().value("canComplete").toBool());
          u3_record(*context, QStringLiteral("lesson-mark-read-action"), read && read->property("enabled").toBool() &&
              QMetaObject::invokeMethod(read, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 302: {
          if (shell.operationBusy()) return;
          const auto states = shell.lessonEvidenceStates().value(QStringLiteral("stage-d")).toMap();
          u3_record(*context, QStringLiteral("lesson-read-is-persisted-without-completing"),
              states.value("read").toBool() && !shell.lessonAssessment().value("completed").toBool());
          u3_screenshot(*context, view, QStringLiteral("u3-lesson-read"));
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          shell.updateDraftCode(QStringLiteral("console.log('待办数量: 20');\n"));
          auto* run = u3_find_item(view.rootObject(), QStringLiteral("workspaceRunCode"));
          u3_record(*context, QStringLiteral("lesson-run-miss-from-workspace"), run && run->property("enabled").toBool() &&
              QMetaObject::invokeMethod(run, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 303: {
          if (shell.executionBusy() || shell.operationBusy()) return;
          const auto states = shell.lessonEvidenceStates().value(QStringLiteral("stage-d")).toMap();
          u3_record(*context, QStringLiteral("lesson-successful-process-is-practice-not-completion"),
              states.value("practiced").toBool() && !shell.lessonAssessment().value("completed").toBool() &&
              !shell.lessonAssessment().value("canComplete").toBool());
          auto* open = u3_find_item(view.rootObject(), QStringLiteral("lessonEvidenceOpen"));
          if (open) QMetaObject::invokeMethod(open, "clicked", Qt::DirectConnection);
          context->step++;
          return;
        }
        case 304: {
          if (shell.operationBusy()) return;
          u3_screenshot(*context, view, QStringLiteral("u3-lesson-missed-cases"));
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          shell.updateDraftCode(QStringLiteral("console.log('待办数量: 2'); console.log('写周报'); console.log('跑一次构建');\n"));
          shell.runCode();
          context->step++;
          return;
        }
        case 305: {
          if (shell.executionBusy() || shell.operationBusy()) return;
          u3_record(*context, QStringLiteral("lesson-current-code-all-cases-hit"),
              shell.lessonAssessment().value("canComplete").toBool() &&
              shell.lessonAssessment().value("autoVerified").toBool());
          auto* complete = u3_find_item(view.rootObject(), QStringLiteral("workspaceCompleteLesson"));
          u3_record(*context, QStringLiteral("lesson-explicit-completion-action"), complete && complete->property("enabled").toBool() &&
              QMetaObject::invokeMethod(complete, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 306: {
          if (shell.operationBusy()) return;
          const auto states = shell.lessonEvidenceStates().value(QStringLiteral("stage-d")).toMap();
          u3_record(*context, QStringLiteral("lesson-completion-reloads-verified-fact"),
              states.value("autoVerifiedPassed").toBool() && !states.value("selfDeclaredPassed").toBool());
          auto* open = u3_find_item(view.rootObject(), QStringLiteral("lessonEvidenceOpen"));
          if (open) QMetaObject::invokeMethod(open, "clicked", Qt::DirectConnection);
          context->step++;
          return;
        }
        case 307:
          if (shell.operationBusy()) return;
          u3_screenshot(*context, view, QStringLiteral("u3-lesson-verified"));
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          context->step++;
          return;
        case 308: {
          auto* open = u3_find_item(view.rootObject(), QStringLiteral("lessonEvidenceOpen"));
          u3_record(*context, QStringLiteral("lesson-dialog-escape-restores-trigger-focus"),
              open && open->property("activeFocus").toBool());
          shell.discardDraftChanges();
          shell.openPublishedContent(shell.publishedIds().indexOf(QStringLiteral("csharp-loop-sum")));
          view.resize(1100, 720);
          context->step++;
          return;
        }
        case 309: {
          if (shell.contentBusy()) return;
          QVariantMap lesson;
          for (const auto& value : shell.lessonMeta())
            if (value.toMap().value("id") == shell.documentId()) lesson = value.toMap();
          auto* title = u3_find_item(view.rootObject(), QStringLiteral("workspaceLessonTitle"));
          auto* flow = u3_find_item(view.rootObject(), QStringLiteral("workspaceFlowNodes"));
          const auto title_text = title ? title->property("text").toString() : QStringLiteral("<missing>");
          const auto expected_title = lesson.value("title").toString();
          const auto flow_count = flow ? flow->property("nodeCount").toInt() : -1;
          const auto expected_flow_count = lesson.value("flow").toList().size();
          u3_record(*context, QStringLiteral("lesson-workspace-external-document-updates-title-and-flow"),
              !lesson.isEmpty() && title_text.contains(expected_title) && flow_count == expected_flow_count &&
              view.rootObject()->property("breadcrumbText").toString().contains(expected_title) &&
              view.rootObject()->property("selectedLesson").toMap().value("id") == shell.documentId(),
              QStringLiteral("doc=%1 title=%2 expected=%3 flow=%4 expectedFlow=%5 breadcrumb=%6")
                  .arg(shell.documentId(), title_text, expected_title).arg(flow_count).arg(expected_flow_count)
                  .arg(view.rootObject()->property("breadcrumbText").toString()));
          auto* open = u3_find_item(view.rootObject(), QStringLiteral("lessonEvidenceOpen"));
          if (open) QMetaObject::invokeMethod(open, "clicked", Qt::DirectConnection);
          context->step++;
          return;
        }
        case 310: {
          if (shell.operationBusy()) return;
          const auto set = [&](const char* name, const QString& text) {
            auto* field = u3_find_item(view.contentItem(), QString::fromLatin1(name));
            return field && field->setProperty("text", text);
          };
          const bool filled = set("lessonExternalEnvironment", QStringLiteral("Windows .NET isolated matrix")) &&
              set("lessonExternalCommand", QStringLiteral("dotnet run")) &&
              set("lessonExternalSummary", QStringLiteral("能不看示例写出循环累加，并解释任意一轮 total 的值。输出 15。<b>保留原文</b>")) &&
              set("lessonExternalArtifact", QStringLiteral("isolated-fixture.log")) &&
              set("lessonExternalDate", QDate::currentDate().toString(Qt::ISODate));
          u3_record(*context, QStringLiteral("lesson-external-form-filled-with-required-date"), filled && shell.lessonAssessment().value("external").toBool());
          u3_screenshot(*context, view, QStringLiteral("u3-lesson-external-small"));
          auto* submit = u3_find_item(view.contentItem(), QStringLiteral("lessonSubmitExternal"));
          u3_record(*context, QStringLiteral("lesson-external-submit-action"), submit && submit->property("enabled").toBool() &&
              QMetaObject::invokeMethod(submit, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 311: {
          if (shell.operationBusy()) return;
          const auto states = shell.lessonEvidenceStates().value(QStringLiteral("csharp-loop-sum")).toMap();
          u3_record(*context, QStringLiteral("lesson-external-submitted-without-completion"), states.value("submittedEvidence").toBool() &&
              !states.value("selfDeclaredPassed").toBool() && !states.value("autoVerifiedPassed").toBool());
          auto* complete = u3_find_item(view.contentItem(), QStringLiteral("lessonComplete"));
          u3_record(*context, QStringLiteral("lesson-external-self-declaration-action"), complete && complete->property("enabled").toBool() &&
              QMetaObject::invokeMethod(complete, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 312: {
          if (shell.operationBusy()) return;
          const auto states = shell.lessonEvidenceStates().value(QStringLiteral("csharp-loop-sum")).toMap();
          u3_record(*context, QStringLiteral("lesson-external-completion-is-self-declared"), states.value("selfDeclaredPassed").toBool() &&
              !states.value("autoVerifiedPassed").toBool() && shell.lessonAssessment().value("completed").toBool());
          auto* scroll = u3_find_item(view.contentItem(), QStringLiteral("lessonEvidenceScroll"));
          auto* flickable = scroll ? scroll->property("contentItem").value<QObject*>() : nullptr;
          if (flickable) flickable->setProperty("contentY", std::max(0.0,
              scroll->property("contentHeight").toReal() - scroll->property("availableHeight").toReal()));
          u3_record(*context, QStringLiteral("lesson-evidence-small-scroll-width"), scroll && flickable &&
              scroll->property("contentWidth").toReal() <= scroll->property("availableWidth").toReal());
          context->step++;
          return;
        }
        case 313:
          u3_screenshot(*context, view, QStringLiteral("u3-lesson-external-states-small"));
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          view.resize(1440, 900);
          shell.discardDraftChanges();
          shell.openPublishedContent(shell.publishedIds().indexOf(QStringLiteral("python-loop-sum")));
          context->step = 400;
          return;
        case 400:
          if (shell.contentBusy() || shell.operationBusy()) return;
          shell.selectPage(QStringLiteral("编辑器"));
          shell.updateDraftCode(QStringLiteral("print('workspace save fixture')\n"));
          shell.saveDraft();
          context->step++;
          return;
        case 401: {
          if (shell.draftSaving() || shell.operationBusy()) return;
          const auto storage_id = QStringLiteral("lesson-") + QString::fromLatin1(QCryptographicHash::hash(
              shell.documentId().toUtf8(), QCryptographicHash::Sha256).toHex());
          context->blocked_draft_path = QDir(QString::fromStdWString(shell.nativeDataRoot().wstring()))
              .filePath(QStringLiteral("accounts/") + shell.activeAccountId() + QStringLiteral("/drafts/") +
                  storage_id + QStringLiteral(".txt"));
          const auto path = std::filesystem::path(context->blocked_draft_path.toStdWString());
          std::error_code error;
          const bool blocked = std::filesystem::remove(path, error) && !error &&
              std::filesystem::create_directory(path, error) && !error;
          u3_record(*context, QStringLiteral("workspace-save-fault-fixture-created"), blocked);
          if (!blocked) { context->step = 99; return; }
          shell.updateDraftCode(QStringLiteral("print('workspace unsaved edit')\n"));
          auto* save = u3_find_item(view.rootObject(), QStringLiteral("workspaceSaveDraft"));
          const bool invoked = save && QMetaObject::invokeMethod(save, "clicked", Qt::DirectConnection);
          u3_record(*context, QStringLiteral("workspace-save-starts-and-disables"), invoked && shell.draftSaving() &&
              !save->property("enabled").toBool());
          context->step++;
          return;
        }
        case 402: {
          if (shell.draftSaving()) return;
          auto* banner = u3_find_item(view.rootObject(), QStringLiteral("workspaceSaveError"));
          auto* dismiss = u3_find_item(view.rootObject(), QStringLiteral("workspaceDismissError"));
          u3_record(*context, QStringLiteral("workspace-save-failure-visible-and-preserves-edit"),
              banner && banner->isVisible() && shell.draftDirty() &&
              shell.draftCode() == QStringLiteral("print('workspace unsaved edit')\n"));
          u3_record(*context, QStringLiteral("workspace-save-error-screenshot"),
              u3_screenshot(*context, view, QStringLiteral("u3-workspace-save-error")));
          const bool dismissed = dismiss && QMetaObject::invokeMethod(dismiss, "clicked", Qt::DirectConnection);
          u3_record(*context, QStringLiteral("workspace-dismiss-preserves-edit"), dismissed && banner &&
              !banner->isVisible() && shell.draftDirty());
          shell.saveDraft();
          context->step++;
          return;
        }
        case 403: {
          if (shell.draftSaving()) return;
          std::error_code error;
          const bool unblocked = std::filesystem::remove(
              std::filesystem::path(context->blocked_draft_path.toStdWString()), error) && !error;
          u3_record(*context, QStringLiteral("workspace-save-fault-fixture-removed"), unblocked);
          auto* retry = u3_find_item(view.rootObject(), QStringLiteral("workspaceRetrySave"));
          const bool retried = unblocked && retry && retry->isEnabled() &&
              QMetaObject::invokeMethod(retry, "clicked", Qt::DirectConnection);
          u3_record(*context, QStringLiteral("workspace-retry-starts"), retried && shell.draftSaving());
          context->step++;
          return;
        }
        case 404: {
          if (shell.draftSaving() || shell.operationBusy() || shell.challengeHistoryBusy()) return;
          auto* banner = u3_find_item(view.rootObject(), QStringLiteral("workspaceSaveError"));
          QFile saved(context->blocked_draft_path);
          const bool persisted = saved.open(QIODevice::ReadOnly) && saved.readAll() == shell.draftCode().toUtf8();
          u3_record(*context, QStringLiteral("workspace-retry-persists-and-hides-error"), persisted && !shell.draftDirty() &&
              shell.savedRevision() == shell.draftRevision() && banner && !banner->isVisible());
          shell.selectPage(QStringLiteral("复习与进度"));
          auto* review_error = u3_find_item(view.rootObject(), QStringLiteral("reviewContentError"));
          u3_record(*context, QStringLiteral("review-normal-content-hides-error"),
              review_error && !review_error->isVisible(), shell.contentStatus());
          shell.logout();
          shell.registerAccount(QStringLiteral("Analytics Matrix"), QStringLiteral("analytics-matrix@example.test"),
              QStringLiteral("Qt-U3-Test-Password-123!"));
          context->step = 410;
          return;
        }
        case 410:
          if (shell.accountBusy() || shell.contentBusy() || shell.operationBusy()) return;
          u3_record(*context, QStringLiteral("analytics-isolated-account-created"),
              shell.hasActiveAccount() && shell.accountName() == QStringLiteral("Analytics Matrix"));
          if (!shell.hasActiveAccount()) { context->step = 99; return; }
          shell.selectPage(QStringLiteral("分析"));
          context->step++;
          return;
        case 411: {
          if (shell.operationBusy() || shell.analysisSnapshot().isEmpty()) return;
          auto* rate = u3_find_item(view.rootObject(), QStringLiteral("analyticsValue-近 7 天复测通过率"));
          u3_record(*context, QStringLiteral("analytics-empty-ledgers-show-zero-and-insufficient-sample"),
              shell.analysisSnapshot().value("verifiedPasses").toInt() == 0 && rate &&
              rate->property("text").toString() == QStringLiteral("样本不足"));
          u3_screenshot(*context, view, QStringLiteral("u3-analysis-empty"));
          const auto root = shell.nativeDataRoot() / "accounts" / shell.activeAccountId().toStdWString();
          codeweave::learning::MasteryStore mastery(root);
          using namespace codeweave::learning;
          const auto today = QDate::currentDate();
          bool seeded = true;
          const MasteryEvidenceKind kinds[]{MasteryEvidenceKind::Lesson, MasteryEvidenceKind::Lesson,
              MasteryEvidenceKind::Lesson, MasteryEvidenceKind::Lesson, MasteryEvidenceKind::Lesson,
              MasteryEvidenceKind::Review, MasteryEvidenceKind::Review, MasteryEvidenceKind::Review,
              MasteryEvidenceKind::Challenge, MasteryEvidenceKind::Challenge, MasteryEvidenceKind::Bugfix};
          const char* refs[]{"unit-a", "unit-a", "unit-b", "old-unit", "future-unit",
              "review-a", "review-b", "review-c", "challenge-a", "old-challenge", "unrelated"};
          const int days[]{-6, 0, 0, -7, 1, -6, 0, 0, 0, -7, 0};
          for (int index = 0; index < 11; ++index) {
            const auto suffix = QString::number(index, 16).rightJustified(6, '0').toStdString();
            const MasteryEvidence record{"matrix-analysis-" + suffix, kinds[index], refs[index],
                "isolated analytics fixture", QDateTime(today.addDays(days[index]), QTime(0, 0)).toUTC()
                    .toString(Qt::ISODateWithMs).toStdString(), index != 6 && index != 7,
                CompletionVerification::SelfDeclared, RanBy::Learner, false, "L1", "op-matrixanalysis-" + suffix};
            bool duplicate = false;
            seeded = mastery.append_idempotent(record, duplicate).ok && !duplicate && seeded;
          }
          EvidenceStore evidence(root);
          for (int index = 0; index < 2; ++index) {
            EvidenceRecord record{"matrix-practice-" + std::to_string(index), "not-completed", "exercise",
                today.toString(Qt::ISODate).toStdString(), "ok", "ok", RanBy::Learner, false, "L1", {}, {},
                EvidenceState::Pending, "op-matrixpractice-00000" + std::to_string(index)};
            bool duplicate = false;
            seeded = evidence.append_idempotent(record, duplicate).ok && !duplicate && seeded;
          }
          QVariantList records;
          const QVariantMap submission{{"id", "submission-0123456789abcdef0123456789abcdef"},
              {"challengeId", "challenge-b"}, {"submittedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
              {"status", "passed"}, {"tier", "teaching"}, {"judgeMode", "exact-lines"},
              {"evidence", "Isolated matrix pass"}, {"code", "print(15)"},
              {"expected", QVariantList{QStringLiteral("15")}}, {"output", QVariantList{QStringLiteral("15")}},
              {"observation", ""}, {"reviewedAt", ""}};
          seeded = ChallengeSubmissionStore(QString::fromStdWString(root.wstring())).append(submission, records).ok && seeded;
          u3_record(*context, QStringLiteral("analytics-window-fixture-created"), seeded);
          shell.refreshReviewSummary();
          context->step++;
          return;
        }
        case 412: {
          if (shell.operationBusy()) return;
          const auto snapshot = shell.analysisSnapshot();
          bool values_match = true;
          for (const auto& pair : {std::pair{QStringLiteral("完成课程单元"), QStringLiteral("2")},
              std::pair{QStringLiteral("课程练习次数"), QStringLiteral("2")},
              std::pair{QStringLiteral("挑战通过记录"), QStringLiteral("2")},
              std::pair{QStringLiteral("复测通过"), QStringLiteral("1")},
              std::pair{QStringLiteral("复测未通过"), QStringLiteral("2")},
              std::pair{QStringLiteral("近 7 天复测通过率"), QStringLiteral("33%")}}) {
            auto* value = u3_find_item(view.rootObject(), QStringLiteral("analyticsValue-") + pair.first);
            const auto actual = value ? value->property("text").toString() : QStringLiteral("<missing>");
            u3_record(*context, QStringLiteral("analytics-visible-") + pair.first, actual == pair.second,
                QStringLiteral("actual=%1 expected=%2").arg(actual, pair.second));
            values_match = values_match && actual == pair.second;
          }
          auto* page = u3_find_item(view.rootObject(), QStringLiteral("analyticsPageRoot"));
          u3_record(*context, QStringLiteral("analytics-window-dates-from-facade"), page &&
              page->property("todayKey") == snapshot.value("todayKey") &&
              page->property("weekStartKey") == snapshot.value("periodStartKey") &&
              snapshot.value("periodStartKey") == QDate::currentDate().addDays(-6).toString(Qt::ISODate));
          u3_record(*context, QStringLiteral("analytics-values-screenshot"), values_match &&
              u3_screenshot(*context, view, QStringLiteral("u3-analysis-values")));
          auto* scroll = u3_find_item(view.rootObject(), QStringLiteral("analyticsScrollView"));
          auto* flickable = scroll ? scroll->property("contentItem").value<QObject*>() : nullptr;
          if (flickable) flickable->setProperty("contentY", std::max(0.0,
              scroll->property("contentHeight").toReal() - scroll->property("availableHeight").toReal()));
          context->step++;
          return;
        }
        case 413:
          u3_screenshot(*context, view, QStringLiteral("u3-analysis-review-rate"));
          context->step = 419;
          return;
        case 419: {
          if (shell.operationBusy()) return;
          codeweave::learning::MasteryStore mastery(shell.nativeDataRoot() / "accounts" / shell.activeAccountId().toStdWString());
          const codeweave::learning::MasteryEvidence record{"matrix-checkin-review", codeweave::learning::MasteryEvidenceKind::Lesson,
              "python-loop-sum", "isolated eligible review schedule", QDateTime(QDate::currentDate().addDays(-2), QTime(12, 0))
                  .toUTC().toString(Qt::ISODateWithMs).toStdString(),
              true, codeweave::learning::CompletionVerification::SelfDeclared, codeweave::learning::RanBy::Learner,
              true, "L1", "op-checkinreview-0123ab"};
          bool duplicate = false;
          u3_record(*context, QStringLiteral("sidebar-review-eligible-fixture"), mastery.append_idempotent(record, duplicate).ok && !duplicate);
          shell.refreshReviewSummary();
          context->step++;
          return;
        }
        case 420: {
          if (shell.checkinSummary().value("busy").toBool() || shell.operationBusy()) return;
          auto* card = u3_find_item(view.rootObject(), QStringLiteral("sidebarCheckinCard"));
          auto* review = u3_find_item(view.rootObject(), QStringLiteral("sidebarReviewNavigation"));
          const auto due = shell.analysisSnapshot().value("reviewDueCount").toInt();
          u3_record(*context, QStringLiteral("sidebar-review-due-badge"), review && due > 0 &&
              review->property("badge").toString() == QString::number(due));
          u3_record(*context, QStringLiteral("checkin-authenticated-empty"), card &&
              shell.checkinSummary().value("ready").toBool() && shell.checkinSummary().value("totalDays").toInt() == 0 &&
              !shell.checkinSummary().value("checkedIn").toBool() && card->property("canCheckIn").toBool());
          if (card) card->forceActiveFocus(Qt::TabFocusReason);
          send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier);
          context->step++;
          return;
        }
        case 421: {
          if (shell.checkinSummary().value("busy").toBool()) return;
          auto* card = u3_find_item(view.rootObject(), QStringLiteral("sidebarCheckinCard"));
          u3_record(*context, QStringLiteral("checkin-keyboard-write-and-disable"), card &&
              shell.checkinSummary().value("checkedIn").toBool() &&
              shell.checkinSummary().value("streakDays").toInt() == 1 && !card->property("canCheckIn").toBool());
          u3_screenshot(*context, view, QStringLiteral("u3-checkin-sidebar"));
          send_editor_shortcut(view, Qt::Key_Space, Qt::NoModifier);
          auto* button = u3_find_item(view.rootObject(), QStringLiteral("checkinCalendarButton"));
          if (button) button->forceActiveFocus(Qt::TabFocusReason);
          send_editor_shortcut(view, Qt::Key_Return, Qt::NoModifier);
          context->step++;
          return;
        }
        case 422: {
          if (!view.rootObject()->property("checkinCalendarOpen").toBool()) return;
          auto* previous = u3_find_item(view.contentItem(), QStringLiteral("checkinPreviousMonth"));
          const auto today = QDate::currentDate();
          auto* cell = u3_find_item(view.contentItem(), QStringLiteral("checkinDay-") + today.toString(Qt::ISODate));
          u3_record(*context, QStringLiteral("checkin-calendar-focus-and-recorded-day"), previous && previous->hasActiveFocus() &&
              cell && cell->isVisible() && shell.checkinSummary().value("totalDays").toInt() == 1);
          send_editor_shortcut(view, Qt::Key_End, Qt::NoModifier);
          auto* next = u3_find_item(view.contentItem(), QStringLiteral("checkinNextMonth"));
          u3_record(*context, QStringLiteral("checkin-calendar-end-focus"), next && next->hasActiveFocus());
          send_editor_shortcut(view, Qt::Key_Return, Qt::NoModifier);
          context->step++;
          return;
        }
        case 423: {
          const auto next_month = QDate::currentDate().addMonths(1);
          auto* label = u3_find_item(view.contentItem(), QStringLiteral("checkinCalendarMonth"));
          u3_record(*context, QStringLiteral("checkin-calendar-next-month"), label &&
              label->property("text").toString() == QStringLiteral("%1 年 %2 月").arg(next_month.year()).arg(next_month.month()));
          u3_screenshot(*context, view, QStringLiteral("u3-checkin-calendar"));
          send_editor_shortcut(view, Qt::Key_Home, Qt::NoModifier);
          send_editor_shortcut(view, Qt::Key_Return, Qt::NoModifier);
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          context->step++;
          return;
        }
        case 424: {
          auto* button = u3_find_item(view.rootObject(), QStringLiteral("checkinCalendarButton"));
          u3_record(*context, QStringLiteral("checkin-calendar-escape-return-focus"), button && button->hasActiveFocus() &&
              !view.rootObject()->property("checkinCalendarOpen").toBool());
          send_editor_shortcut(view, Qt::Key_Return, Qt::NoModifier);
          context->step++;
          return;
        }
        case 425: {
          if (!view.rootObject()->property("checkinCalendarOpen").toBool()) return;
          const QPointF point(view.width() - 30, 150);
          QMouseEvent press(QEvent::MouseButtonPress, point, point, point, Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
          QMouseEvent release(QEvent::MouseButtonRelease, point, point, point, Qt::LeftButton, Qt::NoButton, Qt::NoModifier);
          QCoreApplication::sendEvent(&view, &press);
          QCoreApplication::sendEvent(&view, &release);
          context->step++;
          return;
        }
        case 426: {
          u3_record(*context, QStringLiteral("checkin-calendar-outside-dismiss"),
              !view.rootObject()->property("checkinCalendarOpen").toBool());
          const auto path = QDir(nativeData).filePath("accounts/" + shell.activeAccountId() + "/learning/checkin.v1.json");
          QFile file(path);
          const bool opened = file.open(QIODevice::ReadOnly);
          if (opened) context->checkin_bytes = file.readAll();
          file.close();
          const bool written = file.open(QIODevice::WriteOnly | QIODevice::Truncate) && file.write("broken-checkin") == 14;
          file.close();
          u3_record(*context, QStringLiteral("checkin-isolated-corruption-fixture"), opened && written);
          shell.refreshCheckin();
          context->step++;
          return;
        }
        case 427: {
          if (shell.checkinSummary().value("busy").toBool()) return;
          auto* error = u3_find_item(view.rootObject(), QStringLiteral("checkinErrorText"));
          auto* retry = u3_find_item(view.rootObject(), QStringLiteral("checkinRetryButton"));
          const auto path = QDir(nativeData).filePath("accounts/" + shell.activeAccountId() + "/learning/checkin.v1.json");
          QFile file(path);
          const bool retained = file.open(QIODevice::ReadOnly) && file.readAll() == "broken-checkin";
          file.close();
          u3_record(*context, QStringLiteral("checkin-corruption-visible-preserved-retry"), error && error->isVisible() &&
              error->property("text").toString().contains(QStringLiteral("禁止覆盖")) && retry && retry->isVisible() && retained &&
              !shell.checkinSummary().value("ready").toBool());
          u3_screenshot(*context, view, QStringLiteral("u3-checkin-error"));
          const bool repaired = file.open(QIODevice::WriteOnly | QIODevice::Truncate) &&
              file.write(context->checkin_bytes) == context->checkin_bytes.size();
          file.close();
          u3_record(*context, QStringLiteral("checkin-isolated-fixture-repair"), repaired);
          if (retry) QMetaObject::invokeMethod(retry, "clicked", Qt::DirectConnection);
          context->step++;
          return;
        }
        case 428: {
          if (shell.checkinSummary().value("busy").toBool()) return;
          u3_record(*context, QStringLiteral("checkin-retry-reloads-record"), shell.checkinSummary().value("ready").toBool() &&
              shell.checkinSummary().value("checkedIn").toBool() && shell.checkinSummary().value("totalDays").toInt() == 1);
          view.resize(1100, 720);
          auto* button = u3_find_item(view.rootObject(), QStringLiteral("checkinCalendarButton"));
          if (button) QMetaObject::invokeMethod(button, "clicked", Qt::DirectConnection);
          context->step++;
          return;
        }
        case 429: {
          if (!view.rootObject()->property("checkinCalendarOpen").toBool()) return;
          auto* cell = u3_find_item(view.contentItem(), QStringLiteral("checkinDay-") + QDate::currentDate().toString(Qt::ISODate));
          const auto point = cell ? cell->mapToScene(QPointF()) : QPointF(-1, -1);
          auto* total = u3_find_item(view.contentItem(), QStringLiteral("checkinCalendarTotal"));
          const auto total_point = total ? total->mapToScene(QPointF()) : QPointF(-1, -1);
          u3_record(*context, QStringLiteral("checkin-narrow-calendar-framed"), cell && point.x() >= 0 && point.y() >= 0 &&
              point.x() + cell->width() <= view.width() && point.y() + cell->height() <= view.height() &&
              total && total_point.x() >= 0 && total_point.y() >= 0 &&
              total_point.x() + total->width() <= view.width() && total_point.y() + total->height() <= view.height() &&
              u3_screenshot(*context, view, QStringLiteral("u3-checkin-narrow"), QSize(1100, 720)));
          send_editor_shortcut(view, Qt::Key_Escape, Qt::NoModifier);
          view.resize(1440, 900);
          context->step = 24;
          return;
        }
        case 24:
          shell.selectPage(QStringLiteral("账户"));
          shell.refreshVaultWriteback();
          context->step = 700;
          return;
        case 700: {
          if (shell.vaultWriteback().value("busy").toBool()) return;
          const auto vault = QDir(context->data.path()).filePath(QStringLiteral("isolated-vault"));
          const auto write = [&](const QString& relative, const QByteArray& bytes) {
            const auto path = QDir(vault).filePath(relative);
            if (!QDir().mkpath(QFileInfo(path).absolutePath())) return false;
            QFile file(path); return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size();
          };
          const bool created = write(QStringLiteral("全栈工程师学习计划/进度追踪.md"),
              QStringLiteral("# 进度追踪\n\n最近学习证据：2026-10-01\n\n| 字段 | 内容 |\n|---|---|\n| 最近正式日志 | 暂无 |\n| 当前主题 | 待开始 |\n").toUtf8()) &&
              write(QStringLiteral("全栈工程师学习计划/全栈竞赛长期冲刺总计划.md"),
              QStringLiteral("# 总计划\n\n## 0. 学习日志索引\n\n> 每日记录统一存放在学习日志\n").toUtf8());
          u3_record(*context, QStringLiteral("vault-fixture-created-outside-workspace"), created);
          shell.configureVaultRoot(vault.toStdWString());
          context->step++;
          return;
        }
        case 701: {
          if (shell.vaultWriteback().value("busy").toBool()) return;
          auto* panel = u3_find_item(view.rootObject(), QStringLiteral("vaultWritebackPanel"));
          auto* scroll = u3_find_item(view.rootObject(), QStringLiteral("accountScrollView"));
          auto* flick = scroll ? qobject_cast<QQuickItem*>(scroll->property("contentItem").value<QObject*>()) : nullptr;
          if (panel && flick) flick->setProperty("contentY", std::max(0.0,
              panel->mapToItem(flick, QPointF()).y() + flick->property("contentY").toReal() - 8));
          auto* consent = u3_find_item(view.rootObject(), QStringLiteral("vaultBindConsent"));
          auto* bind = u3_find_item(view.rootObject(), QStringLiteral("vaultBindOwner"));
          u3_record(*context, QStringLiteral("vault-binding-requires-confirmation"), consent && bind && !bind->property("enabled").toBool() &&
              !shell.vaultWriteback().value("isOwner").toBool());
          if (consent) consent->setProperty("checked", true);
          u3_record(*context, QStringLiteral("vault-bind-confirmed-action"), bind && bind->property("enabled").toBool() &&
              QMetaObject::invokeMethod(bind, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 702: {
          if (shell.vaultWriteback().value("busy").toBool()) return;
          const auto state = shell.vaultWriteback();
          auto* panel = u3_find_item(view.rootObject(), QStringLiteral("vaultWritebackPanel"));
          auto* name = u3_find_item(view.rootObject(), QStringLiteral("vaultConnectedName"));
          u3_record(*context, QStringLiteral("vault-connected-name-visible-after-binding"),
              name && name->isVisible() && name->property("text").toString() == QStringLiteral("isolated-vault"));
          auto* scroll = u3_find_item(view.rootObject(), QStringLiteral("accountScrollView"));
          auto* flick = scroll ? qobject_cast<QQuickItem*>(scroll->property("contentItem").value<QObject*>()) : nullptr;
          if (panel && flick) flick->setProperty("contentY", std::max(0.0, panel->mapToItem(flick, QPointF()).y() + flick->property("contentY").toReal() - 8));
          u3_screenshot(*context, view, QStringLiteral("u3-vault-connected-name"));
          u3_record(*context, QStringLiteral("vault-owner-progress-and-pending-evidence"), state.value("isOwner").toBool() &&
              state.value("progressReady").toBool() && state.value("pending").toList().size() == 2 && panel);
          if (panel) panel->setProperty("selectedIds", QVariantList{QStringLiteral("matrix-practice-0")});
          auto* preview = u3_find_item(view.rootObject(), QStringLiteral("vaultPreview"));
          u3_record(*context, QStringLiteral("vault-preview-selected-evidence-action"), preview && preview->property("enabled").toBool() &&
              QMetaObject::invokeMethod(preview, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 703: {
          if (shell.vaultWriteback().value("busy").toBool()) return;
          auto* commit = u3_find_item(view.rootObject(), QStringLiteral("vaultCommit"));
          auto* panel = u3_find_item(view.rootObject(), QStringLiteral("vaultWritebackPanel"));
          const auto preview = shell.vaultWriteback().value("preview").toMap();
          u3_record(*context, QStringLiteral("vault-preview-readonly-and-confirmation-disabled"),
              !preview.value("operationId").toString().isEmpty() && commit && !commit->property("enabled").toBool());
          u3_screenshot(*context, view, QStringLiteral("u3-vault-evidence-preview"));
          auto* scroll = u3_find_item(view.rootObject(), QStringLiteral("accountScrollView"));
          auto* flick = scroll ? qobject_cast<QQuickItem*>(scroll->property("contentItem").value<QObject*>()) : nullptr;
          if (commit && flick) flick->setProperty("contentY", std::max(0.0, commit->mapToItem(flick, QPointF()).y() + flick->property("contentY").toReal() - flick->height() + 60));
          if (panel) panel->setProperty("rollbackId", preview.value("operationId"));
          context->step++;
          return;
        }
        case 704: {
          u3_screenshot(*context, view, QStringLiteral("u3-vault-confirmation"));
          auto* consent = u3_find_item(view.rootObject(), QStringLiteral("vaultCommitConsent"));
          auto* commit = u3_find_item(view.rootObject(), QStringLiteral("vaultCommit"));
          if (consent) consent->setProperty("checked", true);
          u3_record(*context, QStringLiteral("vault-commit-explicit-confirmed-action"), commit && commit->property("enabled").toBool() &&
              QMetaObject::invokeMethod(commit, "clicked", Qt::DirectConnection));
          context->step++;
          return;
        }
        case 705: {
          if (shell.vaultWriteback().value("busy").toBool()) return;
          const auto state = shell.vaultWriteback();
          u3_record(*context, QStringLiteral("vault-committed-refresh-and-reload"), state.value("synced").toList().size() == 1 &&
              state.value("pending").toList().size() == 1 && !state.contains("preview") &&
              state.value("transactions").toList().size() == 1 && state.value("transactions").toList().first().toMap().value("state") == "synced");
          auto* panel = u3_find_item(view.rootObject(), QStringLiteral("vaultWritebackPanel"));
          if (panel) panel->setProperty("viewIndex", 2);
          view.resize(1100, 720);
          context->step++;
          return;
        }
        case 706: {
          auto* panel = u3_find_item(view.rootObject(), QStringLiteral("vaultWritebackPanel"));
          auto* scroll = u3_find_item(view.rootObject(), QStringLiteral("accountScrollView"));
          auto* flick = scroll ? qobject_cast<QQuickItem*>(scroll->property("contentItem").value<QObject*>()) : nullptr;
          if (panel && flick) flick->setProperty("contentY", std::max(0.0, panel->mapToItem(flick, QPointF()).y() + flick->property("contentY").toReal() - 8));
          context->step++;
          return;
        }
        case 707: {
          u3_record(*context, QStringLiteral("vault-narrow-ledger-screenshot"), u3_screenshot(*context, view,
              QStringLiteral("u3-vault-ledger-narrow"), QSize(1100, 720)));
          const auto ledger = shell.vaultWriteback().value("transactions").toList();
          if (!ledger.isEmpty()) shell.rollbackVaultWriteback(ledger.first().toMap().value("operationId").toString());
          context->step++;
          return;
        }
        case 708: {
          if (shell.vaultWriteback().value("busy").toBool()) return;
          const auto state = shell.vaultWriteback();
          u3_record(*context, QStringLiteral("vault-rollback-restores-pending-state"), state.value("synced").toList().isEmpty() &&
              state.value("pending").toList().size() == 2 && state.value("transactions").toList().first().toMap().value("state") == "rolled_back");
          u3_screenshot(*context, view, QStringLiteral("u3-vault-rolled-back"), QSize(1100, 720));
          view.resize(1440, 900);
          shell.selectPage(QStringLiteral("分析"));
          u3_screenshot(*context, view, QStringLiteral("u3-analysis"));
          context->step = 23;
          return;
        }
        case 23:
          u3_record(*context, QStringLiteral("page-analysis"), shell.currentPage() == QStringLiteral("分析"));
          u3_record(*context, QStringLiteral("page-challenge-lesson-evidence-execution-trace-and-vault-screenshots"), context->screenshots.size() == 59,
              QString::number(context->screenshots.size()));
          u3_record(*context, QStringLiteral("qml-no-warnings"), qml_warnings.isEmpty(), qml_warnings.join('\n'));
          if (!u3_write_result(*context)) { application.exit(3); return; }
          application.exit(u3_all_passed(*context) ? 0 : 3);
          context->step = 99;
          return;
        case 99:
          if (!u3_write_result(*context)) application.exit(3);
          else application.exit(3);
          return;
        default:
          return;
      }
    });
    matrix_timer.start(100);
  }
  return application.exec();
}
