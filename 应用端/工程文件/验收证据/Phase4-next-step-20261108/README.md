# Phase4 设置逐行滚动与弹窗关闭按钮补验（2026-11-08）

本文保留的是当时比较器与报告版本；当前 `compare_topbar_reference.mjs` 还要求 Qt 报告包含 1100×720 `sidebarGeometry` 断言。复跑当前版本需使用 `../Phase4-qml-responsive-audit-20261112/post-colors-retry/report.json` 替换本文示例中的旧 Qt 报告。

## 结果

- [通过] 本批最终 `cmd /c 工程文件\工具\构建当前Qt.cmd`：Qt Release 构建成功，CTest 11/11（134.94 秒），包含关闭按钮静止/悬停状态和逐行断言。编译无新增警告；配置仍提示缺少可选 Vulkan headers。
- [通过] `node 工程文件/工具/check-layout.mjs` 与 `git diff --check` 通过。
- [先失败，修复后通过] 前轮直接执行 `ctest --test-dir .local/qt/current --output-on-failure` 时，8/11 通过，3 个 Qt 测试因生成 CTest 环境引用未挂载的 `Q:\bin` 而以 `0xc0000135` 退出。按标准构建脚本建立临时 Qt SDK 映射后，三个失败项重跑 3/3 通过；映射已卸载，没有遗留测试进程。
- [通过] 当前可见窗口 smoke 以 0 退出；`qt/qml-window-report.json` 的 `diagnostic=passed`、QML warnings 0，共 10 张截图，实际尺寸为 1440×900 / 1100×720、DPR 1。顶栏四项布局和四个 Popup 几何均被采集。
- [通过] 设置/帮助关闭按钮均检查 44×44、直角和 1px 描边；鼠标移入后使用 `ds.lineStrong`，移出恢复 `ds.line`。这是原生令牌下的状态收敛，不代表 Web/Qt 颜色逐像素相等。
- [通过] 1100×720 下逐项滚动 8 个偏好行，检查完整行及控件均在视口内、控件在行内且非零尺寸。报告新增 `settingsRows` 8 条记录，只有减弱动画、字号和行号为可用。保留首屏与底部图，补充 `qt/topbar-settings-middle-small.png`；没有为每行单独生成截图，也未把几何断言作为文案校对。
- [通过] 既有开关初始值、Space、辅助技术 toggleAction、恢复默认、字号和行号行为断言继续通过；轨道 48×28、滑块 16×16。底部导出/清除按钮完整可见且禁用。
- [通过] 本批 Web Playwright 重新生成 `web/web-topbar.json` 与 8 张图片，`passed=true`、页面错误 0。全部 `/api/` 请求拦截，未连接正式服务。历史跨端脚本确认隔离账户名/邮箱、Qt UI curriculum 与 Web runtime 各 61 个课程 ID、6 个 Python 筛选 ID、当前 `python-loop-sum` 及源码 SHA-256 一致，不证明全部元数据相同；native catalog 共 74 条已发布记录，当前比较器单独输出该行数和 UI ID 交集。
- [通过] 人工查看设置大窗及窄窗首屏/中段/底部、帮助截图；当前检查区域无行内重叠，滚动边缘外的其它行可按滚动到达。逐区块结论见下表。

## 同尺寸人工对照

| 区域 | 本批观察 | 结论 |
|---|---|---|
| 设置框与关闭按钮 | 两端 560px 宽、直角外框；关闭按钮已有方形细框及悬停反馈 | 常驻边框缺口已修复；Qt 字重、行内控件右边距和原生选择器外观仍不同 |
| 设置各行 | 8 行均可滚动完整显示，未接入项禁用且注明待接入 | 可达性通过；禁用状态是能力边界，不能伪造为 Web 已接入状态 |
| 帮助 | 章节图标、正文层级和关闭按钮已具备 | 本机执行说明必须保留；按钮形态、面板色和字重仍需外观收敛 |
| 搜索/快捷/通知/账户 | 均有同像素截图，锚点和 Esc/归焦断言通过；账户/课程对照通过 | 顶栏品牌及切换区文字宽度使当前搜索 x=469、宽=653，与 Web x=463.53、宽=658.47 仍不同；旧报告的所有尺寸差小于 1px 不再适用于当前图标/布局版本 |
| 下层页面 | Qt 是本机发布目录，Web 是隔离 API 失败后的本地回退 | 来源、进度和正文状态不同；不以它们判定浮层内容等价或修改数据事实 |

