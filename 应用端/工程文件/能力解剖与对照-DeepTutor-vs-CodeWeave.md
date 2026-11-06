# 能力解剖与对照：DeepTutor ↔ CodeWeave 应用端

**取证时间**：2026-10-11 15:20（本文所有数字都是这一刻自己跑的，不引用任何历史结论）
**CodeWeave 基准**：HEAD `e70b868`，工作树 6 个文件脏（4 份新文档 + Main.qml + Phase2）
**门禁实测**：`G:/CodeWeave/.local/qt/gate-1011.cmd` → `gate-1011-build`，**CTest 8/8 全绿**（native-core 3.13s、qt-facade 4.10s），日志 `G:/CodeWeave/.local/qt/gate-1011.log`
**DeepTutor 基准**：浅克隆 `6cf793b` = **v1.6.14**，位于 `G:/CodeWeave/.local/prep/ref-deeptutor`（101 MiB，仓库外，不进版本库）
**本文用途**：交给后端执行 AI 的实施依据。**不是**界面计划——界面台账沿用 `UI复刻计划-Phase4.md` 的 P0/P1/P2/P3 编号，本文只回答「P2 那九项该补成什么样、按谁的语义补」。

---

## 0. 读这份文档的三条前置约束（不可协商）

| # | 约束 | 出处 | 违反的后果 |
|---|---|---|---|
| C1 | 应用端**不得引入网络栈**。`应用端/项目/native/src/` 全量 grep `openai\|llm\|embedding\|fetch(\|http\|winhttp\|InternetOpen` = **0 命中**，这是事实基线，不是暂时状态 | 本轮实测 | 破掉「无服务器 · 无端口」的产品主张 |
| C2 | 不得引入需要常驻端口的服务（DeepTutor 自身要 3782/8001/8090 三个） | 同上 | 同上 |
| C3 | 每次性能结论必须同机同负载实测；只有原理排序时写「未证实」 | 总工程 §101 | 文档说谎 |

**借鉴分级标记**（第 3 节每一项都带）：
`[移植-无LLM]` 纯算法/纯数据模型，可直接翻译成 C++；`[借设计]` 只借概念与字段命名，实现自己写；`[禁]` 依赖 LLM 编排，碰了就违反 C1。

---

## 1. CodeWeave 应用端能力解剖

### 1.1 规模（实测）

| 层 | 路径 | 行数 | 文件 |
|---|---|---|---|
| 原生业务库 `codeweave-core` | `应用端/项目/native/src/` | 29 个 .cpp | — |
| 应用端 C++ 合计 | `应用端/项目/native/` | 11,953 | 73 |
| Qt facade | `应用端/项目/native/ui-qt/facade/` | 4 个 .cpp：385 / 242 / 480 / 142 | 4 |
| Qt 界面 | `应用端/项目/native/ui-qt/qml/Main.qml` | **4,705** | 1（未拆分） |
| 网页端（**功能规格的唯一来源，不再改动**） | `网页端/项目/src/` | 43,372 TS/TSX + 17,207 CSS | 199 |
| 内容包 | `content/` | 61 课程 / 13 挑战 / 13 阶段 / 4 语言工具 | — |
| 测试断言 | native 435（61 个测试函数）· content-delivery 11 · facade 82 | — | — |

### 1.2 后端 31 模块 × 是否被 facade 暴露

「暴露」三档：✅ QML 可达 · ◐ facade 有但 QML 不引用（死面） · ❌ facade 完全没有

