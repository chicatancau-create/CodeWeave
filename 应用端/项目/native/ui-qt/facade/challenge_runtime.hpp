#pragma once

#include <QCoreApplication>
#include <QFile>
#include <QJSEngine>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QTemporaryDir>
#include <QElapsedTimer>
#include <QVariantMap>
#include <atomic>
#include <cstdio>
#include <functional>

#ifdef _WIN32
#include <windows.h>
#endif

// A separate interpreter process has no QML engine, QObject bridges or native tools.
inline int challenge_worker_main() {
#ifdef _WIN32
  const auto job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
  limits.ProcessMemoryLimit = 256ULL * 1024 * 1024;
  if (!job) return 4;
  const bool limited = SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) &&
      AssignProcessToJobObject(job, GetCurrentProcess());
  CloseHandle(job);
  if (!limited) return 4;
#endif
  QFile input;
  if (!input.open(stdin, QIODevice::ReadOnly)) return 2;
  const auto payload = input.read(524289);
  if (payload.size() > 524288) return 2;
  const auto request = QJsonDocument::fromJson(payload).object();
  const auto code = request.value(QStringLiteral("code")).toString();
  if (code.toUtf8().size() > 65536) return 2;
  QJSEngine engine;
  QJsonObject result;
  if (request.value(QStringLiteral("runner")).toString() == QStringLiteral("teaching")) {
    QFile script(QStringLiteral(":/challenge/teaching-runtime.js"));
    if (!script.open(QIODevice::ReadOnly)) return 3;
    auto simulate = engine.evaluate(QString::fromUtf8(script.readAll()));
    if (engine.hasError()) simulate = engine.catchError();
    if (!simulate.isCallable()) {
      result.insert(QStringLiteral("error"), QStringLiteral("教学运行资源无效：") + simulate.toString());
    } else {
      auto value = simulate.call({QJSValue(code), QJSValue(request.value(QStringLiteral("language")).toString()),
          engine.newObject()});
      if (engine.hasError()) value = engine.catchError();
      if (value.isError()) result.insert(QStringLiteral("error"), value.toString());
      else {
        result.insert(QStringLiteral("output"), QJsonArray::fromVariantList(value.property(QStringLiteral("output")).toVariant().toList()));
        const auto error = value.property(QStringLiteral("error"));
        if (!error.isUndefined()) result.insert(QStringLiteral("error"), error.property(QStringLiteral("message")).toString());
      }
    }
    result.insert(QStringLiteral("tier"), QStringLiteral("teaching"));
  } else if (request.value(QStringLiteral("runner")).toString() == QStringLiteral("javascript-sandbox")) {
    // Only this closure can access the captured log. Learner code gets console.log,
    // and cannot replace the getter retained by the host.
    const auto capture = engine.evaluate(QStringLiteral(R"JS((function() {
      const lines = [];
      let bytes = 0;
      const push = Array.prototype.push;
      const stringify = String;
      const write = function() {
        let line = '';
        for (let i = 0; i < arguments.length; ++i) line += (i ? ' ' : '') + stringify(arguments[i]);
        bytes += line.length;
        if (lines.length >= 100 || bytes > 8192) throw new Error('输出超过上限');
        push.call(lines, line);
      };
      return { console: { log: write, info: write, warn: write, error: write }, read: () => lines };
    })())JS"));
    const auto read = capture.property(QStringLiteral("read"));
    engine.globalObject().setProperty(QStringLiteral("console"), capture.property(QStringLiteral("console")));
    auto value = engine.evaluate(code, QStringLiteral("challenge.js"));
    if (engine.hasError()) value = engine.catchError();
    result.insert(QStringLiteral("output"), QJsonArray::fromVariantList(read.call().toVariant().toList()));
    if (value.isError()) result.insert(QStringLiteral("error"), value.toString());
    result.insert(QStringLiteral("tier"), QStringLiteral("qt-js"));
  } else return 2;
  QFile output;
  if (!output.open(stdout, QIODevice::WriteOnly)) return 3;
  const auto encoded = QJsonDocument(result).toJson(QJsonDocument::Compact);
  return output.write(encoded) == encoded.size() && output.flush() ? 0 : 3;
}

inline QVariantMap run_challenge_process(const QVariantMap& request,
    const std::function<bool()>& cancelled) {
  QTemporaryDir directory;
  if (!directory.isValid()) return {{QStringLiteral("error"), QStringLiteral("无法准备隔离运行目录")}};
  QProcess process;
  process.setProgram(QCoreApplication::applicationFilePath());
  process.setArguments({QStringLiteral("--challenge-worker")});
  process.setWorkingDirectory(directory.path());
  process.start();
  if (!process.waitForStarted(3000)) return {{QStringLiteral("error"), QStringLiteral("无法启动挑战运行器")}};
  process.write(QJsonDocument::fromVariant(request).toJson(QJsonDocument::Compact));
  process.closeWriteChannel();
  QElapsedTimer timer;
  timer.start();
  QByteArray output;
  QString error;
  while (!process.waitForFinished(20)) {
    output += process.readAllStandardOutput();
    if (cancelled()) { error = QStringLiteral("执行已取消"); break; }
    if (timer.elapsed() >= 1500) { error = QStringLiteral("执行超时，已停止运行"); break; }
    if (output.size() > 262144) { error = QStringLiteral("执行输出超过上限"); break; }
  }
  if (cancelled()) error = QStringLiteral("执行已取消");
  if (!error.isEmpty()) {
    process.kill();
    process.waitForFinished(5000);
    return {{QStringLiteral("error"), error}};
  }
  output += process.readAllStandardOutput();
  if (output.size() > 262144 || process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0)
    return {{QStringLiteral("error"), QStringLiteral("挑战运行器未正常结束")}};
  QJsonParseError parse;
  const auto document = QJsonDocument::fromJson(output, &parse);
  if (parse.error != QJsonParseError::NoError || !document.isObject())
    return {{QStringLiteral("error"), QStringLiteral("挑战运行结果无效")}};
  return document.object().toVariantMap();
}
