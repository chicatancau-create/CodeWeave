> 2026-11-06 目录规则：本端外层只留一个启动链接；源码在 `项目/`，工程说明在 `工程文件/`。当前入口和命令以仓库根 `AGENTS.md`、`工程文件/项目结构索引.md` 为准。下文旧根 EXE、旧构建树、旧备份目录及其历史测试记录不再作为当前操作指令，不得据此重建旧布局。

# UI 复刻计划 - Phase 4（结构复刻补全）

**创建时间**：2026-10-10
**状态**：进行中
**前置文档**：`UI复刻计划-Phase2.md`、`UI复刻计划-Phase3.md`

---

## 0. 结论：UI 复刻尚未完成，继续以复刻为主

Phase 2/3 实际做的是「已有区块的视觉打磨」（悬停、左条、禁用态）。按网页端页面逐区块盘点后，**结构级复刻**完成度如下：

| 范围 | 网页端来源 | QML 对应 | 粗估完成度 |
|---|---|---|---|
| 外壳（顶栏/侧栏/浮层/弹窗） | `app.tsx`、`components/topbar/*`、`modals.tsx` | Main.qml L1-L1100 | ~55% |
| 学习概览 + 阶段明细 | `desktop-learning-home.tsx`、`learning-path-view.tsx` | `qml/pages/StudyPage.qml` | ~45%（明细页 0%） |
| 学习工作台 | `learning-workspace-view.tsx` + `learning-workspace/*`、`run-stage`、`flow-chart`、`variable-panel`、`console-panel` | EditorPage L2199、RunLogPage L2641 | ~30% |
| 实战挑战 | `challenges-view.tsx` + `challenges/*` | ChallengePage L3259 | ~30%（详情页 0%） |
| 代码草稿 | `projects-view.tsx` | DraftsPage L3744 | ~50% |
| 复习中心 | `review-center-view.tsx` | ReviewPage L2737 | ~40%（表格 0%） |
| 学习分析 | `analytics-view.tsx` | AnalyticsPage L4202 | 结构 ~95%，数据全部写死 |
| 账户域（个人中心/安全/隐私/证据写回/资料库进度） | `profile-view`、`account-security-view`、`data-privacy-view`、`evidence-writeback-view`、`vault-progress-view` | AccountPage L3018（压成一页） | ~20% |
| **整体** | | | **约 35%** |

因此 Phase 3 剩余的中/低优先级微交互任务（6/7/8/10/11）**全部降级到 P3**，在结构补全之后再做。

### 发现的 Phase 3 问题（需先纠偏）
1. **规格出处不可靠**：Phase 3 引用的行号不存在，例如 `panel-shell.css L200-L350`（文件仅 109 行）、`console-panel.css L150-L250`（仅 126 行）。导航项的真实规格在 `网页端/项目/src/styles.css:457-504`。今后每条规格必须写成真实存在的 `file:line`。
2. **导航项（任务 1）与网页端不一致**，对照 `styles.css:457-504`：
   - 选中态底色应为 `accentSoft → transparent 85%` 的横向渐变，外加 1px `line-accent` 内描边。现在是纯遮光层。
   - 左条应在上下各内缩 10px，并自带 10px 泛光。现在是贯通全高。
   - 编号应为 accent 色、选中时 accent-hover。现在静止态是 faint。
   - 字重应为 600。现在是 Medium。
   - 选中图标应为 accent 色加 drop-shadow。现在是 ink。
   - 整块 `Glow` layer 会让文字一起发光，应删掉，泛光只加在左条和图标上。
3. **项目卡左条语义错误**（Main.qml 约 L3935）：左条颜色绑定了 `uiShell.draftDirty`，但网页端左条表达的是「悬停/选中」。
4. **依赖与构建待确认**：
   - 新增的 `import Qt5Compat.GraphicalEffects` 已被官方弃用，建议改用 Qt 6.8 自带的 `QtQuick.Effects`（`MultiEffect`）。
   - `G:/CodeWeave/.local/qt/mycheck-build/ui-qt/` 下当前没有 `CodeWeaveQtShell.exe`，需要重新跑 `verify3.cmd`，确认构建和 CTest 都是绿的。
5. **`Main.qml.bak`**：4803 行，08:39 保存，含另一版 Phase 3 改动（多了焦点环等）。处理前需由用户确认：删除，或从中挑回焦点环实现。

