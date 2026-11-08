# Phase 4 帮助与图标复测（2026-11-08）

## 结果

- [通过] `cmd /c 工程文件\工具\构建当前Qt.cmd`：最终 Qt Release 增量构建完成，CTest 11/11 通过，总用时 113.50 秒。
- [通过] `node 工程文件/工具/check-layout.mjs` 与 `git diff --check` 通过。
- [先失败，修复后通过] 首次可见 smoke 报告 `Menu focus assertion failed at step 19: popup=0 target=profileAction active=<none>`，只截得账户菜单图。保留原始报告和图片：`qml-window-report-first-failure.json`、`topbar-account-first-failure.png`。通过 `Start-Process -Wait` 重新运行相同 Qt smoke 后进程退出码为 0；最终诊断 `passed`，8 张截图像素尺寸断言为 1440×900 / 1100×720，DPR 1，4 个 Popup 锚点通过，QML warnings 为空。由于重跑通过，当前没有证据表明这是产品代码缺陷；首轮焦点异常成因仍未定位。
- [通过] 人工检查了帮助、外壳、快捷动作、账户和搜索截图；Lucide 路径正确绘制，帮助章节图标/文字没有裁切或遮挡。
- [通过] 独立代码审查未发现阻断问题；`LucideIcon.qml` 根 Item 标记 `Accessible.ignored: true`，避免装饰路径在具名按钮之外重复暴露。最终窗口 smoke 再测 8 张截图、4 个锚点和 QML 警告；最终报告/图片位于 `accessibility-retest/`。该 smoke 不枚举完整辅助技术树。

## 改动与差异边界

- `qml/components/LucideIcon.qml` 使用 Qt Quick Shapes 绘制 24×24 Lucide 风格路径，不增加运行时依赖；组件保留 Lucide ISC 与 Feather 派生图标 MIT 许可声明。
- 顶栏动作/搜索、品牌图标、工作区与个人中心切换、主导航、快捷/账户菜单、帮助章节及弹窗关闭按钮改用矢量图标。未迁移的小范围图符仍保留原 glyph 兼容方式。
- 帮助章节使用与 Web 接近的图标、标题和正文层级及 14px 正文字号。Qt 文案继续描述本机真实执行事件、变量快照和外部实验边界；没有复制 Web 浏览器沙箱能力。
- 4.2 仍未整体验收：来源提示与课程状态来源、设置项可用性有真实平台差异；快捷动作锚点仍约差 2px。不得用伪造数据或能力抹平这些差异。

## 报告与复现

- `accessibility-retest/qml-window-report.json`：辅助技术标记之后的最终窗口、QML 警告、课程状态、锚点几何与截图列表。
- `accessibility-retest/topbar-*.png`：最终真实窗口截图。
- `qml-window-report-retry.json` 与根目录 `topbar-*.png`：辅助技术标记之前、同一界面的已通过复测。
- `qml-window-report-first-failure.json` 与 `topbar-account-first-failure.png`：首轮失败证据，保留追溯。

构建和 CTest：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
node 工程文件/工具/check-layout.mjs
```

可见 smoke 使用 Qt 6.8.3 SDK 环境，不设置 `QT_QPA_PLATFORM`：

```powershell
$qtRoot = 'G:\CodeWeave\.local\prep\qt\6.8.3\msvc2022_64'
$env:PATH = (Join-Path $qtRoot 'bin') + ';G:\CodeWeave\.local\qt\current\ui-qt;' + $env:PATH
$env:QT_PLUGIN_PATH = Join-Path $qtRoot 'plugins'
$env:QML_IMPORT_PATH = Join-Path $qtRoot 'qml'
$report = 'G:\CodeWeave\应用端\工程文件\验收证据\Phase4-help-icons-retest-20261108\qml-window-report-retry.json'
$process = Start-Process -FilePath 'G:\CodeWeave\.local\qt\current\ui-qt\CodeWeaveQtShell.exe' `
  -ArgumentList @('--qml-load-smoke', $report, '--topbar-reference-content', 'G:/CodeWeave/应用端/项目/native/content') `
  -PassThru -Wait -NoNewWindow
if ($process.ExitCode -ne 0) { throw "Qt visual smoke failed: $($process.ExitCode)" }
```

程序使用临时账户/配置与本机课程目录作为隔离参考，未使用正式账户、资料库或 `工作区/` 真实数据。

## 回滚

本批只有 UI 图标呈现和帮助排版变化，无接口/数据迁移。使用对应本地提交的 `git revert <commit>` 回滚，再运行 Qt 标准构建/CTest、可见 smoke 和布局检查。
