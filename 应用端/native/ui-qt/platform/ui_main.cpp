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

int main(int argc, char* argv[]) {
  const double entered = probe_clock();
  MeasuredApplication application(argc, argv);
  const auto arguments = application.arguments();
  const auto benchmark = arguments.indexOf(QStringLiteral("--benchmark-json"));
  if (benchmark >= 0 && benchmark + 1 >= arguments.size()) return 2;
  std::unique_ptr<QTemporaryDir> benchmark_data;
  if (benchmark >= 0) benchmark_data = std::make_unique<QTemporaryDir>();
  UiShell shell;
  const auto workspace = QProcessEnvironment::systemEnvironment().value(
      QStringLiteral("CODEWEAVE_NATIVE_WORKSPACE"), QCoreApplication::applicationDirPath());
  const auto localAppData = QProcessEnvironment::systemEnvironment().value(
      QStringLiteral("LOCALAPPDATA"), QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation));
  if (benchmark >= 0 && !benchmark_data->isValid()) return 2;
  const auto nativeData = benchmark >= 0 ? benchmark_data->path() :
      QDir(localAppData).filePath(QStringLiteral("CodeWeave"));
  shell.configureAccountStorage(workspace.toStdWString(), nativeData.toStdWString());
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
  view.setMinimumSize(QSize(960, 720));
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
  return application.exec();
}
