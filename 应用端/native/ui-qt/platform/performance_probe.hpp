#pragma once

// Opt-in real-window diagnostic. It creates synthetic accounts only in a
// QTemporaryDir selected by ui_main, never in the user's application data.
#include "ui_shell.hpp"
#include <QGuiApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QKeyEvent>
#include <QQuickItem>
#include <QQuickView>
#include <QSaveFile>
#include <QThread>
#include <QTimer>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <mutex>
#include <vector>

inline double probe_clock() {
  return std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}

class MeasuredApplication final : public QGuiApplication {
 public:
  MeasuredApplication(int& argc, char** argv) : QGuiApplication(argc, argv) {}
  bool measuring{};
  std::vector<double> event_ms;
  bool notify(QObject* receiver, QEvent* event) override {
    if (!measuring || QThread::currentThread() != thread() || depth_ != 0)
      return QGuiApplication::notify(receiver, event);
    ++depth_;
    const double start = probe_clock();
    const bool result = QGuiApplication::notify(receiver, event);
    event_ms.push_back(probe_clock() - start);
    --depth_;
    return result;
  }
 private:
  int depth_{};
};

class WindowProbe final : public QObject {
 public:
  WindowProbe(MeasuredApplication& app, UiShell& shell, QQuickView& view,
      QString output, double entered)
      : app_(app), shell_(shell), view_(view), output_(std::move(output)), entered_(entered) {
    connect(&view_, &QQuickWindow::frameSwapped, this, [this] {
      const double now = probe_clock();
      std::lock_guard lock(mutex_);
      if (scrolling_ && last_frame_ > 0) frames_.push_back(now - last_frame_);
      last_frame_ = now;
      if (key_sent_ > 0) { edits_.push_back(now - key_sent_); key_sent_ = 0; }
    }, Qt::DirectConnection);
    connect(&timer_, &QTimer::timeout, this, [this] { tick(); });
    connect(&shell_, &UiShell::executionBusyChanged, this, [this] {
      if (stage_ == 7 && !shell_.executionBusy()) {
        cancels_.push_back(probe_clock() - cancel_started_);
        stage_ = 9;
      }
    });
    timer_.setTimerType(Qt::PreciseTimer);
    timer_.start(16);
    app_.measuring = true;
  }
 private:
  void finish(const QString& error = {}) {
    timer_.stop();
    app_.measuring = false;
    QJsonObject report{{"schemaVersion", 1}, {"error", error},
        {"startup_entry_to_ready_ms", ready_ms_},
        {"startup_scope", "process main entry to exposed window + loaded catalog + event loop tick; excludes OS loader"},
        {"frame_scope", "frameSwapped during synthetic course-list scrolling; not compositor presentation"},
        {"edit_scope", "posted key event to next frameSwapped, text mutation checked"},
        {"main_thread_scope", "outermost Qt event dispatch, includes workload callbacks; startup construction excluded"},
        {"cancel_scope", "cancel request to executionBusy false; Python infinite-loop workload after 500ms"},
        {"qt_version", QString::fromLatin1(qVersion())}};
    auto samples = [](const std::vector<double>& values) {
      QJsonArray array;
      for (const auto value : values) array.append(value);
      return array;
    };
    report.insert("main_thread_ms", samples(app_.event_ms));
    report.insert("cancel_ms", samples(cancels_));
    {
      std::lock_guard lock(mutex_);
      report.insert("frame_interval_ms", samples(frames_));
      report.insert("edit_ms", samples(edits_));
    }
    QSaveFile file(output_);
    const bool saved = file.open(QIODevice::WriteOnly) &&
        file.write(QJsonDocument(report).toJson()) > 0 && file.commit();
    app_.exit(saved && error.isEmpty() ? 0 : 4);
  }
  void tick() {
    const double now = probe_clock();
    if (now - entered_ > 45000) { finish(QStringLiteral("window workload timeout at stage %1").arg(stage_)); return; }
    switch (stage_) {
      case 0:
        if (!view_.isExposed() || shell_.contentBusy() ||
            !view_.rootObject()->findChild<QQuickItem*>(QStringLiteral("courseList"))) return;
        if (shell_.publishedTitles().isEmpty()) { finish(QStringLiteral("empty catalog")); return; }
        ready_ms_ = now - entered_;
        shell_.registerAccount(QStringLiteral("Benchmark"), QStringLiteral("benchmark@example.test"),
            QStringLiteral("Isolated-Measurement-42!"));
        stage_ = 1;
        break;
      case 1: {
        if (shell_.accountBusy() || shell_.contentBusy()) return;
        if (!shell_.hasActiveAccount()) { finish(shell_.accountStatus()); return; }
        const auto ids = shell_.publishedIds();
        int index = -1;
        for (int i = 0; i < ids.size(); ++i) if (ids[i].contains("python")) { index = i; break; }
        if (index < 0) { finish(QStringLiteral("Python fixture course missing")); return; }
        shell_.openPublishedContent(index);
        stage_ = 2;
        break;
      }
      case 2:
        if (shell_.contentBusy()) return;
        shell_.loadStarterCode();
        stage_ = 3;
        break;
      case 3:
        if (shell_.contentBusy()) return;
        if (shell_.starterLanguage() != "python") { finish(QStringLiteral("wrong workload language")); return; }
        shell_.selectPage(QStringLiteral("编辑器"));
        stage_ = 4;
        break;
      case 4: {
        auto* editor = view_.rootObject()->findChild<QQuickItem*>(QStringLiteral("codeEditor"));
        if (!editor) return;  // asynchronous page incubation
        if (!editor->isVisible() || editor->width() <= 0 || editor->height() <= 0) return;
        editor->forceActiveFocus();
        if (!editor_focused_) { editor_focused_ = true; view_.requestActivate(); return; }
        std::lock_guard lock(mutex_);
        if (key_sent_ > 0) return;
        if (edits_.size() >= 60) {
          shell_.updateDraftCode(QStringLiteral("while True:\n    pass\n"));
          stage_ = 5;
          return;
        }
        const auto before = editor->property("text").toString();
        key_sent_ = now;
        QKeyEvent press(QEvent::KeyPress, Qt::Key_X, Qt::NoModifier, QStringLiteral("x"));
        QCoreApplication::sendEvent(&view_, &press);
        QKeyEvent release(QEvent::KeyRelease, Qt::Key_X, Qt::NoModifier);
        QCoreApplication::sendEvent(&view_, &release);
        if (editor->property("text").toString() == before) {
          key_sent_ = 0;
          // Leave the lock before finish(), which serializes the samples.
          stage_ = -1;
        }
        view_.update();
        break;
      }
      case 5:
        shell_.runCode();
        if (!shell_.executionBusy()) { finish(shell_.operationStatus()); return; }
        run_started_ = now;
        stage_ = 6;
        break;
      case 6:
        if (!shell_.executionBusy()) { finish(QStringLiteral("loop exited before cancellation")); return; }
        if (now - run_started_ < 500) return;
        cancel_started_ = now;
        shell_.cancelExecution();
        stage_ = 7;
        break;
      case 7:
        return;
      case 9:
        if (cancels_.size() < 10) { stage_ = 5; return; }
        shell_.discardDraftChanges();
        shell_.selectPage(QStringLiteral("学习"));
        stage_ = 8;
        break;
      case 8: {
        auto* list = view_.rootObject()->findChild<QQuickItem*>(QStringLiteral("courseList"));
        if (!list) { finish(QStringLiteral("course list not found")); return; }
        if (++scroll_ticks_ > 220) { finish(); return; }
        const auto range = std::max(0.0, list->property("contentHeight").toDouble() - list->height());
        if (range < 1) { finish(QStringLiteral("list too short for scrolling benchmark")); return; }
        {
          std::lock_guard lock(mutex_);
          if (!scrolling_) { last_frame_ = 0; scrolling_ = true; }
        }
        // Let Qt's animation driver schedule scrolling at display cadence.
        // A 16ms OS timer and 16.67ms vsync beat against each other and would
        // incorrectly label intentional missing updates as rendering stalls.
        view_.rootObject()->setProperty("benchmarkScrolling", true);
        break;
      }
      default: finish(QStringLiteral("key input did not change editor text"));
    }
  }
  MeasuredApplication& app_;
  UiShell& shell_;
  QQuickView& view_;
  QString output_;
  QTimer timer_;
  std::mutex mutex_;
  std::vector<double> frames_, edits_, cancels_;
  double entered_, ready_ms_{}, last_frame_{}, key_sent_{}, run_started_{}, cancel_started_{};
  int stage_{}, scroll_ticks_{};
  bool scrolling_{}, editor_focused_{};
};
