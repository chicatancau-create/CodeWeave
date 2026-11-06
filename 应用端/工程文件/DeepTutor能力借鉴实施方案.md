> 2026-11-06 目录规则：本端外层只留一个启动链接；源码在 `项目/`，工程说明在 `工程文件/`。当前入口和命令以仓库根 `AGENTS.md`、`工程文件/项目结构索引.md` 为准。下文旧根 EXE、旧构建树、旧备份目录及其历史测试记录不再作为当前操作指令，不得据此重建旧布局。

# DeepTutor 能力借鉴实施方案（应用端）

> 版本：v1.4
> 日期：2026-10-11
> 范围：仅 `应用端/`。不修改网页端、移动端、内容生产端或发布安装包。
> 状态：按本方案持续实施；阶段状态以第 8 节和实际验证记录为准。

## 1. 决策结论

DeepTutor 的学习域内核可以借鉴，但不整体移植。可借鉴范围是无模型、无网络的纯算法、数据模型和事件记录思想；应用端继续以现有 C++ 核心和 Qt/QML facade 为唯一运行主体。

本项目采用以下顺序：

1. 先修应用端现有 P0 断链、异步守卫、关闭取消矛盾和学习事实双写风险。
2. 再补与网页端已冻结语义一致的掌握度存储和阶梯复习调度。
3. 再补复习中心所需的数据契约、错题分类、作废题和可重放事件。
4. 最后才评估可插拔的保持度调度器；没有同机数据和等价性证据时，不得宣称采用 FSRS 或性能提升。

### 1.1 不可协商的应用端边界

- `应用端/项目/native/src/` 不得引入 HTTP、WebSocket、WinHTTP、LLM SDK、Embedding、RAG、向量数据库、外部模型密钥或联网运行时。
- 不启动端口、不启动常驻服务、不依赖 Node、pnpm、浏览器或网页 renderer 才能运行。
- DeepTutor 的 agent loop、prompt、topic generation、AI recommendation、RAG 和服务端会话全部禁止移植。
- 网页端只作为功能规格和逐字段对拍的参考，不修改 `网页端/` 来配合本方案。
- UI 不在本方案内重做。后端只提供稳定 DTO、命令和信号；QML 不直接访问 Store、不写文件、不启动进程、不判定学习完成。
- 账户隔离、scrypt 成本、符号链接拒绝、坏行 fail-closed、`operation_id` 幂等、受控执行和外部证据 Pending 语义必须保持。

### 1.2 借鉴分级

| 标记 | 含义 | 本项目处理方式 |
| --- | --- | --- |
| `[移植-无LLM]` | 可由纯函数和本地数据完成 | 用 C++ 重写，保留输入、输出和边界语义 |
| `[借设计]` | 只借字段、状态机或接口思想 | 结合现有不变量重新设计，不复制存储或服务实现 |
| `[禁止]` | 依赖模型、网络、服务或浏览器运行时 | 不进入应用端源码、依赖、构建和发布目录 |

### 1.3 借鉴决策表

下表是本方案的范围裁决。后续执行 AI 不得把“可借鉴”解释为复制 DeepTutor 源码、引入其运行时或改变应用端的离线边界。

