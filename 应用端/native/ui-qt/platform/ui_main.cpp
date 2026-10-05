#include "ui_shell.hpp"

#include <QGuiApplication>
#include <QDir>
#include <QQmlContext>
#include <QQuickView>
#include <QCloseEvent>
#include <QTimer>
#include <QImage>
#include <QQuickStyle>

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

int main(int argc, char* argv[]) {
  QGuiApplication application(argc, argv);
  QQuickStyle::setStyle(QStringLiteral("Basic"));
  UiShell shell;
  const auto contentRoot = QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("content"));
  shell.loadPublishedContent(contentRoot);
  ShellView view(shell);
  view.setMinimumSize(QSize(960, 720));
  view.setTitle(shell.appTitle());
  view.rootContext()->setContextProperty(QStringLiteral("uiShell"), &shell);
  view.setResizeMode(QQuickView::SizeRootObjectToView);
  view.loadFromModule(QStringLiteral("CodeWeave.Ui"), QStringLiteral("Main"));
  if (view.status() == QQuickView::Error) return 1;
  view.show();
  // Read-only, real-window smoke. Never creates an account or a data root.
  const auto arguments = application.arguments();
  const auto smoke = arguments.indexOf(QStringLiteral("--smoke-screenshot"));
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
