# Phase 4 来源提示与设置视图复测（2026-11-08）

## 结果

- [通过] Qt Release 构建及 CTest：`cmd /c 工程文件\工具\构建当前Qt.cmd`，11/11 通过，总用时 137.79 秒。构建输出含 Qt 头文件 C4702 警告，未见项目源码编译失败。
- [通过] `node 工程文件/工具/check-layout.mjs` 与 `git diff --check` 通过。
- [先失败，修复后通过] 首轮窗口 smoke 在账户菜单 `profileAction` 首次焦点断言失败（step 16），失败报告为 `qml-window-report.json`；该断言发生在截图前，故此报告没有截图或锚点几何。使用 `Start-Process -PassThru -Wait -NoNewWindow` 重跑后通过，根因未定位，不据此断言为产品缺陷或启动方式缺陷。
- [通过] 最终真实窗口 smoke：`final/qml-window-report.json` 的 `diagnostic` 为 `passed`，QML warnings 为空；8 张截图为 1440×900，设置窄窗口为 1100×720，DPR 1。隔离账户为 `Reference`，课程数 61，Python 筛选 6 项，选中 `python-loop-sum`。
- [通过] 搜索、快捷动作、通知、账户浮层运行时锚点断言通过。最终搜索浮层为 `(469, 61, 653×93)`，锚定搜索框下沿；其它 3 个浮层也在视口内并与锚点对齐。
- [通过] 人工检查 `final/topbar-shell.png`、`final/topbar-settings.png` 与 `final/topbar-settings-small.png`：来源说明和重读按钮可读；设置标题/说明层级清晰，已显示的设置行无文字重叠或控件遮挡。窄窗口后续设置项由弹窗滚动区承载，本次截图未逐项滚动检查。

## 改动边界

- 学习页提示仍明确说明课程来自本机发布目录；按钮改为“重新读取”，忙碌时为“读取中…”，不再暗示远端同步。共享的 `contentBusy` 同时用于课程目录、正文、起始代码及部分草稿读取；`contentStatus` 也承载其它内容操作状态，因此本次没有将它们直接展示成目录同步状态。
- 设置项标题/说明调整为 16/13px，恢复默认、隐私入口、禁用数据操作按钮及字号选择器高 44px。二态开关触控/焦点目标仍为 48×28px；未接入的偏好和破坏性操作仍禁用。
- 当前窗口 smoke 使用隔离账户与本机发布课程目录，未访问正式账户、正式资料库或 `工作区/` 真实数据；未替换安装版。

## 复现

标准构建和测试：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
node 工程文件/工具/check-layout.mjs
```

可见窗口 smoke 使用 Qt 6.8.3 SDK，不设置 `QT_QPA_PLATFORM`；以下命令以 `Start-Process -Wait` 启动，报告和截图输出到 `final/`：

```powershell
$qtRoot = 'G:\CodeWeave\.local\prep\qt\6.8.3\msvc2022_64'
$env:PATH = (Join-Path $qtRoot 'bin') + ';G:\CodeWeave\.local\qt\current\ui-qt;' + $env:PATH
$env:QT_PLUGIN_PATH = Join-Path $qtRoot 'plugins'
$env:QML_IMPORT_PATH = Join-Path $qtRoot 'qml'
$report = 'G:\CodeWeave\应用端\工程文件\验收证据\Phase4-source-settings-retest-20261108\final\qml-window-report.json'
$process = Start-Process -FilePath 'G:\CodeWeave\.local\qt\current\ui-qt\CodeWeaveQtShell.exe' `
  -ArgumentList @('--qml-load-smoke', $report, '--topbar-reference-content', 'G:/CodeWeave/应用端/项目/native/content') `
  -PassThru -Wait -NoNewWindow
if ($process.ExitCode -ne 0) { throw "Qt visual smoke failed: $($process.ExitCode)" }
```

## 回滚

本批为 QML 呈现与文案调整，无数据迁移或接口变化。若后续提交需要撤回，使用该本地提交对应的 `git revert <commit>`，再运行 Qt 标准构建/CTest、窗口 smoke 和布局检查。不得用 reset/checkout 覆盖其它工作区改动。