| DeepTutor 能力 | 决策 | CodeWeave 的落地方式 | 进入条件 |
| --- | --- | --- | --- |
| 学习证据、掌握度等级和学习阶段 | 借鉴语义 | 以网页端已冻结的 0–6 级与现有 Evidence/Progress 不变量为准，C++ 重新实现 | P0 退出后接产品 |
| 阶梯复习调度 | 借鉴并优先实现 | 先实现网页端 `[1,3,7,14,30]` 和 `unit > published > fallback`，不先替换成自适应模型 | P1 契约和对拍通过 |
| 保持度/遗忘风险模型 | 暂缓评估 | 只保留 `RetentionScheduler` 接口草案；不得在没有同机样本时宣称使用或提升性能 | P0–P4、对拍和性能门禁全部通过 |
| 错题分类、重试状态、作废题 | 借鉴数据模型 | C++ 本地状态机；`ai_confirmation` 只允许空字段，不调用模型 | P3 facade 契约稳定后 |
| 版本化事件与 replay | 借鉴并用于可靠性 | 追加事实事件，重放生成派生投影；不复制 DeepTutor 的服务会话层 | P0-09/P0-10 方案冻结后 |
| 前置知识关系/DAG | 暂不纳入 | 先保留需求记录，不新增图数据库或运行时依赖 | P4 完成后重新评估 |
| LLM、Agent Loop、RAG、知识库检索、推荐 | 禁止 | 不进入源码、依赖、构建产物、配置和数据格式 | 永久边界 |
| HTTP/API/WebSocket/常驻服务/端口 | 禁止 | 应用端保持单机进程；不得增加启动器、服务进程或端口探测依赖 | 永久边界 |

本项目不复制 DeepTutor 源码。只采用独立重写的字段语义、状态转移和纯函数输入输出；如果未来需要引用其代码，必须先单独完成许可证、来源保留和安全审查，本方案不授权该行为。

## 2. 当前证据与进入条件

对照文档和本轮代码复核确认，当前原生端已有证据台账、正式进度台账、内容校验、受控执行和只读进度投影，但尚无原生掌握度存储和复习调度器。现有 `ReviewItem` 也没有到期日、节点、掌握等级、计划来源或复习分组。

进入新能力开发前必须先处理以下 P0。它们是实施顺序，不是可跳过的待办：

| 编号 | 当前问题 | 目标结果 | 主要位置 | 状态 |
| --- | --- | --- | --- | --- |
| P0-01 | 正文读取成功后没有在交互路径可靠加载 starter | 课程选择后 starter、草稿和执行策略形成一条可追踪链 | `ui_shell.cpp`、`Main.qml` | 已修复并由 Qt facade 测试覆盖 |
| P0-02 | `publishedIds()` 只是普通 getter，QML 不能按契约读取 | 通过 `Q_PROPERTY` 或 `Q_INVOKABLE` 暴露，并有通知信号 | `ui_shell.hpp` | 已修复并由 Qt facade 测试覆盖 |
| P0-03 | QML 没有接入独立完成入口 | 独立完成状态进入 challenge/evidence/progress 链，迟到回调不能落错账户 | `Main.qml`、`ui_shell_operations.cpp` | 已修复并由 Qt facade 测试覆盖 |
| P0-04 | 分析页面没有消费 `progress_projection` | 所有统计来自后端只读快照；删除写死的业务数字 | `Main.qml`、Qt facade | 已接入只读快照；复测/打卡仍明确显示暂无数据 |
| P0-05 | 部分回调在代次守卫前返回，busy 可能永久保持 | 任何守卫失败、取消或异常都先完成状态收尾，再退出 | `ui_shell_draft.cpp`、`ui_shell_operations.cpp` | 已修复并通过 8/8 CTest |
| P0-06 | 登录、导入、备份、恢复任务缺少完整 account/generation 守卫 | 任务在飞时切账户，迟到结果只被丢弃，不改 UI、账本或数据根 | `ui_shell_account.cpp`、`ui_shell_operations.cpp` | 已补齐归属字段和守卫 |
| P0-07 | 多数回调忽略 `result.cancelled` | 取消是可见、可复位、可测试的结果，不显示成失败或成功 | 所有 facade 回调 | 已补齐取消分支并通过 Qt facade 测试 |
| P0-08 | 关闭取消代码和注释互相矛盾 | 明确“只取消读任务”或“允许放弃尚未开始的写任务”并同步代码、注释、测试 | `backend_task_service.cpp` | 已统一为读/执行取消、写任务完成边界等待 |
| P0-09 | 证据与进度是两次独立写入 | 采用事务/补偿，或把进度改为由事实事件重放得到的派生状态 | `challenge_service.cpp`、stores | 已加入同 operation 的证据补偿并有失败回归 |
| P0-10 | 台账 append 当前会读整档并重写 | 消除全量重写；保留原子性、幂等和坏行拒绝，并测量总追加耗时 | `evidence_store.cpp`、`progress_store.cpp`、`operation_index.cpp` | 派生 operation 索引、事务恢复和截断分片重建已实现；最终门禁仍未通过，冷建索引路径、跨进程外部变更边界和主线程耗时仍需验收 |
| P0-11 | 现有并发测试不能证明迟到回调被丢弃 | 增加真实“任务在飞时切账户/课程/关闭”的回归测试 | `ui_shell_tests.cpp` | 已加入可控阻塞 worker 的在途读取 + 切账户测试；旧回调不覆盖新账户状态 |