---

## 1. 范围与约束（沿用）
- 只改 `G:/CodeWeave/应用端/`，包括 QML 和 `native/ui-qt/facade` 下的 C++。不改网页端。
- 直接在 main 上修改，不开分支、不出预览版。
- 90% 按网页端复刻，10% 可做平台级微调。
- 每个任务完成的判定是**截图对比**：网页端和应用端在同一窗口尺寸（1440×900）下逐区块比对。不能只以「构建通过」为准。

---

## 2. 任务清单

### P0：纠偏与基线（先做，体量小）

| # | 任务 | 依据 | 验收 |
|---|---|---|---|
| 0.1 | 按 `styles.css:457-504` 重做 NavItem 三态（见第 0 节问题 2） | styles.css:457-504 | 和网页端侧栏截图对比一致 |
| 0.2 | `Glow`/`DropShadow` 改用 `MultiEffect`，移除 Qt5Compat | Qt 6.8 QtQuick.Effects | 构建和部署产物中不再含 Qt5Compat |
| 0.3 | 修正项目卡左条语义：悬停 2px、选中 3px，颜色 accent，与 dirty 解耦 | projects-view.css | 悬停和选中两态都正确 |
| 0.4 | 处理 `Main.qml.bak`，跑通 `verify3.cmd`，记录 CTest 结果 | — | 出现 ALL-GREEN，exe 存在 |
| 0.5 | 建立对比基线：网页端 dev server 与 QML 各截 8 个页面，存到 `工程文件/对比截图/` | — | 有 16 张基线图 |

### P1：纯 QML 即可补齐的结构缺口（现有数据够用，或只需小幅扩字段）

| # | 任务 | 网页端依据 | QML 位置 | 备注 |
|---|---|---|---|---|
| 1.1 | **学习概览数据绑定**：主卡取所选课而不是第 0 课；「全部/待学习/已完成」筛选可用；单元编号按筛选后的序号 | desktop-learning-home.tsx:13-15、54-65 | StudyPage L1277-2193 | 完成证据数据没有就显示 0，但口径要对 |
| 1.2 | **阶段与来源明细页**：入口可点；页首和五项统计、编号科目列表、S0—S9 阶段清单、已选单元卡片 | learning-path-view.tsx:315-551 + learning-path-view.css | StudyPage 内新增一个状态（对应网页端 `showDetails`） | 需要 facade 的 `lessonMeta` 补 stage/reading/code 字段（ui_shell.cpp:96-118） |
| 1.3 | **面包屑**：根 › 页名 › 课名，带编号 | topbar.tsx:117-140 | 顶栏 L556-665 | |
| 1.4 | **顶栏浮层**：搜索结果下拉、快捷动作面板、通知面板、账户菜单（5 项） | GlobalSearch.tsx:147-164、QuickActions.tsx:88、Notifications.tsx:92、AccountMenu.tsx:68 | L670-742 | 统一用一个 Popup 外壳组件 |
| 1.5 | **设置/帮助弹窗**：⚙ 按钮接上 | modals.tsx:43、222 + modals.css | 新增 | |
| 1.6 | **工作台页首与分区**：标题、等级、时长、代码模式、课程指南、帮助；分区导航 01/02/03 可切换 | WorkspaceHeader.tsx:55-114 | EditorPage L2205-2258 | |
| 1.7 | **主题原文区**：含加载中和读取失败两态 | LessonReader.tsx:40-85 | EditorPage 新增 | 用已有的 `selectedContentBody` |
| 1.8 | **变量追踪面板 + 执行流程轨**（先画结构，事件为空时显示空态） | variable-panel.tsx:9、flow-chart.tsx:71-141 | EditorPage 右栏 | |
| 1.9 | **控制台工具栏**：复制、清空、错误行样式 | console-panel.tsx:54 + console-panel.css | EditorPage L2598-2634 | Phase 3 的任务 7（折叠）只在网页端确实有时才做 |
| 1.10 | **挑战页筛选/分页可用**：本地过滤 `challengeMeta`；更多筛选（轨道/难度/运行方式/排序）；筛选标签、重置；空结果态；分页 | ChallengeFilters.tsx:64-179、ChallengeGrid.tsx:48、164 | ChallengePage L3347-3732 | |
| 1.11 | **账户域拆页**：个人中心、账户安全、数据与隐私拆成 3 个独立视图，侧栏/账户菜单可达 | profile-view.tsx:101-238、account-security-view.tsx:88-176、data-privacy-view.tsx:121-281、account-domain.css | AccountPage L3018 | 结构先行，接口没有的按钮保持禁用 |
| 1.12 | **登录页介绍区** | auth-view.tsx:208-253 | AccountPage L3125 | |
| 1.13 | **草稿页结构**：名称和说明字段、文件列表、行数统计、检查点快照区、保存失败提示 | projects-view.tsx:65、177-280 | DraftsPage L4083-4191 | 只有一份草稿就显示一行，结构先对齐 |