| 模块 | LOC(.cpp/.hpp) | 职责 | 暴露 |
|---|---|---|---|
| app_core | 271/45 | 工作区打开/加锁、草稿原子读写 | ◐ 只在 loadAccountDraft 里 open |
| account / account_store / account_service | 88/23 · 260/34 · 116/35 | 账户记录、TSV 台账、会话与独立数据根 | ✅ |
| password_crypto | 87/15 | scrypt N=16384 r=8 p=1 dkLen=64 | ✅（间接） |
| content_contract / content_repository | 84/31 · 353/31 | 内容契约校验、只读发布内容与 exercises/starter/hints | ✅ |
| content_access | 151/40 | 资料库只读绑定 + 附件 sha256 完整性 | ❌ 0 引用 |
| learning_contract | 159/45 | 掌握度**解析**、证据记录校验、operation_id 格式 | ✅（间接） |
| evidence_store | 206/24 | 只追加证据台账，幂等 | ◐ 只经 save_external_evidence |
| progress_store | 229/35 | 只追加正式进度台账，幂等 | ❌ read_all 无 UI 消费者 |
| challenge_service | **39/41** | 执行→证据→（有条件）进度 | ◐ 藏在 runCode 内 |
| external_evidence_service | 117/23 | 外部环境证据，强制 Pending | ◐ 弹窗从未 open（见 G3） |
| progress_projection | 247/45 | markdown→掌握/阶段投影，**严格只读** | ❌ **0 引用**（分析页因此写死数据） |
| review_service | **56/44** | 证据+进度聚合计数 | ✅ 但字段太少（见 4.3） |
| manifest_dry_run / migration_dry_run / migration_staging / migration_contract | 109/56 · 67/32 · 206/33 · 93/49 | 四类「先看不改」预检与隔离暂存回滚 | ❌ 全部 0 引用（合计 63 条断言在保护没人用的功能） |
| legacy_import | 308/22 | Electron JSON → 原生台账，只读源 | ◐ action 从不发出 |
| backup_service | 336/42 | 全树备份/恢复，FNV 逐文件校验 + 时点复验 | ✅（无守卫，见 4.4） |
| backend_task_service | 198/70 | 单 worker 有界可取消队列（queue_limit=8） | ✅ |
| execution_contract / process_contract / execution_plan / process_runner / execution_service | 89/61 · 69/20 · 53/22 · 287/56 · 216/31 | 请求校验→白名单→参数构造→CreateProcess+Job Object 强杀→编译运行轨迹 | ✅ |
| trace_contract / trace_store | 18/35 · 309/44 | 有序事件流 + 原子落盘 + 分页 | ◐ **read_page/summarize 完全没暴露 → 运行记录页无数据源** |
| output_comparison | —/19 | 整段 trim 相等比较 | ✅（粒度太粗，见 P2.3） |
| **掌握度存储 / 复习调度器** | **缺失** | **原生端没有这两个模块** | — |

> **本节最重要的一行**：`MasteryLevel` 只有 `parse_mastery_level()`（解析），`MasteryRow` 来自只读 markdown 投影。**原生后端没有任何掌握度计算，也没有任何复习调度**。`ReviewItem` 的字段是 `content_id / exercise_id / latest_at / latest_result / passed / independent / hint_level / evidence_count` —— **没有到期日、没有节点下标、没有等级、没有分组**。这正是 Phase 4 P2.1 要补的东西。

### 1.3 数据层与强不变量（你最值钱的资产，改后端不许破坏）

落盘布局（全部从代码读出，非文档转述）：

| 路径 | 写入者 | 格式 |
|---|---|---|
| `<data_root>/learning/evidence.v1.log` | `evidence_store.cpp:141` | 每行 `\t` 分隔、**逐字段 hex**；11 标量 + 两个变长列表 |
| `<data_root>/learning/progress.v1.log` | `progress_store.cpp:158` | 6 个 hex 字段/行 |
| `<data_root>/execution/trace.v1.log` | `trace_store.cpp:131` | 4 个 hex 字段：sequence/kind/session/payload |
| `<data_root>/profile/accounts.v1.tsv` | `account_store.cpp:180` | 5 个 hex 字段 |
| `<data_root>/drafts/<id>.txt` | `app_core.cpp:17,170` | 原始字节 |
| `<data_root>/.native.lock` | `app_core.cpp:118` | `FILE_FLAG_DELETE_ON_CLOSE` |
| `<native_data_root>/accounts/<record.id>/` | `account_service.cpp:90` | **每账户独立数据根** |
| `<content_root>/{catalog.v1.tsv, exercises.v1.tsv, hints.v1.tsv, starter-code.v1.tsv, metadata.v1.tsv, <id>.txt, hints/<id>.txt}` | `content_repository.cpp:139…342` | hex TSV + **正文 sha256 必须等于 catalog 里的 content_hash** |

不变量（**这些是代码强制的，不是约定**）：

| 不变量 | 强制方式 | 证据 |
|---|---|---|
| 掌握度只能由「通过 + 独立 + 低提示」的证据推进 | 只有 `ChallengeService` 能写 `ProgressFact`，且要求 `passed && independent && hint_level ∉ {L3,L4}` | `challenge_service.cpp:18-36` |
| AI 代跑不得算独立 | 硬拒 | `learning_contract.cpp:138-140` |
| L3/L4 提示后不得算独立 | 硬拒 | `:142-144` |
| 外部环境证据永不推进进度 | 强制 `Pending` + `independent=false` + `unfinished_items` 非空，且不碰 ProgressStore | `external_evidence_service.cpp:105-111` |
| 投影永不改动 | `parse_progress` 只返回值，注入只读告示 | `progress_projection.cpp:163-165` |
| 写盘原子 | 写 `.tmp.<clock>.<rand>` → `FlushFileBuffers` → `MoveFileExW(REPLACE_EXISTING\|WRITE_THROUGH)`，失败删临时 | 5 处台账各自实现 |
| 幂等 | 同 `operation_id` 同载荷→duplicate 成功；同 id 不同载荷→**失败** | `evidence_store.cpp:154-159` |
| `operation_id` 格式 | `^op-[a-z0-9]{6,20}-[0-9a-f]{6}$` | `learning_contract.cpp:122` |
| 符号链接逐段拒绝 | 文件本身 + 路径每个前缀都 `symlink_status` | 各台账 |
| 记录坏一行→整档 fail-closed | `read_all` 任一行解析失败即中止 | 各台账 |
| 敏感信息不入库 | 6 条正则（私钥/pwd=/api key/bearer/cookie/DB URI）命中即拒 | `external_evidence_service.cpp:49-59` |
| 旧数据导入不 mint 进度 | 只写 `legacy-learning.json`，报告 `accounts=0` | `legacy_import.cpp:295-306` |
| 导入源只读 | 源仅以读打开，全部写进新建目标，失败删目标 | `legacy_import.cpp:183-191` |
| 备份不许覆盖 | 目标必须 `not_found`，源不得是目标的祖先 | `backup_service.cpp:170,21-62` |
| 备份时点一致 | 复制后再采集一次源，不一致→`remove_all(target)` | `:213-224` |

