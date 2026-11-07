# P1 1.1 / 1.2 阶段检查点

日期：2026-11-07。学习概览功能验收通过；阶段明细的结构与交互通过，视觉仍待收尾。整体修缮和 Phase4 保持进行中。

## 验证证据

- `learning-matrix.json`：最终真实窗口原始报告，85/85，18 张截图。正式证据只保留本项相关六张截图，其余页面已在矩阵中回归，原图位于 JSON 记录的临时目录。
- `u3-learning.png`、`u3-learning-empty.png`、`u3-learning-completed.png`：访客、完成筛选空态、Python 1/6 完成状态。记录来自临时 fixture，不代表真实用户进度。
- `u3-learning-details.png`、`u3-learning-details-small.png`、`u3-learning-details-selected.png`：明细页、1100×720、底部所选课程与进入学习。常规截图为 1440×900，验收模式采用 Floor DPI 取整，未改变正式应用缩放策略。
- `web-reference.json` 与三张 `web-*.png`：当前网页端隔离 API 的 1440×900 参考；Python 六单元，五项统计，pageerror 为空。
- `build-output.txt`：当前完整重建及 CTest 9/9 的实际输出。`queued-refresh-build-output.txt`：追加后台忙碌补读断言后的增量构建与 CTest 9/9。`qt-learning-catalog` 内四项测试全部通过；facade 覆盖六态、旧记录、账户切换与读取失败清空。
- 两个 `ui_shell_account.cpp.obj` 的 Ninja 依赖均从零条恢复为 146 条。UTF-8 前缀修复后完整重建，未修改生成文件。

## 复现

仓库根目录执行：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd --fresh
node --test 应用端/项目/native/ui-qt/tests/learning_catalog_tests.mjs
node 工程文件/工具/check-layout.mjs
```

普通增量构建仍使用不带参数的标准脚本。`--fresh` 重配并清理当前生成物，不读取或删除工作区数据。应通过脚本提供的 Qt/VS 环境执行 CTest，不裸跑构建树内的清理目标。

部署目录含 DLL、QML imports 和打包内容，更新 EXE 后执行：

```powershell
& "$env:TEMP/CodeWeave-P1-1-9-20261107-a/CodeWeaveQtShell.exe" --u3-matrix-json '<新的绝对路径>/matrix.json'
```

窗口必须可见。最终原报告为 `%TEMP%/CodeWeave-P1-1-9-20261107-a/learning-queued-final-run/matrix.json`。Qt 的账户和数据由 QTemporaryDir 隔离创建，正常退出时释放；不使用真实工作区。

网页参考脚本为 `应用端/项目/native/ui-qt/tests/capture_learning_reference.mjs`，参数顺序为外部 Playwright 目录、Chrome 路径、本地 Vite URL、输出目录。本轮外部运行时来自 `%TEMP%/codeweave-stage5-browser-20261107/node_modules/playwright-core`，URL 为 `http://127.0.0.1:5189`；浏览器在 finally 中关闭，临时 Vite 进程在交付前退出。API 被全量拦截，未启动真实学习数据服务。

## 行为与决策

1. 完成口径与网页 `lesson-evidence.ts` 一致，仅自评通过、自动验证通过、延迟复测掌握算完成；全时间事实不受近七天分析窗口限制。
2. 当前 JSON 没有课程 `stageId/contentId/legacy`，不把旧 A–M 标签猜成 S0–S9。十个编号区明确标记没有映射，旧编号独立保留。阶段缺口只统计已观察编号之间的空档，与网页口径一致。
3. 选课索引只用于元数据身份，打开课程按 ID 查询发布索引；脏草稿阻止换课并保留编辑。主卡、计划和预览都使用当前所选课程。
4. 新增只读 facade 属性，无依赖升级、无数据迁移或认证规则变化。正式已安装版本未替换。

## 人工视觉对比与剩余范围

| 区域 | 当前检查结果 | 待处理 |
| --- | --- | --- |
| 概览 | 课程、代码和计划保持同源；完成数量真实；网格/侧栏区块可见 | 壳层搜索宽度、字体与课程卡片密度仍和网页不同，未做像素等价验收 |
| 明细页首 | 标题、返回和五项统计存在且无重叠 | 网页保留来源条/问候区，Qt 切成整个明细工作区；网页统计纵向排列，Qt 使用宽屏五列、小窗口两列 |
| 科目清单 | 当前目录 22 科目均可选，宽度受约束 | 网页回退目录有 21 科目、排序/元信息不同；不得伪造目录数据来追求截图一致 |
| 阶段/课程 | 十个阶段明确空映射，未编号课程有来源、缺口和先备；页尾进入学习可达 | 网页用表格与来源标识，Qt 为单元行；需要继续对齐密度与层级 |

本轮没有完成逐像素差分、正式资料库/真实账户联调，也没有重新执行网页全量质量门禁或 Android 编译。下一项是 P1 1.2 视觉收尾，然后复核 P1 1.3–1.5。

## 失败调查与修复

- 新测试曾误用 Qt 的 `signals` 宏名，改为 `learning_signals`；夹具曾使用不合规 operationId，改为符合现有正则的唯一 ID。没有改变业务校验。
- 初次增量构建出现登录失败：缓存的 `/showIncludes` 前缀乱码，账户对象的头文件依赖为零，新增成员后链接了旧布局。完整重建定位后，脚本统一 UTF-8 并在退出时恢复原代码页；`--fresh` 重置编译器探测并清理旧生成物。最终依赖 146 条且 9/9 通过。
- 动态 Repeater 控件不在普通 QObject 查找树中，矩阵改为遍历可视树；退出前跳学习触发了真实后台读取，矩阵调整为等待当前任务再退出。未绕过 facade 的忙碌保护。
- 曾裸跑 `cmake --build .local/qt/current --target clean`，因临时 Qt 盘符已释放而重配失败；改为在标准脚本配置后的环境里清理，最终完整构建通过。
- 网页参考首次把课程卡点击当作留在概览选课，实际网页会进入工作台；脚本按既有行为改为同科目首课参考，不修改网页业务来迎合取证。

## 临时资源与回滚

构建与窗口进程已退出。既有部署目录此前删除被自动审批拒绝，本轮保留，未绕过；本轮中间报告位于其 `learning-run-a/b/c`、`learning-final-run`，最终位于 `learning-queued-final-run`。参考图和 Vite 日志保留在 `%TEMP%/CodeWeave-P1-1-2-reference-20261107` 用于复现。

本轮构建日志位于 `%TEMP%`：`CodeWeave-P1-1-2-build-20261107-a/b/c.log`、`CodeWeave-P1-1-2-clean-build-20261107.log`、`CodeWeave-P1-1-2-fresh-build-20261107.log`、`CodeWeave-P1-1-2-final-build-20261107.log`、`CodeWeave-P1-1-2-final-build2-20261107.log`、`CodeWeave-P1-1-2-clean-verified-20261107.log`、`CodeWeave-P1-1-2-queued-refresh-20261107.log`。失败断言可能留下无法可靠区分归属的 `codeweave-qt-facade-tests-*` 临时目录；未删除来源不明目录。

工程知识库 README、执行标准与相关索引已读取，未找到当前 Qt 构建相关现成记录；本轮未写入正式错误复盘或记忆。

本地提交后可通过 `git revert <本检查点提交>` 撤销源码/脚本行为，再执行标准脚本重新构建。无数据结构迁移，正式安装版本未改动。