P0 退出条件：每一项都有失败测试或最小复现、修复后的目标测试、账户和课程代次覆盖、关闭回收证据；P0-10 还需同机小/中/长账本的端到端追加原始样本及增长性结论。P0 未通过时，已有的 P1/P2 代码只能作为隔离的纯核心原型继续校验，不得接入 Qt/QML、改变现有学习账本行为或宣称产品能力已完成。

## 3. 目标架构与责任边界

```
Qt/QML UI
  -> UiShell command + read-only DTO/signal
  -> BackendTaskService (bounded worker, cancellation, generation guard)
  -> application services
  -> domain algorithms (mastery / scheduler / error state / replay)
  -> append-only stores and derived projections
```

- `codeweave-core` 是学习事实、账户隔离、内容权限、执行策略和持久化的唯一事实源。
- 领域算法必须是无 Qt、无文件 IO、无网络的纯 C++ 模块；同一输入必须能在单元测试中确定地产生同一输出。
- Store 负责校验、原子写、幂等、坏行 fail-closed 和符号链接检查；Service 负责事务边界、权限和组合多个 Store。
- Projection 只读，不反向修改 evidence、progress 或 mastery；UI 只消费稳定快照。
- 长任务只在线程池/后台队列执行，主线程只做参数校验、状态切换和 DTO 发布。

建议新增模块边界：

| 模块 | 职责 | 不得做的事 |
| --- | --- | --- |
| `mastery_contract.*` | 等级、证据类型、验证来源、字段和版本校验 | 不读文件、不决定 UI |
| `mastery_store.*` | `mastery.v1.log` 读写、幂等和坏行处理 | 不调用 scheduler，不读网页端 |
| `mastery_service.*` | 由合法 evidence 生成 mastery event，组合事务/补偿 | 不接受 UI 直接改等级 |
| `review_scheduler.*` | 计划解析、日期计算、分组和排序 | 不写 Store，不访问网络 |
| `review_service.*` | 读取事实并生成 Review DTO，执行 review/snooze 命令 | 不把 UI 文案写回事实 |
| `error_model.*` | 错题分类、状态机、作废规则 | 不调用模型确认 |
| `learning_replay.*` | 从事件流重算派生 mastery/progress/review | 不覆盖原始事实 |

文件名可按仓库现有命名调整，但每个模块必须保持“一份头文件、一份实现、一份针对性测试”的最小结构，禁止把所有逻辑继续堆进 `main.cpp` 或 `UiShell`。

## 4. 分阶段实施计划

### 阶段 P0：主链修复和事实一致性

**输入**：当前核心源码、P0 复核报告、现有 CTest/Qt facade 测试。

**动作**：完成第 2 节 P0-01 至 P0-11；先写失败回归，再改实现。每条异步请求携带 `account_id`、`account_generation` 和必要的 `content_id`/`request_revision`；回调必须按“取消判断 → 代次/对象守卫 → 状态收尾 → 发布结果”的顺序处理。

**验证**：账户切换、课程切换、关闭窗口、队列满、取消、备份/导入失败、重复 operation_id 和坏账本各有测试。P0 结束时记录 CTest、Qt facade 测试和真实窗口 smoke 的命令及结果。