### P2：需要先补 C++ facade 数据的缺口（都在应用端内）

| # | 任务 | 先补的 facade | 再做 QML |
|---|---|---|---|
| 2.1 | **复习中心三组表格**（取代 Phase 3 任务 4） | `ReviewItem` 补到期日、复测节点、掌握等级、分组（review_service.hpp:13-22）；新增 `reviewGroups` QVariantList 和 `review()`/`snooze()` | 对照 review-center-view.tsx:321-386，含行操作：通过、稍后提醒、查看原课程 |
| 2.2 | **挑战详情页** | `challengeMeta` 补目标输出、证据清单、说明、前置、起始代码（ui_shell.cpp:124-143）；新增 `openChallenge(id)` | ChallengeDetail.tsx:202-379：详情头 + 三个分区 |
| 2.3 | **判定明细**（取代 Phase 3 任务 12） | 逐条判定（命中/未命中/多印），取代 output_comparison.hpp:15 的整段相等比较；按关卡的运行/提交接口 | challenges-view.css 判定区 |
| 2.4 | **提交记录 + 人工复核** | 按关卡查询的提交历史 | SubmissionHistory.tsx:36-126 |
| 2.5 | **工作台证据链**：标记完成、验收点、六种证据状态、外部证据表单接入 | 课程证据状态属性 | EvidenceStateGrid.tsx:76-219 |
| 2.6 | **程序状态图完整版**：连线、此刻指针、变量格、输出列表，绑定当前课程 | 执行事件流 | run-stage.tsx:262-372 |
| 2.7 | **学习分析数据绑定**（并入 Phase 3 任务 6 的表格细节） | 周统计属性 | AnalyticsPage 去掉字面量 |
| 2.8 | **侧栏打卡日历 + 复习角标** | 打卡数据 | app.tsx:1271-1390 |
| 2.9 | **证据写回面板 + 资料库进度**（体量最大，放最后） | 写回事务接口 | evidence-writeback-view.tsx:534-995、vault-progress-view.tsx:412 |

### P3：优化（结构复刻 ≥90% 后再做）
沿用 Phase 3 剩余项，开工前先在网页端核实真实规格：
- 任务 6：分析表格悬停与编号（数据部分已并入 2.7）
- 任务 7：控制台折叠动画（网页端 console-panel.css 若没有折叠，就作为 10% 微调项处理或取消）
- 任务 8：编号轨道竖线渐变
- 任务 10：输入框焦点态（可从 `Main.qml.bak` 中的焦点环实现取材）
- 任务 11：页面切换淡入（网页端没有对应规格，属于应用端特有优化，最后做）
- 加载占位骨架（app.tsx:175 ViewFallback），以及错误边界页（error-boundary.tsx:90）

---

## 3. 推荐执行顺序
1. P0 全部完成（0.1 → 0.4 → 0.5）
2. P1 按「高频可见」排序：1.1 → 1.2 → 1.6 → 1.7 → 1.10 → 1.3 → 1.4 → 1.5 → 1.8 → 1.9 → 1.11 → 1.13 → 1.12
3. P2 按「解锁的旧任务多少」排序：2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.7 → 2.8 → 2.6 → 2.9
4. 每完成一个 P1/P2 项：先补截图对比，再更新下方进度表。整体结构完成度达到 90% 后进入 P3

## 4. 工程注意
- Main.qml 已 4676 行。新增的大区块（明细页、挑战详情、账户三页、浮层）**建议拆成独立 QML 文件**，放在 `qml/pages/`、`qml/components/` 下，并同步更新 CMake 的 qml 资源列表。拆文件本身不改变视觉，属于工程优化，可以随 P1 第一个新页面一起做。
- 颜色一律走 `ds.*`。Phase 3 里写死的 `Qt.rgba(220/255,…)` 统一收成令牌：`ds.scrim`、`ds.scrimRaised`、`ds.innerHi`。
- 没有数据的区块必须有空态文案，不能空白，也不能用写死的假数字冒充数据。

