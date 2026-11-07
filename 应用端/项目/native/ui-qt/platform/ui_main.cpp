#include "ui_shell.hpp"
#include "performance_probe.hpp"
#include "native_dialogs.hpp"

#include <QGuiApplication>
#include <QColor>
#include <QDir>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickView>
#include <QCloseEvent>
#include <QClipboard>
#include <QKeyEvent>
#include <QTimer>
#include <QImage>
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
#include <QScreen>
#include <QUrl>

#include <filesystem>
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

int main(int argc, char* argv[]) {
  for (int index = 1; index < argc; ++index) {
    if (std::string_view(argv[index]) == "--visual-comparison-json")
      QGuiApplication::setHighDpiScaleFactorRoundingPolicy(Qt::HighDpiScaleFactorRoundingPolicy::Floor);
  }
  const double entered = probe_clock();
  MeasuredApplication application(argc, argv);
  const auto arguments = application.arguments();
  const bool qml_smoke = arguments.contains(QStringLiteral("--qml-load-smoke"));
  const auto qml_smoke_arg = arguments.indexOf(QStringLiteral("--qml-load-smoke"));
  const auto benchmark = arguments.indexOf(QStringLiteral("--benchmark-json"));
  if (benchmark >= 0 && benchmark + 1 >= arguments.size()) return 2;
  const auto matrix = arguments.indexOf(QStringLiteral("--u3-matrix-json"));
  if (matrix >= 0 && matrix + 1 >= arguments.size()) return 2;
  const auto comparison = arguments.indexOf(QStringLiteral("--visual-comparison-json"));
  if (comparison >= 0 && (comparison + 1 >= arguments.size() || matrix >= 0 || benchmark >= 0)) return 2;
  if (qml_smoke && (matrix >= 0 || comparison >= 0 || benchmark >= 0)) return 2;
  if (qml_smoke && (qml_smoke_arg + 1 >= arguments.size())) return 2;
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
  shell.configureAccountStorage(effectiveWorkspace.toStdWString(), nativeData.toStdWString());
  const auto nativeDataPath = std::filesystem::path(nativeData.toStdWString());
  for (const auto language : {std::string_view("cpp"), std::string_view("java"),
                              std::string_view("python"), std::string_view("javascript")}) {
    shell.configureExecutionTool(QString::fromUtf8(language.data(),
        static_cast<int>(language.size())), configured_tool(language, nativeDataPath));
  }
  const auto contentRoot = QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("content"));
  shell.loadPublishedContent(contentRoot);
  ShellView view(shell);
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
  view.setTitle(shell.appTitle());
  view.rootContext()->setContextProperty(QStringLiteral("uiShell"), &shell);
  view.setResizeMode(QQuickView::SizeRootObjectToView);
  QStringList qml_warnings;
  if (qml_smoke || comparison >= 0) {
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
  if (qml_smoke) {
    const auto report_path = arguments.at(qml_smoke_arg + 1);
    QString diagnostic = QStringLiteral("running");
    const auto write_smoke_report = [&] {
      QJsonObject report;
      report.insert(QStringLiteral("diagnostic"), diagnostic);
      report.insert(QStringLiteral("qmlWarnings"), QJsonArray::fromStringList(qml_warnings));
      QFile report_file(report_path);
      return report_file.open(QIODevice::WriteOnly | QIODevice::Truncate) &&
          report_file.write(QJsonDocument(report).toJson(QJsonDocument::Indented)) >= 0 && report_file.flush();
    };
    QObject::connect(&qml_smoke_timer, &QTimer::timeout, &application, [&] {
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
      if (!quick || !account || !trigger || !first || !review || !help || !profile || !security || !privacy) {
        diagnostic = QStringLiteral("Menu smoke objects are missing: quick=%1 account=%2 trigger=%3 first=%4 review=%5 help=%6 profile=%7 security=%8 privacy=%9 logout=%10")
            .arg(quick != nullptr).arg(account != nullptr).arg(trigger != nullptr).arg(first != nullptr)
            .arg(review != nullptr).arg(help != nullptr).arg(profile != nullptr).arg(security != nullptr)
            .arg(privacy != nullptr);
        write_smoke_report();
        qWarning("QML smoke: menu objects missing");
        application.exit(1);
        return;
      }
      first = review;
      const auto require_focus = [&](QQuickItem* item) {
        if (item->hasActiveFocus()) return true;
        const auto* active = view.activeFocusItem();
        diagnostic = QStringLiteral("Menu focus assertion failed at step %1: popup=%2 target=%3 active=%4")
            .arg(qml_smoke_page).arg(quick->property("opened").toBool())
            .arg(QString::fromUtf8(item->objectName().toUtf8()))
            .arg(active ? QString::fromUtf8(active->objectName().toUtf8()) : QStringLiteral("<none>"));
        write_smoke_report();
        qWarning("QML smoke: incorrect menu focus");
        application.exit(1);
        return false;
      };
      switch (qml_smoke_page++ - pages.size()) {
        case 0:
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
          send_editor_shortcut(view, Qt::Key_End, Qt::NoModifier);
          break;
        case 8:
          if (!require_focus(privacy)) return;
          send_editor_shortcut(view, Qt::Key_Up, Qt::NoModifier);
          break;
        case 9:
          if (!require_focus(security)) return;
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
        default:
          if (shell.currentPage() != QStringLiteral("数据与隐私")) {
            diagnostic = QStringLiteral("Account menu did not navigate to privacy page");
            write_smoke_report();
            application.exit(1);
            return;
          }
          diagnostic = QStringLiteral("passed");
          write_smoke_report();
          application.exit(0);
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
          u3_screenshot(*context, view, QStringLiteral("u3-learning"));
          context->step++;
          return;
        case 1: {
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
          shell.registerAccount(QStringLiteral("Qt U3 Fixture"), QStringLiteral("qt-u3@example.test"),
              QStringLiteral("Qt-U3-Test-Password-123!"));
          context->step++;
          return;
        case 4:
          if (shell.accountBusy()) return;
          u3_record(*context, QStringLiteral("account-registration"), shell.hasActiveAccount());
          if (!shell.hasActiveAccount()) { context->step = 99; return; }
          shell.updateDraftCode(QStringLiteral("print(15)\n"));
          shell.saveDraft();
          context->step++;
          return;
        case 5:
          if (shell.draftSaving()) return;
          u3_record(*context, QStringLiteral("draft-save"), !shell.draftDirty());
          shell.runCode();
          context->step++;
          return;
        case 6:
          if (shell.executionBusy()) return;
          u3_record(*context, QStringLiteral("python-execution"), shell.executionOutput().contains(QStringLiteral("15")),
              shell.executionOutput());
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
          {
            const auto index = shell.publishedIds().indexOf(QStringLiteral("java-loop-sum"));
            if (index < 0) { u3_record(*context, QStringLiteral("java-execution"), false,
                QStringLiteral("缺少 java-loop-sum 内容")); context->step = 99; return; }
            shell.openPublishedContent(index);
          }
          context->step = 50;
          return;
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
          if (shell.executionBusy()) return;
          u3_record(*context, QStringLiteral("java-execution"), shell.executionOutput().contains(QStringLiteral("15")),
              shell.executionOutput());
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
          if (shell.executionBusy()) return;
          u3_record(*context, QStringLiteral("javascript-execution"), shell.executionOutput().contains(QStringLiteral("15")),
              shell.executionOutput());
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
          if (shell.executionBusy()) return;
          u3_record(*context, QStringLiteral("cpp-execution"), shell.executionOutput().contains(QStringLiteral("0: 3")),
              shell.executionOutput());
          shell.openFreeProgram(QStringLiteral("python"));
          context->step = 59;
          return;
        case 59:
          if (shell.contentBusy()) return;
          shell.updateDraftCode(QStringLiteral("import time\nfor i in range(100):\n    print(i)\n    time.sleep(0.02)\n"));
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
          shell.stepExecution();
          u3_record(*context, QStringLiteral("execution-step"), shell.executionPaused());
          shell.resumeExecution();
          context->step++;
          return;
        case 62:
          if (shell.executionPaused()) return;
          u3_record(*context, QStringLiteral("execution-resume"), shell.executionBusy());
          shell.cancelExecution();
          context->step++;
          return;
        case 63:
          if (shell.executionBusy()) return;
          u3_record(*context, QStringLiteral("execution-cancel"),
              shell.executionOutput().contains(QStringLiteral("取消")), shell.executionOutput());
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
            auto* output_area = view.rootObject()->findChild<QQuickItem*>(QStringLiteral("outputArea"));
            auto* design_system = view.rootObject()->findChild<QObject*>(QStringLiteral("designSystem"));
            const auto color = output_area ? output_area->property("color").value<QColor>() : QColor();
            const auto danger = design_system ? design_system->property("danger").value<QColor>() : QColor();
            u3_record(*context, QStringLiteral("console-error-row-style"),
                shell.executionOutputError() && danger.isValid() && color == danger);
          }
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
            }
          }
          u3_screenshot(*context, view, QStringLiteral("u3-challenge"));
          shell.discardDraftChanges();
          shell.selectPage(QStringLiteral("账户"));
          context->step++;
          return;
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
          if (shell.accountBusy()) return;
          shell.selectPage(QStringLiteral("学习"));
          shell.logout();
          const bool logged_out = !shell.hasActiveAccount();
          shell.login(QStringLiteral("qt-u3@example.test"), QStringLiteral("Qt-U3-Test-Password-123!"));
          u3_record(*context, QStringLiteral("account-logout"), logged_out);
          context->step++;
          return;
        }
        case 14:
          if (shell.accountBusy()) return;
          u3_record(*context, QStringLiteral("account-login"), shell.hasActiveAccount());
          shell.selectPage(QStringLiteral("草稿"));
          u3_screenshot(*context, view, QStringLiteral("u3-drafts"));
          context->step++;
          return;
        case 15:
          u3_record(*context, QStringLiteral("page-drafts"), shell.currentPage() == QStringLiteral("草稿"));
          shell.selectPage(QStringLiteral("分析"));
          u3_screenshot(*context, view, QStringLiteral("u3-analysis"));
          context->step++;
          return;
        case 16:
          u3_record(*context, QStringLiteral("page-analysis"), shell.currentPage() == QStringLiteral("分析"));
          u3_record(*context, QStringLiteral("ten-page-screenshots"), context->screenshots.size() == 10,
              QString::number(context->screenshots.size()));
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