**已知缺陷（后端 AI 必须知道自己在改什么）**：

| # | 缺陷 | 影响 |
|---|---|---|
| L1 | 台账 append = **读整档 + 重写整档**（`evidence_store.cpp:151-167`、`progress_store.cpp:170-186`） | 每次记一条证据是 O(全台账字节)。§101 要求主线程 P95 ≤ 16.7 ms，这条在台账长大后必超；且这是**唯一一处真正的规模化性能债** |
| L2 | 证据与进度**两次写之间无跨档事务**（`challenge_service.cpp:25-36`） | 证据已提交而进度写失败 → 半状态 |
| L3 | 无 SQL、无 journal、台账无文件锁（只有进程内 mutex） | 单进程设计，多开靠 `.native.lock` |

### 1.4 facade 面

35 个 `Q_PROPERTY` · 23 个 `Q_INVOKABLE` · 25 个 signal · **14 个 `backend_tasks_.submit` 站点**。

关键结构事实：**QML 里 `Connections {` 命中 0 次** —— 25 个 signal 一个都没被界面接。全部界面刷新靠属性绑定，而属性只在回调里改，因此凡是「回调提前 return」的路径界面就不动（见 1.6 的卡死项）。

### 1.5 QML 面（Main.qml 4,705 行，7 页 + 3 个死组件）

| 页 | 行范围 | 绑定的 facade |
|---|---|---|
| 学习 StudyPage | 1139-2229 | lessonMeta, openPublishedContent, reloadPublishedContent, **publishedIds（不存在，见 G2）** |
| 挑战 ChallengePage | 3291-3773 | 只有 challengeMeta |
| 草稿 DraftsPage | 3776-4230 | draft* 全套 |
| 复习与进度 ReviewPage | 2769-3049 | progressSummary, reviewSummary, refreshReviewSummary |
| 分析 AnalyticsPage | 4231-4638 | **无 —— 本地自算，数据写死** |
| 账户 AccountPage | 3050-3288 | login/register/logout/changePassword/requestDataAction(仅 backup/restore) |
| 编辑器 EditorPage | 2231-2671 | draft*/execution* 全套，**但不调 loadStarterCode（见 G1）** |
| RunLogPage | 2673-2767 | **定义后实例化 0 次** |
| passwordDialog / evidenceDialog | 4640-4703 | **`.open()` 调用 0 次** |

### 1.6 四个「整条功能不通」的断点（全绿门禁下看不见）

| ID | 断点 | 证据（本轮我亲自复核过） | 后果 |
|---|---|---|---|
| **G1** | `loadStarterCode()` 在 Main.qml 里 **0 次调用**；`starter_language_` 只在 `ui_shell.cpp:337`（该任务的回调里）赋值 | `grep -c loadStarterCode Main.qml` = 0 | 交互路径永远拿不到起始代码 → `updateDraftCode` 在 `ui_shell_draft.cpp:369` 因 `starter_language_.isEmpty()` **直接 return** → 编辑器打字无反应；`saveDraft`(:191) 与 `runCode`(:296) 双双拒绝 |
| **G2** | `publishedIds()` 是 `ui_shell.hpp:60` 的**普通 C++ getter**，既无 `Q_PROPERTY` 也无 `Q_INVOKABLE` | Main.qml:1614 `uiShell.publishedIds.length`、:1869 `.indexOf(...)` | QML 取到 undefined → 点课程卡、「进入学习」按钮全部失效 |
| **G4** | `independentAttempt` 在 Main.qml **0 次引用** | `grep -c` = 0 | `independent` 恒为 false（`ui_shell_operations.cpp:319`）→ **正式进度永不落账**，复习页对真实用户恒显示 0 条 |
| **G5** | 分析页不消费任何 facade 数据，`progress_projection` 在 `ui-qt/` 里 0 引用 | Main.qml:4231-4638 本地自算 | 界面显示的是**写死的假数字**（违反 Phase 4 §4「不许用写死的假数字冒充数据」） |