## 改动边界

- 可见窗口 smoke 记录顶栏四个主要布局项的逻辑几何，并验证设置内容确实可滚动到底。
- 本批只改 `ShellDialog` 的参考式关闭按钮，不修改共享 `IconButton`；设置新增稳定对象名只服务运行验收。
- 设置开关参照 Web `src/components/modals.css`，从勾号改为直角轨道与滑块，颜色继续使用 `ds` 令牌。键盘、辅助技术和偏好存储逻辑保持原有契约，滑块标记为装饰节点。
- 设置数据操作继续禁用；没有接入导出或批量清除功能，也未操作账户或工作区数据。
- 来源提示的重读按钮文案保持“重新读取”，并增加本机目录用途提示。
- 本机安装版未替换；未运行网页端与 Qt 的同状态逐像素比较。

## 复现

在仓库根目录执行标准 Qt 构建和 CTest：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
node 工程文件/工具/check-layout.mjs
git diff --check
```

真实窗口 smoke 需要 Qt 6.8.3 SDK。沿用 `验收证据/Phase4-source-settings-retest-20261108/README.md` 的隔离启动方式，将报告输出路径设为本目录的 `qt/qml-window-report.json`，并使用 `--qml-load-smoke` 和 `--topbar-reference-content` 参数；不要设置 offscreen 平台，以生成可见窗口截图。

Web 参考使用 `应用端/项目/native/ui-qt/tests/capture_topbar_reference.mjs`，参数为外部 Playwright 目录、Chrome 路径、Vite 地址、本目录的 `web` 绝对路径；可按 `Phase4-topbar-spacing-20261108/README.md` 的命令执行。跨端核对：

```powershell
node 应用端/项目/native/ui-qt/tests/compare_topbar_reference.mjs 应用端/工程文件/验收证据/Phase4-qml-responsive-audit-20261112/post-colors-retry/report.json 应用端/工程文件/验收证据/Phase4-next-step-20261108/web/web-topbar.json
```

## 未完成项

- 正式账户/资料库联调，以及 Web 与 Qt 同状态的完整视觉等价验收。
- Android APK 与设备运行验证。
- 顶栏文字宽度、设置原生选择器/行内对齐、帮助按钮与字体/面板色差异；本批不宣称 Phase 4.2 整体视觉验收完成。

## 现场与审查

- 独立审查发现静止态修复遗漏 hover 边框，已补实现及真实鼠标事件断言，最终构建和窗口 smoke 均通过。逐行断言只验证几何/启用状态，未扩称文案或每行截图验收。
- 当前 Web 参考最初误写旧证据目录，已将本次生成物收入本目录 `web/`，并从任务前 HEAD 逐文件恢复旧快照；旧目录无本批差异。
- 临时 Vite 服务已关闭，Qt/浏览器 smoke 自行退出；截图/报告作为交付证据保留。真实 `工作区/`、安装版、入口和远端均未修改。知识库 README/执行标准已读取，无相关 Qt 检索命中，未写错误复盘。

## 回滚

本批为开关呈现、smoke 断言、objectName 和提示调整，没有数据迁移或公共接口变化。需要撤回时先保护后续改动，再对对应本地提交执行 `git revert <commit>`，随后重跑 Qt 标准构建、CTest、窗口 smoke 和目录检查。