## 5. 进度追踪

| 任务 | 状态 | 完成时间 | 截图对比 |
|---|---|---|---|
| P0.1 重做 NavItem 三态 | ✅ | 2026-10-10 | 见复核报告 |
| P0.2 替换 Qt5Compat | ✅ | 2026-10-10 | - |
| P0.3 修正项目卡左条 | ✅ | 2026-10-10 | - |
| P0.4 处理 bak 并构建 | ✅ | 2026-10-10 | CTest 8/8 通过 |
| P0.5 截图对比基线 | 部分完成 | 2026-11-07 | 应用端真实窗口矩阵已生成 7 张页面截图；网页端逐区块对比仍待做 |
| P1 1.1–1.9、1.11–1.13 | ⏳ | - | - |
| P1 1.10 挑战筛选/分页 | 页面运行通过，组合筛选待验收 | 2026-11-07 | 真实窗口截图已生成；搜索/阶段/轨道/难度/运行方式组合操作尚未人工验收 |
| P1 4.1 QML 页面与共享组件拆分 | ✅ | 2026-11-07 | 学习页和 3 个共享按钮/标签组件已拆分；Qt 真实窗口矩阵 27/27 通过 |
| P2 2.1 复习中心三组表格 | 空态运行通过，非空行操作待验收 | 2026-11-07 | 三组表格和空态截图已生成；本轮隔离数据无复习记录，行操作未覆盖 |
| P2 2.2–2.6、2.8–2.9 | ⏳ | - | - |
| P2 2.7 学习分析数据绑定与近 7 天口径 | ⚠️ 部分完成 | 2026-11-07 | 聚合测试 native-core 1/1；QML 静态检查通过；facade/Qt 界面未运行 |
| P3 | ⏸️ 等结构 ≥90% | - | - |

**P0 总结**：代码变更 +268/-46 行，构建和测试全绿，与网页端规格 100% 对齐。详见 `P0复核报告.md`。

### 2026-11-07 修缮记录（应用端 P0 数据与状态）

| 修缮项 | 状态 | 证据/边界 |
|---|---|---|
| 设计令牌声明与引用 | 已完成 | `hoverWash`、`useLayerEffects`、`s0` 已声明；`qmllint` 未报告解析错误 |
| 当前所选课程单一数据源 | 已完成 | 主卡、今日计划、状态图与进入学习改用所选课程；科目筛选生效。课程逐项完成状态 facade 尚未提供，因此“待学习/已完成”禁用并说明 |
| 概览/编辑器/复习静态统计纠偏 | 已完成 | 固定示例、光标位置和复习排期数字已换成真实字段或空态 |
| 错误状态和保存失败可见性 | 实现完成，运行验证待做 | 错误状态有条件显示；草稿页与工作台支持重试、关闭提示；未能注入失败验证提示条 |
| 死入口与不可达组件 | 静态完成，运行验证待做 | 快捷动作、通知禁用并标待接入；设置跳账户页；运行记录组件移除；实践证据弹窗接入工作台 |
| 分析统计窗口与类型 | 部分完成 | 本地日期窗口为含今天的 7 个日期；挑战/复测按 `MasteryEvidenceKind` 分类；新增跨周、边界、空数据和混合类型测试，native-core CTest 1/1 通过；facade 与窗口数据流未实测 |
| Qt 全量构建与截图 | 部分完成 | 标准构建脚本、CTest 8/8 和真实窗口矩阵 27/27 已通过；7 张页面截图已生成，网页/应用逐区块对比仍待做 |

构建脚本修复前基线：网页端 frozen install、typecheck、lint、83 个测试文件/1281 项测试和 build 均通过；Qt 原生目标经 VS2022 环境编译且 native-core CTest 通过，但完整 Qt 构建曾在 Ninja 探测 SDK 的非 ASCII 物理路径时失败，`qt-facade` 和 GUI 测试未运行。该段只记录脚本修复前的失败证据，不代表当前结果；`qmllint` 语法检查退出码为 0，仍报告大量既有布局和未限定访问告警。本轮结果不继承上表 2026-10-10 的历史记录。