**为什么 8/8 全绿还这样**：`loadStarterCode` 只在 `ui_main.cpp` 的 `--smoke-screenshot` / `--matrix` / benchmark 分支里被调（:245/:293/:334/:356/:378，全部包在 `if (smoke>=0)`/`if (matrix>=0)` 内）。**取证脚本走的是交互路径不走的那条路**，所以截图有内容、CTest 全绿、而人点不动。

### 1.7 异步链守卫现状（14 条）

| 状态 | 站点 |
|---|---|
| 有守卫且正确 | #1 reloadPublishedContent, #2 openPublishedContent, #3 loadStarterCode, #7 saveDraft, #10 loadHints, #11 saveExternalEvidence |
| **守卫 return 早于复位 busy → 标志永久卡住** | #6 loadAccountDraft(`:166`), #9 refreshReviewSummary(`:146`), #12 runCode(`:382`) |
| **完全没有守卫** | #4 authenticate, #8 performDataAction(import), #13 createBackup, #14 restoreBackup |
| 处理了 `result.cancelled` | **只有 #7 saveDraft 一处**，其余 13 处忽略 |
| 请求未打 account/generation | #4, #5(仅局部变量), #8 |

**竞态测试不存在**：`ui_shell_tests.cpp` 82 条断言里，**删掉全部 9 处守卫仍然全绿**——每次切账户都排在 `wait_for` 之后。唯一的「切换中」断言 `:172` 测的是**提交前的入口闸门**（`ui_shell_draft.cpp:59`），不是提交后的守卫。

### 1.8 关闭与取消（代码与注释互斥）

`cancel_all_pending()`（`backend_task_service.cpp:38-52`）取消 `Read \| Execute \| Backup \| Import`；`Draft \| Account \| Evidence` 不取消。
紧邻的注释（`:35`）却写「**只取消 Read**：写类任务（草稿/账户/**备份**/**导入**）…关闭时把它丢掉等于静默丢数据」——**Backup 与 Import 正是被点名为不许取消的两类，代码却取消它们**。这条矛盾从 10-06 存活至今，仍未决。

---

## 2. DeepTutor 能力解剖（v1.6.14，浅克隆实测）

### 2.1 规模与治理

| 项 | 值 |
|---|---|
| 后端 `deeptutor/` | **300,475 行 Python / 1,055 文件** |
| 前端 `web/` | 292,440 行 TS/TSX / 1,273 文件 |
| `tests/` | **191,134 行 / 803 文件 = 后端的 64%** |
| 星 / 叉 / 未关 issue | 41,112 / 5,189 / 150 |
| 建库 → 最后 push | 2025-12-28 → 2026-10-08 |
| 许可 | Apache-2.0（可闭源商用） |
| 版本 | v1.6.0→v1.6.14，16 个 release |
| 作者集中度 | 主作者 1,424 次提交 vs 第二名 116 → **bus factor ≈ 1** |
| 运行时要求 | Python 3.11+ · Node 20+ · **端口 3782/8001/8090** · 外部 LLM key · 联网 |
| 存储 | `learning/storage.py` 用 SQLite；会话有 sqlite 与 PocketBase 两套；数据在 `data/user/` |

工程化信号（值得学，与能力无关但说明它不是壳）：`.importlinter`（导入边界契约）、`.secrets.baseline`（detect-secrets）、`pre-commit`、`THIRD_PARTY_NOTICES.md`、`CITATION.cff`、`AGENTS.md`+`SKILL.md`、多套 compose。

### 2.2 子系统地图

| 子包 | 行数 | 内容 |
|---|---|---|
| services | 130,651 | session(sqlite_store 4,612 / pocketbase_store 1,753 / turns 执行器)、llm provider 适配(openai_compat 1,279 / codebuddy 851 / factory / registry)、**codex_auth 1,347**、mcp manager 1,075、skill service+hub、memory consolidator、partners、workspace 迁移 |
| api | 31,493 | **46 个 router** = 完整能力清单（auth/sessions/courses/learning_journal/mastery_path/practice/question/quiz_judge/knowledge/memory/partners/personas/plugins/notebook/book/reading/video_learning/voice/mcp/skills/subagents/task_board/unified_ws/…） |
| learning | 21,769 | **学习域内核**（见 2.3） |
| agents | 20,036 | base_agent + chat/question/research/math_animator/notebook/vision_solver/visualize + **loop**(agent_loop 1,862 · pipeline 1,953 · context_budget 347 · dsml_tool_calls 292 · prompt_blocks 325) |
| capabilities | 15,469 | 16 个能力插件 + `protocol.py`(`LoopExtension`: is_active/system_block/augment_kwargs/pre_loop_seed；`KnowledgeCapability.owned_kbs`) + `registry.py` |
| partners | 14,144 | 智能体间 bus / channels / network / 转写 |
| runtime | 11,685 | agentic 运行时、后台 leader、隔离 worker、能力目录与路由 |
| tools | 11,257 | ask_user / brainstorm / exec / file / github_query / knowledge_frontier / learning_journal / mastery_nav / cron 等工具集 |
| book / reading / knowledge | 10,679 / 7,901 / 5,386 | 教材编译引擎 / epub 双语·字幕·测验·知识捕获 / LightRAG 知识库管理 |