**完成定义**：P0 问题全部有可复现证据和修复后通过证据；没有新增学习数据格式；Win32 回滚入口仍可构建运行。P0-10 的端到端增长性门禁未完成，因此不得接入 P1/P2 到产品 facade。

### 阶段 P1：掌握度事实模型和存储

**目标**：将网页端 `mastery.ts` 的已冻结语义移植到应用端，不先采用 DeepTutor 的自适应模型。

**核心规则**：

- 等级 `0..6`，名称与网页端 `MASTERY_LEVEL_NAMES` 一致。
- 课程完成、挑战通过、复测通过、Bug 修复各提升一级，上限 6；复测失败降低一级，下限 0。
- 仅 `passed && independent && ran_by == Learner && hint_level ∈ {L1,L2}` 的证据可以推进正式学习事实；AI 代跑、L3/L4 提示和外部环境证据不得推进。
- `auto-verified` 与 `self-declared` 必须保留；旧记录缺失验证字段时按 `self-declared` 读取，禁止追认。
- 同一 `operation_id` 同载荷为 duplicate 成功，不同载荷必须失败；坏行、路径符号链接和原子替换规则沿用现有 stores。

**落盘格式（已实现核心原型，产品接入仍受 P0 门禁约束）**：`<account_data_root>/learning/mastery.v1.log`，逐字段 hex-TSV。当前字段固定为 `schema_version`、`operation_id`、`event_id`、`ref_id`、`kind`、`passed`、`verification`、`ran_by`、`independent`、`hint_level`、`at`、`note`；日期采用 ISO UTC 时间。新文件名带版本，行格式由 `mastery_store.cpp` 和核心测试锁定。每个 append 先校验 operation/event ID 幂等，再通过 `.append.txn` 恢复协议追加；损坏记录 fail-closed。

**接口草案**：

- `validate_mastery_evidence(const MasteryEvidence&)`
- `apply_mastery_evidence(const MasteryRecord*, const MasteryEvidence&, plan_length)`
- `MasteryStore::append(const MasteryEvent&)`
- `MasteryStore::read_all(std::vector<MasteryEvent>&)`
- `MasteryService::record_evidence(...)`
- `MasteryService::replay(MasterySnapshot&)`

**完成定义**：C++ 与网页端使用同一组固定输入逐字段对拍；跨月/跨年日期、空计划、旧记录、重复 ID、非法字段、失败复测和上限/下限均通过；至少一次从空账本重放得到与增量结果相同的快照。

### 阶段 P2：阶梯复习调度

第一版只实现现有网页端已冻结的阶梯语义：

- 兜底节点为 `[1, 3, 7, 14, 30]`，仅在上层无有效配置时使用。
- 生效优先级严格为 `unit > published > fallback`；`null`、`undefined`、空数组和全非法数组表示“未提供”，继续向上继承。
- 使用本地日期键 `YYYY-MM-DD`，不把 UTC 日期转换混入业务语义。
- 每个 Review DTO 必须带 `plan_source`，界面不得自行复制节点常量。
- 支持通过、失败重排、稍后提醒、计划完成后清除到期日，并保证重复命令幂等。

**接口草案**：

- `effective_review_plan(unit_offsets, published_offsets)`
- `schedule_first_review(record, today_key, plan)`
- `schedule_next_review(record, today_key, plan)`
- `reschedule_review(record, today_key, plan)`
- `snooze_review(record, today_key)`
- `group_reviews(records, today_key)`

**完成定义**：网页端测试向量与 C++ 输出逐字段相等；逾期/今日/未来 7 天/下一条复测分组稳定；没有写死统计数字；调度器不执行 IO、不启动线程、不访问网络。

### 阶段 P3：复习中心数据契约与 facade 接入

扩展现有 `ReviewItem`，至少增加：`due_key`、`next_node_index`、`mastery_level`、`plan_source`、`group`、`forgetting_risk`（第一版可为明确的规则值或空值，不能伪造模型估计）。保留现有 `content_id`、`exercise_id`、最新结果、独立性、提示级别和证据数量。

