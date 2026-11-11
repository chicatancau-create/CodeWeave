from pathlib import Path

base = Path(__file__).parent
originals = []
for label in ("before", "after"):
    path = base / label / "应用端/项目/native/ui-qt/platform/ui_main.cpp"
    source = path.read_text(encoding="utf-8")
    originals.append(source)
    source = source.replace("#include <QQmlContext>\n", "#include <QQmlContext>\n#include <QQmlEngine>\n#include <QQmlError>\n#include <QCryptographicHash>\n")
    source = source.replace("int main(int argc, char* argv[]) {", '''int main(int argc, char* argv[]) {
  for (int index = 1; index < argc; ++index) {
    if (std::string_view(argv[index]) == "--split-comparison-json")
      QGuiApplication::setHighDpiScaleFactorRoundingPolicy(Qt::HighDpiScaleFactorRoundingPolicy::Floor);
  }''', 1)
    anchor = '  const auto matrix = arguments.indexOf(QStringLiteral("--u3-matrix-json"));'
    source = source.replace(anchor, '''  const auto comparison = arguments.indexOf(QStringLiteral("--split-comparison-json"));
  if (comparison >= 0 && (comparison + 1 >= arguments.size() || benchmark >= 0)) return 2;
  const bool isolated_window = comparison >= 0 || arguments.contains(QStringLiteral("--u3-matrix-json"));
''' + anchor, 1)
    source = source.replace("  if (matrix >= 0) {\n    matrix_context", "  if (isolated_window) {\n    matrix_context", 1)
    source = source.replace("arguments.at(matrix + 1)", "arguments.at((comparison >= 0 ? comparison : matrix) + 1)", 1)
    source = source.replace("(matrix >= 0 ? QDir(matrix_context", "(isolated_window ? QDir(matrix_context", 1)
    source = source.replace("const auto effectiveWorkspace = matrix >= 0 ?", "const auto effectiveWorkspace = isolated_window ?", 1)
    source = source.replace("  view.setTitle(shell.appTitle());", '''  if (comparison >= 0) {
    view.setFlags(Qt::Window | Qt::FramelessWindowHint);
    view.setMinimumSize(QSize(1440, 900));
    view.setMaximumSize(QSize(1440, 900));
    view.resize(1440, 900);
  }
  view.setTitle(shell.appTitle());''', 1)
    source = source.replace('  view.loadFromModule(QStringLiteral("CodeWeave.Ui"), QStringLiteral("Main"));', '''  QStringList comparison_warnings;
  if (comparison >= 0) {
    QObject::connect(view.engine(), &QQmlEngine::warnings, &application,
        [&](const QList<QQmlError>& warnings) {
          for (const auto& warning : warnings) comparison_warnings.append(warning.toString());
        });
  }
  view.loadFromModule(QStringLiteral("CodeWeave.Ui"), QStringLiteral("Main"));''', 1)
    harness = r'''  QTimer comparison_timer;
  QJsonArray comparison_states;
  if (comparison >= 0) {
    QObject::connect(&comparison_timer, &QTimer::timeout, &application, [&, context = matrix_context.get()] {
      if (++context->ticks > 160) {
        u3_record(*context, QStringLiteral("comparison-timeout"), false);
        u3_write_result(*context);
        application.exit(3);
        return;
      }
      if (shell.contentBusy() || shell.operationBusy() || !view.isExposed()) return;
      if (context->step == 0) {
        const auto index = shell.publishedIds().indexOf(QStringLiteral("python-loop-sum"));
        if (index < 0) { application.exit(3); return; }
        shell.openPublishedContent(index);
        ++context->step;
        return;
      }
      if (context->step == 1) {
        if (!shell.hasSelectedContent()) return;
        shell.loadStarterCode();
        ++context->step;
        return;
      }
      const QStringList pages{QStringLiteral("学习"), QStringLiteral("复习与进度"),
          QStringLiteral("挑战"), QStringLiteral("编辑器"), QStringLiteral("草稿"),
          QStringLiteral("分析"), QStringLiteral("账户")};
      const QStringList names{QStringLiteral("learning"), QStringLiteral("review"),
          QStringLiteral("challenge"), QStringLiteral("editor"), QStringLiteral("drafts"),
          QStringLiteral("analytics"), QStringLiteral("account")};
      const auto page_index = (context->step - 2) / 4;
      if (page_index >= pages.size()) {
        u3_record(*context, QStringLiteral("qml-no-warnings"), comparison_warnings.isEmpty());
        QJsonObject result;
        result.insert(QStringLiteral("mode"), QStringLiteral("phase41-isolated-historical-comparison"));
        result.insert(QStringLiteral("isolatedData"), true);
        result.insert(QStringLiteral("platform"), QGuiApplication::platformName());
        result.insert(QStringLiteral("width"), view.width());
        result.insert(QStringLiteral("height"), view.height());
        result.insert(QStringLiteral("devicePixelRatio"), view.devicePixelRatio());
        result.insert(QStringLiteral("qmlWarnings"), QJsonArray::fromStringList(comparison_warnings));
        result.insert(QStringLiteral("checks"), context->checks);
        result.insert(QStringLiteral("states"), comparison_states);
        result.insert(QStringLiteral("screenshots"), context->screenshots);
        result.insert(QStringLiteral("passed"), u3_all_passed(*context));
        QFile output(context->output);
        if (!output.open(QIODevice::WriteOnly | QIODevice::Truncate) ||
            output.write(QJsonDocument(result).toJson(QJsonDocument::Indented)) < 0 || !output.flush()) {
          application.exit(3); return;
        }
        application.exit(u3_all_passed(*context) ? 0 : 3);
        comparison_timer.stop();
        return;
      }
      const auto phase = (context->step - 2) % 4;
      if (phase == 0) shell.selectPage(pages.at(page_index));
      if (phase == 3) {
        const auto image = view.grabWindow();
        const auto filename = names.at(page_index) + QStringLiteral(".png");
        const bool saved = image.size() == QSize(1440, 900) &&
            image.save(QDir(context->screenshot_dir).filePath(filename));
        if (saved) context->screenshots.append(filename);
        u3_record(*context, names.at(page_index), saved && shell.currentPage() == pages.at(page_index) &&
            view.size() == QSize(1440, 900) && view.devicePixelRatio() == 1 &&
            !shell.hasActiveAccount() && !shell.executionBusy());
        QJsonObject state;
        state.insert(QStringLiteral("page"), shell.currentPage());
        state.insert(QStringLiteral("filename"), filename);
        state.insert(QStringLiteral("documentId"), shell.documentId());
        state.insert(QStringLiteral("publishedIds"), QJsonArray::fromStringList(shell.publishedIds()));
        state.insert(QStringLiteral("language"), shell.starterLanguage());
        state.insert(QStringLiteral("codeSha256"), QString::fromLatin1(QCryptographicHash::hash(
            shell.draftCode().toUtf8(), QCryptographicHash::Sha256).toHex()));
        state.insert(QStringLiteral("bodySha256"), QString::fromLatin1(QCryptographicHash::hash(
            shell.selectedContentBody().toUtf8(), QCryptographicHash::Sha256).toHex()));
        state.insert(QStringLiteral("hasActiveAccount"), shell.hasActiveAccount());
        state.insert(QStringLiteral("executionOutput"), shell.executionOutput());
        state.insert(QStringLiteral("progressSummary"), shell.progressSummary());
        state.insert(QStringLiteral("reviewSummary"), shell.reviewSummary());
        state.insert(QStringLiteral("reviewItems"), QJsonArray::fromVariantList(shell.reviewItems()));
        state.insert(QStringLiteral("analysisSnapshot"), QJsonObject::fromVariantMap(shell.analysisSnapshot()));
        comparison_states.append(state);
      }
      ++context->step;
    });
    comparison_timer.start(250);
  }
'''
    source = source.replace("  // Read-only, real-window smoke.", harness + "  // Read-only, real-window smoke.", 1)
    path.write_text(source, encoding="utf-8", newline="\n")
assert originals[0] == originals[1], "historical harness originals differ"
print("Prepared identical harness patch in both temporary worktrees")