### 2.3 学习域内核 = **唯一值得移植的一层**（LLM 耦合实测）

| 文件 | 行数 | LLM 引用 | 判定 |
|---|---|---|---|
| `scheduler.py` | 550 | **0** | `[移植-无LLM]` **间隔重复调度器** |
| `assessment.py` | 558 | **0** | `[移植-无LLM]` |
| `objective_relations.py` | 181 | **0** | `[移植-无LLM]` 前置知识 DAG |
| `visual_practice.py` | 250 | 0 | `[借设计]` |
| `migration.py` | 324 | 0 | `[借设计]` |
| `models.py` | 623 | 1 | `[移植-无LLM]` **24 个数据类** |
| `storage.py` | 2,060 | 1 | `[借设计]` 纯持久化，几乎无 LLM |
| `mastery.py` / `identity.py` / `event_hub.py` | 40/67/140 | 0 | `[借设计]` |
| `policy.py` | 555 | 4 | `[禁]` 下一步推荐靠 LLM |
| `pending.py` / `service.py` | 283/1,996 | 4/3 | `[禁]` |
| `prompts.py` / `topic_generation.py` / `topic_naming.py` | 156/601/166 | 43/8/8 | `[禁]` 内容生成 |

**结论**：约 **2,100 行纯算法 + 2,060 行纯持久化不依赖 LLM**，可以直接照语义翻译成 C++；需要 LLM 的只有「生成内容和给建议」。

### 2.4 值得借的数据模型词汇（`learning/models.py` 实读）

| 概念 | 定义 | 对 CodeWeave 的价值 |
|---|---|---|
| `LearningStage` | `diagnostic → explain → **feynman_check** → practice → error_diagnosis → review → completed` | 你只有 `ProgressStatus` 的 `started/completed/review` 三态。**`feynman_check`（能用自己的话讲清才算过）与 `error_diagnosis` 是纯流程状态，不需要模型** |
| `ErrorType` | `structural / deviation / application / **metacognitive**` | 错题归因四分类。你现在错题只有 `latest_result` 一个字符串 |
| `KnowledgeType` | `memory / concept / procedure / design` | 冷启动先验按类型分档，调度器要用 |
| `QuizAttempt` | 含 **`voided` + `void_reason`**（坏题保留审计但不计入掌握度）、`independent`、`self_attribution`、`mastery_estimate` | **`voided` 你现在完全没有**——题目本身出错了会永久污染掌握度 |
| `LearningEvidence` | 「一次可重算保持度的持久事件」；`quality` 明确注为**从结果推断而非自评**；带 `hints_used` `attempt_count` `confidence` `response_time` `session_id` `turn_id` | 与你的 `EvidenceRecord` 同位，但多了可重算语义与 `hints_used` 计数 |
| `RepetitionState` | `interval_index` `consecutive_correct/wrong` `next_review_at` **`difficulty` `stability` `retrievability` `desired_retention`** `review_count` `lapse_count` | **这是你原生端最缺的一整块** |
| `ReviewTask` | `due_at` `priority` `state` **`forgetting_risk`** `reason` `evidence_source` `evidence_id` | 复习中心表格的行模型，直接对应 P2.1 |
| `MasteryEvent` | `path_id` `revision` `event_type` `payload` ——「已提交的路径事件，供恢复与后续实时 UI 消费」 | **事件溯源 + 可重放**，与你「只追加台账」的哲学同源 |
| `MasteryPathLease` | 路径租约 | 并发写保护（你 L3 缺的正是这个） |

### 2.5 调度算法本体（`scheduler.py` 实读）

- `class RetentionScheduler(Protocol)` + `class SpacedRepetitionScheduler` —— **可插拔保持度模型**
- 自述：「默认基线是**指数遗忘 + 按知识类型的冷启动先验**，**不是标定过的 FSRS 拟合**」——诚实标注，值得学
- 数学：`interval = max(ε, stability · −ln(desired_retention))`，`stability` 与 `interval` 互逆换算，`desired_retention` 默认 0.9
- 排序：`review_sort_key = (−forgetting_risk, −overdue, priority)`
- **`replay()`**：从证据流重算全部保持度状态
- `hydrate()`：旧 JSON 无 `stability` 时从 `interval_index` 反推，**不改到期时间**（向后兼容写法）

### 2.6 记忆三层（`services/memory/`）

`L1 trace` = 按 surface 按天的**只追加 JSONL** + ULID 主键；`L2/L3 document` = **带脚注引用的 markdown**，解析/序列化是纯函数；`ops` = add/edit/delete 批量应用器（纯函数）；`consolidator` = **LLM 驱动的 L1→L2、L2→L3**，模式有 audit/dedup/merge/update。

