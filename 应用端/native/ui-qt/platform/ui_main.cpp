#include "ui_shell.hpp"
#include "performance_probe.hpp"
#include "native_dialogs.hpp"

#include <QGuiApplication>
#include <QDir>
#include <QQmlContext>
#include <QQuickView>
#include <QCloseEvent>
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

bool u3_screenshot(U3MatrixContext& context, QQuickView& view, const QString& name) {
  const auto path = QDir(context.screenshot_dir).filePath(name + QStringLiteral(".png"));
  const auto image = view.grabWindow();
  const bool saved = view.isExposed() && !image.isNull() && image.save(path);
  if (saved) context.screenshots.append(path);
  return saved;
}

bool u3_write_result(const U3MatrixContext& context) {
  QJsonObject result;
  result.insert(QStringLiteral("schemaVersion"), 1);
  result.insert(QStringLiteral("mode"), QStringLiteral("qt-real-window-u3-matrix"));
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

int main(int argc, char* argv[]) {
  const double entered = probe_clock();
  MeasuredApplication application(argc, argv);
  const auto arguments = application.arguments();
  const auto benchmark = arguments.indexOf(QStringLiteral("--benchmark-json"));
  if (benchmark >= 0 && benchmark + 1 >= arguments.size()) return 2;
  const auto matrix = arguments.indexOf(QStringLiteral("--u3-matrix-json"));
  if (matrix >= 0 && matrix + 1 >= arguments.size()) return 2;
  std::unique_ptr<QTemporaryDir> benchmark_data;
  if (benchmark >= 0) benchmark_data = std::make_unique<QTemporaryDir>();
  std::unique_ptr<U3MatrixContext> matrix_context;
  if (matrix >= 0) {
    matrix_context = std::make_unique<U3MatrixContext>();
    matrix_context->output = arguments.at(matrix + 1);
    matrix_context->screenshot_dir = QFileInfo(matrix_context->output).absolutePath();
    if (!matrix_context->data.isValid() || matrix_context->screenshot_dir.isEmpty()) return 2;
    QDir().mkpath(matrix_context->screenshot_dir);
  }
  UiShell shell;
  const auto workspace = QProcessEnvironment::systemEnvironment().value(
      QStringLiteral("CODEWEAVE_NATIVE_WORKSPACE"), QCoreApplication::applicationDirPath());
  const auto localAppData = QProcessEnvironment::systemEnvironment().value(
      QStringLiteral("LOCALAPPDATA"), QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation));
  if (benchmark >= 0 && !benchmark_data->isValid()) return 2;
  const auto nativeData = benchmark >= 0 ? benchmark_data->path() :
      (matrix >= 0 ? QDir(matrix_context->data.path()).filePath(QStringLiteral("data")) :
      QDir(localAppData).filePath(QStringLiteral("CodeWeave")));
  const auto effectiveWorkspace = matrix >= 0 ? matrix_context->data.path() : workspace;
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
  view.setTitle(shell.appTitle());
  view.rootContext()->setContextProperty(QStringLiteral("uiShell"), &shell);
  view.setResizeMode(QQuickView::SizeRootObjectToView);
  view.loadFromModule(QStringLiteral("CodeWeave.Ui"), QStringLiteral("Main"));
  if (view.status() == QQuickView::Error) return 1;
  view.show();
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
          shell.selectPage(QStringLiteral("复习与进度"));
          shell.refreshReviewSummary();
          context->step = 7;
          return;
        case 7:
          if (shell.operationBusy()) return;
          u3_record(*context, QStringLiteral("review-progress"), shell.currentPage() == QStringLiteral("复习与进度"));
          u3_screenshot(*context, view, QStringLiteral("u3-review"));
          shell.selectPage(QStringLiteral("挑战"));
          context->step++;
          return;
        case 8:
          u3_record(*context, QStringLiteral("page-challenge"), shell.currentPage() == QStringLiteral("挑战"));
          u3_screenshot(*context, view, QStringLiteral("u3-challenge"));
          shell.logout();
          context->step++;
          return;
        case 9: {
          if (shell.accountBusy()) return;
          const bool logged_out = !shell.hasActiveAccount();
          shell.login(QStringLiteral("qt-u3@example.test"), QStringLiteral("Qt-U3-Test-Password-123!"));
          u3_record(*context, QStringLiteral("account-logout"), logged_out);
          context->step++;
          return;
        }
        case 10:
          if (shell.accountBusy()) return;
          u3_record(*context, QStringLiteral("account-login"), shell.hasActiveAccount());
          shell.selectPage(QStringLiteral("草稿"));
          u3_screenshot(*context, view, QStringLiteral("u3-drafts"));
          context->step++;
          return;
        case 11:
          u3_record(*context, QStringLiteral("page-drafts"), shell.currentPage() == QStringLiteral("草稿"));
          shell.selectPage(QStringLiteral("分析"));
          u3_screenshot(*context, view, QStringLiteral("u3-analysis"));
          context->step++;
          return;
        case 12:
          u3_record(*context, QStringLiteral("page-analysis"), shell.currentPage() == QStringLiteral("分析"));
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