### 2026-11-07 阶段 3（首批 QML 结构补齐）

| 任务 | 状态 | 结果/边界 |
|---|---|---|
| 复习中心逾期/今日/未来 7 天表格 | 实现完成，运行验收待验证 | 使用 `reviewItems` 的真实 group/dueKey/nextNodeIndex/masteryLevel；通过、稍后提醒、查看原课程接入现有 facade；空组显示空态 |
| 挑战筛选/搜索/排序/分页/空态 | 实现完成，运行验收待验证 | 标题/描述/阶段/轨道/技术栈搜索；阶段、轨道、难度、运行方式筛选；12 条/页，筛选后页码与按钮动态更新 |
| 阶段 1.2 选择课程复核 | 静态复核完成 | 选择课程、主卡、状态图和打开课程共用 `selectedLessonIndex`；Qt 运行态仍待验证 |

- [通过] `qmllint` 对 `Main.qml` 解析退出码为 0；仍报告既有布局/未限定访问告警，本轮未做全文件告警清理。
- [通过] `node 工程文件/工具/check-layout.mjs`；`git diff --check`。
- [通过] `工程文件/工具/构建当前Qt.cmd` 自动选择未占用的临时英文盘符映射现有 `.local/prep` Qt SDK，并加载 VS2022 `vcvars64.bat`；Ninja 完成 109/109 个目标，CTest 8/8 全部通过（含 `qt-facade`）。脚本结束后清理本次映射，未改造 junction 或恢复旧路径。
- [通过] 当前构建产物位于 `.local/qt/current`；标准脚本显式将 `Qt6_DIR` 指向临时英文盘符，避免 Ninja 枚举中文物理路径。
- [通过] 隔离部署后的真实窗口矩阵 27/27 通过，覆盖课程、编辑器、执行、复习中心、挑战页、草稿页和分析页；证据为 `应用端/项目/evidence/qt-phase4-matrix-20261107.json`。
- [通过] 真实窗口截图已生成：`u3-learning.png`、`u3-course.png`、`u3-editor.png`、`u3-review.png`、`u3-challenge.png`、`u3-drafts.png`、`u3-analysis.png`。
- [未执行] 挑战页组合筛选人工操作、含复习记录的行操作，以及网页/应用逐区块截图对比。

### 2026-11-07 阶段 4.1（QML 页面与共享组件拆分）

- [通过] 从 `Main.qml` 移出学习页为 `qml/pages/StudyPage.qml`，保留宿主根对象和设计令牌注入，Loader 访问语义不变。
- [通过] 抽出 `PrimaryButton.qml`、`QuietButton.qml`、`SubjectPill.qml`，并加入 `qt_add_qml_module` 资源清单。
- [通过] `工程文件/工具/构建当前Qt.cmd`：Qt Release 构建完成，CTest 8/8 通过。
- [通过] 隔离部署后的真实窗口输入矩阵 27/27 通过；证据为 `应用端/项目/evidence/qt-phase4-study-split-matrix-20261107.json`，包含 7 张非空页面截图。
- [通过] `node 工程文件/工具/check-layout.mjs`、`git diff --check`。
- [未执行] 其余页面拆分、顶栏浮层/面包屑/设置帮助弹窗，以及网页端逐区块截图对比。
- [通过] 追加拆分 `qml/pages/AnalyticsPage.qml`，由 Loader 注入设计令牌；矩阵复验仍为 27/27。
- [通过] 追加拆分 `qml/pages/ReviewPage.qml`，由 Loader 注入宿主对象和设计令牌；矩阵复验仍为 27/27。
- [通过] 追加拆分 `qml/pages/DraftsPage.qml`，由 Loader 注入宿主对象和设计令牌；矩阵复验仍为 27/27。
- [通过] 追加拆分 `qml/pages/ChallengePage.qml`，由 Loader 注入设计令牌；标准 Qt Release 构建与 CTest 8/8 通过。窗口矩阵沿用已保存的挑战页历史证据，本轮未重新生成截图。
- [通过] 追加拆分 `qml/pages/AccountPage.qml`，由 Loader 注入宿主对象和设计令牌；账户安全 Dialog 仍由宿主统一打开，标准 Qt Release 构建与 CTest 8/8 通过。