**可借的是 L1 这一半**：只追加 JSONL + ULID + 纯函数 ops，零 LLM。你的 `evidence.v1.log` 已经是同构物（只是 hex-TSV 而非 JSONL）。L2/L3 的蒸馏层 `[禁]`。

### 2.7 为什么 agentic 层不能碰

`agents/loop/agent_loop.py` 1,862 行 + `pipeline.py` 1,953 行是真正的 LLM 编排运行时（上下文折叠检查点、强制收束、延迟输出、能力拒绝）。它的价值 100% 来自背后有个模型在调；搬进应用端必须先给 `native/src` 加网络栈与密钥管理 → **直接违反 C1/C2，且每次交互烧额度**。

---

## 3. 能力对照图

| 能力域 | DeepTutor（证据） | CodeWeave 原生（证据） | 差距与判定 |
|---|---|---|---|
| **内容来源** | 文档/epub/YouTube·B站/教材编译（`book/` `reading/` `video_learning/` 20,986 行） | 版本化内容包 61 课 + 正文 sha256 校验（`content_repository.cpp:181`） | 路线不同，**不借**。你的内容不可变+可校验，是它的投影做不到的 |
| **知识图谱/RAG** | LlamaIndex + LightRAG（`knowledge/` 5,386 行） | 无 | `[禁]` 需模型与索引服务 |
| **掌握度模型** | 6 级？→ 实为 `MasteryTopic`+`RepetitionState`+`difficulty/stability`（models.py） | **原生无掌握度存储**；6 级只在网页端 `网页端/项目/src/data/mastery.ts:12` `MASTERY_LEVEL_NAMES`（未开始/了解/模仿完成/独立完成/能教别人/能优化扩展/稳定掌握） | **两边都要补，但先补自己的**：把 TS 语义移植进 C++（见 4.1）。`[移植-无LLM]` |
| **复习调度** | 自适应：`scheduler.py` 550 行，stability/retrievability/forgetting_risk/replay，**0 LLM** | **原生完全没有**；网页端有固定阶梯：`REVIEW_OFFSET_DAYS=[1,3,7,14,30]`、`scheduleNextReview` 按 `reviewStep` 推进（`mastery.ts:62,199-225`） | **两步走**：① 先移植你自己的 TS 阶梯（语义已被 #33 裁定冻结，且有测试可对照）② 之后才考虑换成它的保持度模型。`[移植-无LLM]` |
| **复测节点来源优先级** | 无此概念 | **有，且更严**：`effectiveReviewPlan` 三级 `unit > published > fallback`，#33 裁定「运行时唯一标准 = 资料库发布投影」，且 `null/[]` 一律按「没写」向上继承（`mastery.ts:76-99`） | **这是你的原创优势，别被它带偏**。移植时三级来源与来源标注必须原样保留 |
| **出题** | LLM 生成（`topic_generation.py` 601 行 8 处 LLM） | 13 道挑战随包发布 + `exercises.v1.tsv` 验收点 | `[禁]` 生成侧。改为「离线用外部工具产出题目写进 `content/`」，应用端仍只读 |
| **判题** | `grading.py` 64 行 + `assessment.py` 558 行（多为规则） | `output_comparison.hpp` **整段 trim 相等** | **借它的判定粒度**：逐条验收点命中/未命中/多印（对应你 Phase 4 P2.3）。`[借设计]` |
| **错题归因** | `ErrorType` 四分类 + `ErrorRecord{self_attribution, ai_confirmation, retry_history, status: active→retrying→review→graduated}` | 无。错题只有 `latest_result` 字符串 | `[移植-无LLM]` 分类与状态机是纯数据（`ai_confirmation` 字段留空位，不接模型） |
| **作废题** | `QuizAttempt.voided + void_reason`：坏题保留审计但**不计入**掌握度/错题/间隔 | 无 | **高价值、零成本、纯规则**。`[移植-无LLM]` |
| **证据语义** | `LearningEvidence` 可重算、`quality` 从结果推断非自评、`hints_used/attempt_count/response_time` | `EvidenceRecord` 11 字段 + **`ran_by` 三态 + 「AI 代跑/L3L4 提示不得算独立」的硬拒**（`learning_contract.cpp:138-144`） | **你的更硬**（它没有反作弊硬约束）。只补 `hints_used` 与「可重算」语义。`[借设计]` |
| **证据台账** | L1 只追加 JSONL + ULID | 只追加 hex-TSV + 幂等 `operation_id` + 坏行 fail-closed | 同构，**不借** |
| **事件溯源** | `MasteryEvent{path_id, revision, event_type}` + `replay()` | 无（台账是事实流，但没有 revision 与重放） | `[移植-无LLM]` 与 L2 缺陷同源，能顺手解掉「证据已提交而进度写失败」 |
| **并发写保护** | `MasteryPathLease` 租约 | 仅进程内 mutex + `.native.lock` | `[借设计]` |
| **执行/运行代码** | `exec_tool` + 沙箱靠外部 | **Job Object kill-on-close、受控白名单 4 语言、超时 100–120000 ms、输出 ≤1 MiB、暂停/继续/单步、轨迹落盘** | **你的更强且它没有单步**。不借 |
| **账户与隔离** | `multi_user/` 4,253 行 + PocketBase | scrypt 本地账户 + **每账户独立数据根** + 符号链接逐段拒绝 | 不借（它依赖服务端） |
| **备份/迁移** | `workspace/data_migration.py` 1,103 行 | 全树 FNV 校验 + 时点复验 + **四类 dry-run 预检**（合计 63 条断言） | **你的更严**。不借 |
| **敏感信息** | `.secrets.baseline` 扫描仓库 | **运行时 6 条正则拒绝入库** | 你的更贴用户。不借 |
| **AI 辅导/解题/深度研究** | `agents/` 20,036 + `runtime/` 11,685 + `tools/` 11,257 | 无 | **`[禁]`**，理由见 2.7 |
| **界面规模** | `web/` 292,440 行 | 网页端 43,372 + QML 4,705 | 不可比，也不该比 |