后端提供只读 `ReviewSummary`/`ReviewItem` 快照和两个命令：`review(item_id, result)`、`snooze(item_id)`。QML 只绑定 DTO 和 busy/status 信号；不在本阶段重做视觉。分析页改用 `progress_projection` 和 review snapshot，任何没有数据的字段显示明确的“暂无数据”，不得填固定数字。

**完成定义**：账户切换清空旧复习快照；迟到回调不会污染新账户；复习操作成功、失败、取消、重复和过期 item 均有可见状态及回归测试。

### 阶段 P4：错题、作废题和可重放事件

**错题模型**（借 DeepTutor 的纯数据设计）：

- `ErrorType`：`structural`、`deviation`、`application`、`metacognitive`。
- `ErrorStatus`：`active → retrying → review → graduated`，非法跳转拒绝。
- 记录自我归因、重试历史、关联 evidence_id；`ai_confirmation` 只保留可选字段，第一版必须为空且不触发模型。

**作废题**：保存 `voided` 和必填 `void_reason`。作废记录保留审计和重放输入，但不参与掌握度、错题统计或复习间隔；作废只能由明确的本地命令产生，不能通过删除历史行实现。

**事件流**：引入版本化 `MasteryEvent`，至少包含 `event_id`、`path_id/ref_id`、`revision`、`event_type`、`payload`、`at`、`operation_id`。原始事件只追加；`replay()` 从头重算 mastery、review 和统计投影。增量写失败时使用事务或补偿，不能留下“证据成功、进度静默失败”的不明状态。

**完成定义**：同一事件流重复 replay 结果相同；缺失/乱序/重复 revision 有明确 fail-closed 行为；从备份恢复后可以重建投影；原始事件不被投影过程改写。

### 阶段 P5：可插拔保持度调度器（可选）

只有 P0–P4 全部通过、阶梯语义达到至少 90% 对拍等价、并完成同机性能基线后才允许评估。

- 定义 `RetentionScheduler` 纯接口，默认实现采用“指数遗忘 + 知识类型冷启动先验”。
- 记录 `stability`、`retrievability`、`desired_retention`、`forgetting_risk`、`review_count`、`lapse_count` 等字段时，必须说明来源和计算版本。
- 采用 `interval = stability * -ln(desired_retention)` 等公式时，必须把它称为项目内实验模型，不得称为 FSRS 或已校准模型。
- `hydrate()` 只补缺失字段，不擅自改变旧到期日期；`replay()` 必须可重算。
- 新旧调度器通过配置/版本选择，默认仍可回到阶梯调度；不能一次迁移覆盖旧事实。

**完成定义**：至少两组同机同负载对照样本、冷启动和长账本样本、回滚到阶梯实现的演练、字段版本迁移和性能门禁均通过；否则保留 P2 阶梯版本。

### 阶段 P6：发布前审查（不等于现在制作安装包）

完成 P0–P5 后才做应用端整体审查：网络/端口扫描、依赖许可、线程与句柄、数据隔离、长账本写入、取消关闭、账户切换、升级兼容和性能样本。安装包仍需单独通过已有 B0–B3 门禁和用户授权，本方案不提前制作安装包。

### 4.1 可执行任务卡与依赖顺序

后续执行按任务卡逐项推进。每张卡只允许修改列出的范围；完成一张卡后先运行该卡验证，再更新第 8 节状态，不能把“代码已存在”当作“阶段已通过”。

