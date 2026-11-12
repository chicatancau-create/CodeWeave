# Phase 4 设置文本边界复测（2026-11-11）

本报告中的 `QML warnings 为 0` 仅指 `QQmlEngine::warnings` 创建/加载期采集为空；不覆盖 resize 后所有动态绑定警告。2026-11-12 侧栏窄窗几何另由 `../Phase4-qml-responsive-audit-20261112/README.md` 中的真实窗口断言覆盖。

## 结果

- [通过] 正常偏好存储状态：`normal/qml-window-report.json` 标记 `diagnostic=passed`，16/16 条设置标题/说明边界断言通过，QML warnings 为 0，生成 11 张可见窗口截图。
- [通过] 偏好存储不可用状态：`unavailable/qml-window-report.json` 标记 `diagnostic=passed`、`preferenceStorageReady=false`、`preferenceStorageUnavailableSmoke=true`；16/16 条断言通过，QML warnings 为 0，生成 6 张截图。
- 两种状态均覆盖 1440×900 与 1100×720，每个视口检查 8 行设置。断言检查标题和说明的可见性、截断标记、绘制与内容尺寸，以及相对行容器的位置和边界；不可用状态还检查已接入偏好追加的“本机配置不可用”提示及相应控件状态。
- `normal/qml-window-report-first-run-missing-reference-fixture.json` 保留了首次运行报告。它在账户菜单联系方式与活动账户不匹配时退出，尚未生成设置文本记录或截图，因此不计入上述通过结果；该报告只作为失败边界证据。
- 根目录 `qml-window-report-unavailable.json` 是存储不可用复测的汇总报告；逐状态报告与截图分别位于 `normal/`、`unavailable/`。

## 复现

在仓库根目录执行标准 Release 构建与 CTest：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
```

可见窗口 smoke 使用当前 Qt 6.8.3 SDK，不设置 `QT_QPA_PLATFORM`。以下示例运行正常存储状态；将 `$report` 改为 `unavailable` 子目录下的报告路径，并在参数数组中加入 `--qml-load-smoke-preferences-unavailable`，即可运行存储不可用状态。

```powershell
$root = 'G:\CodeWeave'
$qtRoot = Join-Path $root '.local\prep\qt\6.8.3\msvc2022_64'
$env:PATH = (Join-Path $qtRoot 'bin') + ';' + (Join-Path $root '.local\qt\current\ui-qt') + ';' + $env:PATH
$env:QT_PLUGIN_PATH = Join-Path $qtRoot 'plugins'
$env:QML_IMPORT_PATH = Join-Path $qtRoot 'qml'
$report = Join-Path $root '应用端\工程文件\验收证据\Phase4-settings-text-bounds-retest-20261111\normal\qml-window-report.json'
$arguments = @('--qml-load-smoke', $report, '--topbar-reference-content', 'G:/CodeWeave/应用端/项目/native/content')
$process = Start-Process -FilePath (Join-Path $root '.local\qt\current\ui-qt\CodeWeaveQtShell.exe') `
  -ArgumentList $arguments -PassThru -Wait -NoNewWindow
if ($process.ExitCode -ne 0) { throw "Qt visible-window smoke failed: $($process.ExitCode)" }
```

正常与不可用状态的最终报告和截图已保留在本目录。首次失败报告不覆盖最终报告，也不作为通过证据。

## 验收边界

本次只关闭设置标题/说明的自动 bounds 断言缺口。没有执行像素差分、正式账户/资料库联调或 Android APK 构建；真实来源、通知、设置能力和帮助正文仍存在跨端差异，因此 Phase 4.2 整体视觉验收保持未关闭。