---

## 4. 给后端执行 AI 的移植规格

**优先级铁律：4.4 先于 4.1–4.3。** 现在门禁 8/8 全绿而四条主链是断的（1.6），在这种地基上加新功能只会把断点埋得更深。

### 4.1 新增 `mastery_store` + 掌握度推进（对应 Phase 4 P2.1 前置）

原生侧新建模块（现在**根本不存在**），语义**照抄网页端 `网页端/项目/src/data/mastery.ts`**，不要照抄 DeepTutor：

- 等级：`0..6`，名称表照 `MASTERY_LEVEL_NAMES`（`mastery.ts:12`）
- 推进：`课程完成 / 挑战通过 / 复测通过 / Bug 修复` 各 +1，上限 6；复测不过 −1，下限 0（`mastery.ts:5`）
- 记录字段：`refId, kind, level, evidence[], updatedAt, reviewDueKey?, reviewStep, lastFailReason?`（`mastery.ts:37-49`）
- **`CompletionVerification` 必须保留**：`auto-verified` vs `self-declared`，旧记录缺省一律按 `self-declared` 读、**不追认成验证过**（`mastery.ts:18-23`）——这条是反自欺的核心，DeepTutor 没有
- 落盘沿用现有台账风格：`<data_root>/learning/mastery.v1.log`，hex-TSV、原子写、幂等 `operation_id`、坏行 fail-closed、符号链接逐段拒绝
- 验收：与 TS 实现跑同一组输入做**逐字段对拍**（TS 侧已有 `tests/review.plan.discipline.test.mjs` 等可复用为期望值来源）

### 4.2 新增 `review_scheduler`（先阶梯，后保持度）

**第一步（必做）**：移植 TS 阶梯，语义原样：
- `REVIEW_OFFSET_DAYS = [1,3,7,14,30]` 是**本机兜底，不是排期标准**（`mastery.ts:52`）
- 生效计划三级优先 `unit > published > fallback`，来源必须能在界面上标注（`effectiveReviewPlan` / `reviewPlanSourceName` / `describeReviewPlan`，`mastery.ts:90-129`）
- `usableOffsets` 归一：非数组/空表/全非法 → **返回 null 表示「没写」并向上继承**，不得折成 `[]`（`mastery.ts:76-80`，#33 要拆的就是这个）
- 日期一律按**本地日期键** `YYYY-MM-DD` 归日，不用 UTC（`addDaysKey`，并与 `learning_contract.cpp:47-65` 的日期校验一致）

**第二步（可选，结构复刻 ≥90% 后再谈）**：把阶梯升级为可插拔保持度模型，照 `scheduler.py` 的接口形状：
- `RetentionScheduler` 抽象 + 默认「指数遗忘 + 按 `KnowledgeType` 冷启动先验」，**不许自称 FSRS**
- `interval = stability · −ln(desired_retention)`，`desired_retention` 默认 0.9
- 排序 `(-forgetting_risk, -overdue, priority)`
- `replay(evidence_stream)` 全量重算 + `hydrate()` 向后兼容（旧记录无 stability 时从 `interval_index` 反推且**不改到期时间**）
- 全部纯函数、无网络、无模型调用

### 4.3 `ReviewItem` 扩字段（P2.1 正文）

现字段（`review_service.hpp:13-22`）只有 8 个。补：`due_key`、`next_node_index`、`mastery_level`、`plan_source`、`group`、`forgetting_risk`；新增 `review()` / `snooze()` 两个 Q_INVOKABLE + `reviewGroups` QVariantList。对照 `网页端/项目/src/components/review-center-view.tsx:321-386` 的三个表格与行操作（通过 / 稍后提醒 / 查看原课程）。

### 4.4 异步链与关闭路径修复（P0 级，先于一切新功能）