| 顺序 | 任务卡 | 输入 | 允许修改范围 | 最低退出证据 |
| --- | --- | --- | --- | --- |
| 1 | P0-10-A：增长性方案 | 现有两个 append store、追加基准和幂等测试 | `evidence_store.*`、`progress_store.*`、测试与本方案 | 选定派生 operation 索引或分段方案；说明重建、损坏、过期和回滚行为；不改变原始账本格式 |
| 2 | P0-10-B：索引/分段实现 | P0-10-A 决策与失败测试 | 仅台账实现、针对性测试、基准 | 同 operation 同载荷 duplicate、冲突 fail、坏账本 fail-closed、索引损坏可重建；小/中/长账本样本保存到 `应用端/项目/evidence/` |
| 3 | P1-A：掌握度对拍 | 网页端固定向量、`mastery_contract.*` 原型 | 掌握度契约、测试和对拍夹具 | 正常/失败/边界/旧记录/账户隔离/重复 replay 逐字段一致；未接 facade |
| 4 | P1-B：掌握度服务收口 | P1-A 结果、Store 事务测试 | `mastery_service.*`、Store 测试 | 合法证据才推进；非法通过证据明确拒绝或记录为非推进事件；恢复测试通过 |
| 5 | P2-A：调度契约收口 | 网页端复习测试向量、`review_scheduler.*` 原型 | 调度器、计划来源字段、纯函数测试 | 日期边界、继承、失败重排、snooze、分组逐字段对拍；调度器无 IO/线程/网络 |
| 6 | P2-B：调度事件持久化 | P1/P2 事件字段决策 | 调度事件 Store、replay 测试 | 追加、重复命令、坏行、恢复和重放一致；不接 UI |
| 7 | P3：Review DTO 与 facade | P2 通过证据、现有 `ReviewItem` | 后端 DTO、UiShell、针对性 QML 绑定 | 切账户、迟到回调、取消、过期 item、失败状态均有测试；不重做视觉 |
| 8 | P4：错题/作废/replay | P3 稳定 DTO 与事件边界 | `error_model.*`、`learning_replay.*` 及测试 | 非法状态跳转拒绝；作废保留审计且不计入派生统计；重复 replay 稳定 |
| 9 | P5：保持度实验评估 | P0–P4 全部退出证据和同机基线 | 仅实验模块、样本和决策记录 | 不能通过时保留 P2；不得覆盖既有事实或默认启用实验模型 |

每张任务卡的固定执行模板：

1. 读取本方案、`应用端后端工程.md`、目标模块和相邻测试。
2. 先加入能复现问题或锁定契约的失败测试。
3. 做最小实现，保持原始事实文件可读、可备份、可回滚。
4. 运行目标测试、Release 构建和相关 CTest；失败必须记录为失败或基线失败。
5. 检查 `git diff`、未跟踪文件、临时脚本和后台进程，再更新状态。

P0-10 的索引设计有额外硬约束：原始 `*.v1.log` 永远是唯一事实源；索引只保存 operation 到记录位置或分段的可重建信息。索引缺失、版本不匹配、校验失败或与账本尾部不一致时，必须从原始账本重建或安全回退扫描，不能返回未经验证的 duplicate 结论；索引更新失败不得损坏已提交的原始记录。

### 4.2 固定验证入口

以下是本项目当前已确认的验证入口。后续文档只能在实际执行后标记 `[通过]`，不得把计划命令写成结果：

