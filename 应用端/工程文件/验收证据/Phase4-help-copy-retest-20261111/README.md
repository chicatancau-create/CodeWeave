# Phase 4 帮助执行说明收敛复测（2026-11-11）

## 结果

- [通过] Web `corepack pnpm verify`：边界、契约、类型、Lint、87 个测试文件/1296 项、覆盖率、生产构建和服务语法检查通过。覆盖率为 statements 89.77%、branches 83%、functions 87.44%、lines 92.79%。
- [通过] 根目录 `cmd /c 工程文件\工具\构建当前Qt.cmd`：Qt Release 构建完成，CTest 11/11 通过，用时 96.21 秒。
- [通过] Qt 可见窗口 smoke：`diagnostic=passed`、`qmlWarnings=[]`，生成 11 张 DPR 1 截图；`topbar-help.png` 为 1440×900，人工检查文案完整可见，无裁切或重叠。
- [通过] Web 帮助组件回归断言新说明文本准确呈现。Qt 源码采用相同说明，并由可见窗口 smoke 截图验证帮助文案完整显示；Qt 本轮未增加对应自动化文案断言。
- [通过] `node 工程文件/工具/check-layout.mjs`、`node 移动端/项目/scripts/boundary-check.mjs` 和 `git diff --check`。

## 复现

Web 全量门禁：

```powershell
cd 网页端\项目
corepack pnpm verify
```

Qt Release 构建和 CTest：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
```

Qt smoke 使用 Qt 6.8.3 SDK，不设置 `QT_QPA_PLATFORM`。按 `验收证据/Phase4-settings-text-bounds-retest-20261111/README.md` 中的 PowerShell 环境配置方式设置 `PATH`、`QT_PLUGIN_PATH` 和 `QML_IMPORT_PATH`，然后执行：

```powershell
$report = 'G:\CodeWeave\应用端\工程文件\验收证据\Phase4-help-copy-retest-20261111\qml-window-report.json'
$arguments = @('--qml-load-smoke', $report, '--topbar-reference-content', 'G:/CodeWeave/应用端/项目/native/content')
$process = Start-Process -FilePath 'G:\CodeWeave\.local\qt\current\ui-qt\CodeWeaveQtShell.exe' -ArgumentList $arguments -PassThru -Wait -NoNewWindow
if ($process.ExitCode -ne 0) { throw "Qt visible-window smoke failed: $($process.ExitCode)" }
```

报告和 11 张截图保存在本目录。smoke 使用临时运行数据目录并读取仓库内的课程内容，不操作 `工作区/`。

## 验收边界

本次只收敛可视化执行说明中的不准确承诺。没有执行跨端像素差分、正式账户/资料库联调或 Android APK 构建；来源状态、通知、偏好能力及其它帮助内容仍有真实平台差异，Phase 4.2 整体视觉验收保持未关闭。
