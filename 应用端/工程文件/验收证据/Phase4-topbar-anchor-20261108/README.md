# Phase4 顶栏锚点复核（2026-11-08）

> 本报告记录搜索边距调整前的尺寸。后续按 `ds.s2` 收敛后的当前几何、截图和复现命令见 `../Phase4-topbar-spacing-20261108/README.md`；本目录保留为前序证据。

## 结果

- [通过] 当前 Qt Release 构建和 CTest 11/11（本次 131.05 秒）；顶栏 smoke `passed`，隔离账户 `Reference`，账户菜单显示的邮箱与 facade 一致，QML 警告为空。
- [通过] Qt 与 Web 均生成 8 张真实窗口截图，主窗口 1440×900，设置窄窗 1100×720，DPR 1。Qt 对四个浮层检查窗口边界、锚点和间距。
- [通过] 跨端报告断言：Qt UI curriculum 与 Web runtime 各 61 个课程 ID 完全一致，Python 筛选后的 6 个 ID 完全一致，当前课程均为 `python-loop-sum`，账户名均为 `Reference`。Web 浏览器实际加载课程模块、读取渲染卡片，并从代码编辑器读取源码；Qt 从当前选中课程读取源码。SHA-256 同为 `62fa3f2df29a48ad64064b11903f988eb6735ae92309d9b7128fdbd00f70666f`。native `catalog.v1.tsv` 有 74 条已发布记录，不等同于 UI 课程数。
- [通过] 浏览器快捷动作、通知、账户、搜索、设置和帮助均验证 Esc 关闭与焦点归还；页面错误为空。

此前记录把 Web 的 6 门 Python 筛选结果误写成整个课程目录。当前报告证明两端 UI curriculum/runtime ID 与 Python 子集一致；Web 使用隔离 API 失败后的本地课程模块，Qt UI 从本机 `curriculum.v1.json` 加载，native `catalog.v1.tsv` 另有 74 条已发布记录，来源状态仍不同，不能据此说两个产品数据源相同。

## 差异与未关闭项

- [通过] 本次重测后搜索面板 Qt `(461, 61, 663×93)`、Web `(463.53, 59.69, 658.47×92.80)`，位置差约 2.5px、宽度差约 4.5px；四个浮层均锚定且处于视口内。
- [通过] 快捷动作 Qt `268×183`、Web `268×183.39`；账户 Qt `196×295`、Web `196×296.59`；通知两端约 `300×104`。两端菜单行高已接近，账户次级标识现在为真实邮箱；图符字形仍与网页图标不同。
- 来源状态提示文案不同：Web 明示隔离 API 断连后的旧内置课程，Qt 显示本机发布目录来源。目录 ID 相同，但本次没有证明全部课程元数据与运行行为逐字段相同。
- 设置外框同为 560px 宽；Qt 未接入的偏好继续禁用，不能为截图打开。帮助内容按原生实际能力说明，与 Web 文案布局仍不同。
- 因来源提示、设置可用性、帮助正文及图符字形仍不同，4.2 的逐区块视觉验收仍未关闭；不把锚点、几何接近、同课程和像素尺寸一致等同于视觉等价。

## 文件

- `qt/report.json`、`web/web-topbar.json`：当前运行报告，含账户、课程 ID、筛选 ID、选中课程、浮层几何和截图列表。
- `qt/*.png`、`web/*.png`：同像素尺寸截图，供人工复核。
- 跨端断言：`应用端/项目/native/ui-qt/tests/compare_topbar_reference.mjs`。

本目录报告在当前比较器加入 1100×720 `sidebarGeometry` 判据前生成；按本文历史命令复跑当前脚本会因报告缺少该字段而失败，这是输入报告 schema 过旧，不是原历史运行失败。当前比较器请使用 `../Phase4-qml-responsive-audit-20261112/post-colors-retry/report.json` 作为 Qt 报告，并结合相同 Reference Web 报告执行。

## 复现

1. 在仓库根目录执行 `cmd /c 工程文件\工具\构建当前Qt.cmd`，构建当前 Release 并运行 CTest。
2. 启动 Qt smoke 时，将进程级 `PATH`、`QT_PLUGIN_PATH`、`QML_IMPORT_PATH` 指向 `.local/qt/current/ui-qt` 与当前 Qt SDK；移除 `QT_QPA_PLATFORM`，然后执行：

   ```powershell
   & '.local/qt/current/ui-qt/CodeWeaveQtShell.exe' --qml-load-smoke 'G:/CodeWeave/应用端/工程文件/验收证据/Phase4-topbar-anchor-20261108/qt/report.json' --topbar-reference-content 'G:/CodeWeave/应用端/项目/native/content'
   ```

3. 确保 Web Vite 服务已启动于 `http://127.0.0.1:5174`，执行：

   ```powershell
   node '应用端/项目/native/ui-qt/tests/capture_topbar_reference.mjs' 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright' 'C:/Program Files/Google/Chrome/Application/chrome.exe' 'http://127.0.0.1:5174' 'G:/CodeWeave/应用端/工程文件/验收证据/Phase4-topbar-anchor-20261108/web'
   node '应用端/项目/native/ui-qt/tests/compare_topbar_reference.mjs' '应用端/工程文件/验收证据/Phase4-qml-responsive-audit-20261112/post-colors-retry/report.json' '应用端/工程文件/验收证据/Phase4-topbar-anchor-20261108/web/web-topbar.json'
   ```

- [通过] `corepack pnpm verify`：87 文件、1296 项；覆盖率语句/分支/函数/行 89.77%/82.96%/87.44%/92.79%，边界、契约、类型、Lint、构建和服务语法通过。本轮额外浏览器 smoke 只读并拦截全部 `/api/` 请求。
- [通过] `node 工程文件/工具/check-layout.mjs` 与 `git diff --check`。
- [先失败，修复后通过] 首次 Web smoke 假定进入代码模式后顶栏仍可见，超时未找到品牌按钮；改为重新加载隔离首页后完整通过。应用本身没有报错。

## 回滚

本批代码与证据尚未提交时，保留其他工作并只撤销本批文件的改动；如已提交，先确认后续工作，再对本批本地提交执行 `git revert <commit>`，随后重跑 Qt 构建/CTest、Web verify、布局检查和跨端报告断言。无数据迁移；不操作真实账户、正式资料库或 `工作区/`。