```powershell
$vs = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat'
$command = "call `"$vs`" -arch=x64 && cmake --build G:\CodeWeave\.local\qt\build-msvc --config Release --parallel 4"
& cmd.exe /d /s /c $command
ctest --test-dir G:\CodeWeave\.local\qt\build-msvc -C Release --output-on-failure
```

应用端边界检查至少包括：

```powershell
rg -n -i 'openai|llm|embedding|fetch\(|http|winhttp|InternetOpen' G:\CodeWeave\应用端\项目\native\src
rg -n 'listen\(|QTcpServer|QWebSocket|3782|8001|8090' G:\CodeWeave\应用端\项目\native
```

边界检查的预期是没有新增命中；已有测试夹具或文档中的普通文本命中必须逐项说明，不能用删字符串掩盖真实依赖。

## 5. 数据兼容、迁移与回滚

- 不读取或改写旧网页端运行时数据；如需导入，先生成只读报告和备份，再走现有迁移契约。
- 新文件使用 `*.v1.log`，新增字段只能追加版本或显式迁移，不改变旧字段含义。
- 迁移顺序：验证源 → 复制到隔离暂存 → 解析并报告 → 写新台账 → replay 校验 → 用户确认后切换；任一步失败删除本次创建的暂存目录，不删除源。
- 运行时同时保留“事件事实”和“派生投影”的边界。投影损坏时删除并 replay，不能反过来把投影当事实。
- 回滚只切换应用代码/配置版本，保留新台账和备份；旧版本无法识别新台账时必须明确拒绝并保留现场，不静默覆盖。

## 6. 测试与性能门禁

### 6.1 测试矩阵

| 类别 | 最低覆盖 |
| --- | --- |
| 纯函数 | 等级推进/降级、验证来源、计划继承、日期边界、分组排序、错题状态跳转 |
| 存储 | 原子写、重复 operation_id、冲突 ID、坏行、空文件、符号链接、权限失败、长账本 |
| 事务/replay | 证据成功进度失败、补偿、重复 replay、乱序 revision、旧版本 hydrate |
| 异步 | 切账户/课程、取消、关闭、队列满、迟到回调、busy 收尾 |
| 契约 | C++ 与网页端固定向量逐字段对拍；UI DTO 字段完整性和空值语义 |
| 安全 | `native/src` 无网络依赖、敏感信息拒绝、账户数据根隔离、执行白名单不变 |
| 构建 | Qt ON/OFF、Release、现有 Win32 回滚入口、无 Node/端口启动 |

### 6.2 性能规则

- 先测量再优化；同一机器、同一构建类型、同一内容快照、同一账户数据规模进行对照。
- 记录小账本、中账本和长账本的 append、replay、summary、切账户和关闭耗时，保存原始样本及 EXE hash。
- 主线程任务 P95 目标 ≤16.7 ms；取消确认 ≤100 ms；复习汇总和 replay 不得在 UI 线程执行。
- 若工作集、启动或包体相对基线增长超过既定门槛，必须记录原因和取舍，不得用算法名称推导“性能提升”。
- 没有原始样本的结论统一写“未测量”，不写“已优化”或“性能更好”。

### 6.3 P0-10 追加基准（2026-10-11）

未索引版原始样本保存在 `应用端/项目/evidence/progress-append-benchmark-20261011.json`：每档 5 次，合成隔离账本分别包含 100、1,000、10,000 条记录，所有样本 `ok=true`，中位数为 4,512 us、5,833 us、21,383 us。索引版验证样本保存在 `应用端/项目/evidence/progress-append-benchmark-20261011-indexed.json`：所有样本 `ok=true`，但每次均新建空索引并在被测调用中从既有账本重建索引，因此它测量的是“冷索引建立 + 幂等检查 + 追加”的组合，不是热索引追加。两组口径不同，不可据此计算性能提升或退化。

最终索引候选复跑记录在 `应用端/项目/evidence/progress-append-benchmark-20261011-indexed.json`。最新 5 次样本中，冷组合（首次打开 Store、索引校验/重建、幂等检查并追加）100、1,000、10,000 条账本中位数分别为 490,370 us、1,355,528 us、910,064 us；热组合先用同一 Store 完成一次预热追加，再测一次后续追加，中位数分别为 14,710 us、15,276 us、13,967 us；所有 30 个进度样本 `ok=true`。冷路径仍包含首次索引构建，且 10,000 条值低于 1,000 条，说明样本受缓存与环境噪声影响；每组只有 5 次，不能据此宣称整体性能提升。热追加在该合成单机负载下没有随账本规模增长，但还没有与旧实现同机 A/B，也没有测 UI 主线程 P95、编辑响应、真实账户数据或并发外部写入。

本轮回归补齐了 Progress 索引分片真实截断重建、账本外部等长替换后的索引刷新，以及事务恢复后 operation 重复识别。`load_or_rebuild` 的进程内快路径使用账本大小和修改时间判断缓存有效；文件系统若被外部程序以相同长度、相同时间戳原地改写，进程内缓存无法仅凭该签名发现。应用数据根由单实例锁保护，仍须把“同路径只允许应用单写”和重新打开 Store 时做完整 fingerprint 校验作为明确边界；若要承诺对抗任意外部原地改写，后续需引入可验证的文件身份/内容校验策略并重新评估热路径开销。

P0-10 仍未通过：索引元数据/分片损坏、分片截断重建、普通外部替换和恢复后幂等识别已进入核心回归；还需验证跨进程恢复场景、重复 operation 查找和长账本冷路径预算，建立旧实现同机对照，并量测 UI 主线程 P95。GUI smoke 本轮全量 CTest 8/8 通过，但历史间歇性退出问题仍需重复运行证据。上述合成数据不代表 UI 主线程、启动、内存或真实用户数据性能。

## 7. 给后续小模型的执行规范

1. 每次只实施一个阶段和一个模块，先读本文件、`应用端后端工程.md`、相关头文件和测试。
2. 先新增失败测试，再改实现；测试通过后再更新工程文件状态。
3. 不改 QML 视觉、不改网页端、不改移动端、不引入新依赖，除非本阶段明确列出并完成许可审查。
4. 不删除历史台账、旧 EXE、备份、证据或来源不明文件；临时脚本必须登记，任务结束按归属规则清理。
5. 不把 TODO、截图、静态 grep 或“代码看起来正确”标为通过；验证状态只能使用工程总指令规定的六种状态。
6. 改动公共 DTO、数据格式、迁移或取消策略前，必须先更新本方案和测试矩阵，并暂停等待总工程师确认。
7. 每次交付报告必须写清：改了什么、实际命令、结果、未执行项、残留风险、回滚步骤和工作区状态。

## 8. 阶段状态表

| 阶段 | 状态 | 进入条件 | 退出证据 |
| --- | --- | --- | --- |
| P0 主链修复 | 进行中（P0-10 端到端性能门禁未完成） | 当前代码复核完成 | 断链、取消、补偿、快照接线和 P0-11 竞态已验证；P0-10 已实现派生 operation 索引，元数据/截断分片重建、普通等长外部替换、事务恢复后幂等识别及冷热样本已通过；仍缺跨进程恢复、旧实现同机对照、长账本冷路径预算、主线程 P95 和 GUI smoke 重复稳定性证据 |
| P1 掌握度存储 | 核心原型进行中，未接入产品 | P0 通过后才可 facade 接入 | 已有纯函数、`mastery.v1.log` 和 replay 原型；还需全面 TS 固定向量、旧格式 hydrate/verification 缺省、坏事务和账户隔离测试 |
| P2 阶梯复习 | 纯函数原型进行中，未持久化/接 UI | P1 契约冻结并完成后 | 计划继承、日期、重排、稍后提醒和分组向量已有核心测试；仍需记录计划来源与调度事件重放，并完成网页端全面对拍 |
| P3 facade 接入 | 未开始 | P2 通过 | DTO、切账户和操作回归通过 |
| P4 错题/作废/事件 | 未开始 | P3 通过 | 状态机、作废和 replay 通过 |
| P5 保持度实验 | 暂不进入 | P0–P4 和性能基线通过 | 对照样本、迁移、回滚齐备 |
| P6 发布前审查 | 未开始 | 业务阶段完成 | B0–B3 入口条件清晰 |

任何“通过”都必须以实际命令和证据更新；本表不是完成声明。P1/P2 先行纯核心原型仅用于验证算法与存储边界；在 P0 退出前，不得把它们接入 Qt/QML 产品路径或改变现有学习账本行为。

## 9. 明确结论

可以借鉴 DeepTutor 的学习算法和数据模型思想，但 CodeWeave 的第一实施目标是把自己的事实链补完整，并保持无网络、无端口、无 LLM 的桌面应用边界。DeepTutor 的服务化和 agentic 能力不属于本项目应用端。只有 P0 修复并完成网页端语义对拍后，才进入新的掌握度和复习能力；只有所有阶段与既有安装门禁通过后，才讨论安装包发布。