| # | 必做 | 位置 |
|---|---|---|
| F1 | 补 **G1**：交互路径 `openPublishedContent` 成功后串 `loadStarterCode`，或让 `openPublishedContent` 一并带出 starter | `ui_shell.cpp:258-285` |
| F2 | 补 **G2**：`publishedIds` 提为 `Q_PROPERTY` 或 `Q_INVOKABLE` | `ui_shell.hpp:60` |
| F3 | 补 **G4**：把 `independentAttempt` 接到界面，否则进度永不落账 | `ui_shell_operations.cpp:319` |
| F4 | 补 **G5**：分析页改吃 `progress_projection`，删掉写死数字 | `Main.qml:4231-4638` |
| F5 | 三处「守卫 return 早于复位 busy」改为**先复位再 return** | `ui_shell_draft.cpp:166`、`ui_shell_operations.cpp:146,382` |
| F6 | 给 #4 authenticate、#8 import、#13/#14 backup 补守卫 | `ui_shell_account.cpp:65`、`ui_shell_operations.cpp:105,443,472` |
| F7 | 13 处忽略 `result.cancelled` 的回调补分支（#7 saveDraft 是唯一正确样板） | 各链 |
| F8 | **写竞态回归测试**：任务在飞时切账户，断言迟到回调不写状态。当前删掉 9 处守卫仍全绿，这条测试是判据本身 | `ui_shell_tests.cpp` |
| F9 | 解掉 **D1 矛盾**：改代码回到「只取消 Read」，或改注释承认「已入队未开始的 Backup/Import 可放弃」。**二者必须选一个并写明理由**，不许留着互相打脸 | `backend_task_service.cpp:35-51` |
| F10 | 解 L2：证据与进度两次写之间加**跨档事务或补偿**（或引入 4.2 的 `replay`，让进度成为可重算派生物而非第二份真相） | `challenge_service.cpp:25-36` |
| F11 | 解 L1：台账从「整档重写」改为分段/追加式，否则 §101 主线程 P95 ≤ 16.7 ms 在台账增长后必不达标 | `evidence_store.cpp:151`、`progress_store.cpp:170` |

### 4.5 禁止清单

1. 不得给 `native/src` 加任何网络/HTTP/WebSocket/LLM SDK 依赖（违反 C1/C2）。
2. 不得用 DeepTutor 的 `policy.py` / `topic_generation.py` / `prompts.py` 语义替换你 `effectiveReviewPlan` 的三级来源裁定。
3. 不得为了过门禁放宽 scrypt 参数、符号链接检查、fail-closed 解析、`operation_id` 幂等冲突判定。
4. 不得用写死数字填充界面（Phase 4 §4 已禁）。
5. 不得删改 `网页端/`——它是功能规格唯一来源。
6. 任何性能结论必须同机同负载实测并保留原始样本；只有原理排序时写「未证实」。

---

## 5. 三件我不替你决定、但必须你拍板的事

| # | 事项 | 现状数字 | 出处 |
|---|---|---|---|
| 1 | **§101 三项取舍签字** | Qt 工作集 **+430%**（151.2 vs 28.5 MiB）、可交互启动 **+332%**（440.6 vs 102.0 ms）、安装包 **65.0 MiB**（阈值 50 MiB） | `evidence/qt-ui-benchmark-20261006.json`（10-06 样本，**5 天未复测**） |
| 2 | **F9 取消策略**选哪一边 | 代码取消 `Read/Execute/Backup/Import`，注释写「只取消 Read，备份/导入不许取消」 | `backend_task_service.cpp:35-51` |
| 3 | **是否要为「AI 辅导」开一条离线通道** | 唯一不违反 C1 的接法是：外部工具离线生成课程/题目 → 写进 `content/` → 应用端仍只读。要不要做、由谁做 | 本文 2.7 |

---

## 6. 本文的证据边界（未证实项）

- DeepTutor **我没有运行过**，全部结论来自 v1.6.14 源码静态阅读 + GitHub API。它的运行时行为、真实内存/延迟无一手数据。
- 星数/issue 数/提交分布取自 GitHub API（10-11 当日）；抓取工具曾返回「2014 contributors」，与单页上限 100 矛盾，**该数字未采信**。
- 1.2 的 LOC、1.3 的落盘路径与不变量、1.6 的四个断点、1.7 的守卫统计、2.1–2.5 的 DeepTutor 数字，**均由本轮命令实测**；其中 1.6 的 G1/G2/G4 我又逐条亲自复核过（`grep -c` 结果分别为 0 / 普通 getter / 0）。
- §101 的三项性能数字是 **10-06 的样本**，当前 HEAD 未复测——第 5 节第 1 项要签字前必须先重跑。
- 两个只读代理的报告已交叉验证其承重结论，但 1.7 表格中逐行行号未全部二次核对，执行前建议以 `ui_shell.hpp` / 四个 facade .cpp 的当前内容为准。
