# Phase 4.2 搜索浮层尺寸复核（2026-11-08）

## 结果

- [通过] `应用端/项目/native/ui-qt/qml/Main.qml` 的 `searchBox` 使用现有 `ds.s2` 作为左右布局边距。Qt 搜索浮层为 `(463, 61, 659×93)`，Web 为 `(463.53, 59.69, 658.47×92.80)`；位置和尺寸差均小于 1 px。
- [通过] Qt Release 构建及 CTest 11/11；Qt 顶栏 smoke `diagnostic=passed`，QML 警告为空。8 张截图的实际像素为 1440×900，窄窗设置截图为 1100×720，DPR 1。
- [通过] Web Playwright 顶栏 smoke `passed=true`，浏览器错误为空；8 张截图含 1440×900 和 1100×720 设置场景。
- [通过] `compare_topbar_reference.mjs` 通过：隔离账户名、邮箱、61 个课程 ID、6 个 Python 筛选 ID、当前课程 `python-loop-sum` 与源码 SHA-256 一致。SHA-256 为 `62fa3f2df29a48ad64064b11903f988eb6735ae92309d9b7128fdbd00f70666f`。
- [保留] 搜索位置和尺寸已收敛；快捷动作位置仍约差 2 px，账户/通知面板高度差小于 2 px。来源提示、设置项可用性、帮助正文和 Qt 文本图符与 Web 图标仍有可见差异。Web 使用隔离 API 失败回退课程，Qt 使用本机发布课程；相同课程 ID 与源码不证明所有课程元数据或运行行为逐字段相同，因此 4.2 整体视觉验收仍未关闭。

## 报告与截图

- `qt/qt-topbar-spacing.json` 与 `qt/topbar-*.png`：Qt 运行报告、Popup 几何及真实窗口截图。
- `web/web-topbar.json` 与 `web/topbar-*.png`：浏览器状态、DOM 几何及截图。测试拦截所有 `/api/` 请求；没有连接正式账户或资料库。
- 两端使用测试账户 `Reference` 与课程 `python-loop-sum`；账户/课程均为隔离验收数据。

## 复现

仓库根运行 `cmd /c 工程文件\工具\构建当前Qt.cmd`。设置 Qt 运行环境后执行：

```powershell
$qt = 'G:\CodeWeave\.local\prep\qt\6.8.3\msvc2022_64'
$env:PATH = (Join-Path $qt 'bin') + ';G:\CodeWeave\.local\qt\current\ui-qt;' + $env:PATH
$env:QT_PLUGIN_PATH = Join-Path $qt 'plugins'
$env:QML_IMPORT_PATH = Join-Path $qt 'qml'
Remove-Item Env:QT_QPA_PLATFORM -ErrorAction SilentlyContinue
$exe = 'G:\CodeWeave\.local\qt\current\ui-qt\CodeWeaveQtShell.exe'
$report = 'G:\CodeWeave\应用端\工程文件\验收证据\Phase4-topbar-spacing-20261108\qt\qt-topbar-spacing.json'
$args = "--qml-load-smoke `"$report`" --topbar-reference-content `"G:/CodeWeave/应用端/项目/native/content`""
$process = Start-Process -FilePath $exe -ArgumentList $args -PassThru -Wait -NoNewWindow
if ($process.ExitCode -ne 0) { throw "Qt smoke failed: $($process.ExitCode)" }
```

使用已安装的外部 Playwright 和 Chrome 执行：

```powershell
node 'G:\CodeWeave\应用端\项目\native\ui-qt\tests\capture_topbar_reference.mjs' `
  'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright' `
  'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  'http://127.0.0.1:5174' `
  'G:\CodeWeave\应用端\工程文件\验收证据\Phase4-topbar-spacing-20261108\web'
node 'G:\CodeWeave\应用端\项目\native\ui-qt\tests\compare_topbar_reference.mjs' `
  'G:\CodeWeave\应用端\工程文件\验收证据\Phase4-topbar-spacing-20261108\qt\qt-topbar-spacing.json' `
  'G:\CodeWeave\应用端\工程文件\验收证据\Phase4-topbar-spacing-20261108\web\web-topbar.json'
```

## 验证与限制

- [通过] `cmd /c 工程文件\工具\构建当前Qt.cmd`：Release 构建，CTest 11/11。
- [通过] `corepack pnpm verify`：87 个测试文件、1296 项通过；类型、Lint、覆盖率、构建和服务语法检查通过。
- [通过] `node 工程文件/工具/check-layout.mjs` 与 `git diff --check`。
- [先失败，修正运行环境后通过] 首次直接启动 Qt smoke 未带 Qt DLL 搜索路径，进程退出 `0xC0000135` 且没有报告；改用 `.local/prep` junction 下的 Qt 运行路径重跑，报告、8 张实际截图、DPR 和无 QML 警告断言均通过。首次退出不计作通过。
- [未执行] 全部课程元数据逐字段对照、逐像素差分，以及正式账户/资料库联调。其来源和功能差异不能通过更改验收数据消除。

## 回滚

间距调整仅为 `searchBox` 左右各 2 px。需要撤回时删除 `Main.qml` 中对应的两条 `Layout.*Margin` 声明，再运行 Qt Release/CTest、顶栏 smoke 和布局检查。没有数据迁移。
