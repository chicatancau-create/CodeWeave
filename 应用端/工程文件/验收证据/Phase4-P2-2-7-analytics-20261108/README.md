# P2.7 学习分析与工作台保存回归

日期：2026-11-08。此检查点完成 P2.7 的本机数据口径与功能验收，不代表 Phase 4 视觉等价或全部修缮完成。

## 行为与决策

- 窗口为含今天的 7 个系统本地日期，由 facade 返回起止键，页面展示同一份快照的日期；页面再次可见或跨日时请求刷新。
- 完成单元只认窗口内通过的 Lesson 事实并按课程去重。普通课程执行记录只增加练习次数，外部证据不冒充练习或课程完成。
- 挑战统计消费独立账户提交档案，按关卡保留当前通过/确认结果；兼容旧 Challenge 事实去重。待确认重提保留已通过状态，明确驳回取代此前通过状态，与当前挑战状态规则一致。
- 复测通过率为通过数除以通过与未通过总数，四舍五入为百分比；空分母显示“样本不足”。打卡、学习时长及到期任务分母缺少数据源，继续显示空态。
- 复测排期重放将 UTC 掌握度事件转换为系统本地日。原账本不迁移、不重写；改变系统时区后重放会按新时区计算，运行期间切换时区未实测。
- 工作台保存中禁用按钮；错误提示可关闭且保留未保存编辑，修复写入条件后可重试。

## 验证

| 检查 | 结果 |
| --- | --- |
| 根目录 `工程文件/工具/构建当前Qt.cmd` | [通过] Release 构建与 CTest 9/9，最终 41.02 秒 |
| 部署后 `CodeWeaveQtShell.exe --u3-matrix-json <绝对路径>` | [通过] 161/161，38 张截图，退出码 0，QML 警告为空 |
| 应用端 `corepack pnpm test` | [通过] Node 4/4 |
| 应用端 `corepack pnpm check` | [通过] 源码边界、发布边界、脚本语法 |
| 根目录 `node 工程文件/工具/check-layout.mjs`、`git diff --check` | [通过] |

`matrix.json` 保存完整逐项结果。新增窗口夹具的实际显示为：完成单元 2、练习 2、挑战通过 2、复测通过 1、复测未通过 2、复测通过率 33%。空账户显示零活动与“样本不足”。

facade 回归另覆盖重复课程、窗口首尾 00:00/23:59:59、旧/未来记录、非相关类型、挑战重复/待确认/驳回/人工确认、重载与账户清空、损坏档案拒读且原文件保留。native 回归覆盖本地 00:59/23:59 下的首次与后续复测排期。

人工查看 `u3-analysis-values.png`、`u3-analysis-review-rate.png`、`u3-workspace-save-error.png`：1440×900 文字可读，无相互遮挡，保存错误和重试按钮可见。这是布局检查，不是网页端逐像素差分。

## 失败与环境边界

- [先失败，修复后通过] 标准脚本结束会移除临时英文 Qt SDK 盘符，之后裸跑 `cmake --build .local/qt/current --target codeweave-qt-deploy` 触发重配，找不到 Qt6。用标准入口恢复配置后，直接调用已有部署脚本并显式指定本机 SDK 路径，成功部署和运行矩阵。未改动 SDK、junction 或构建脚本。
- 构建提示缺少可选 Vulkan 头文件；windeployqt 提示缺少 dxcompiler/dxil，仍成功部署，实际窗口与截图通过。不将提示当作已解决，也不视为代码编译失败。
- [未执行] 正式用户账户与资料库联调、网页端同数据视觉等价、Android、系统时区运行时切换；本检查点没有网页或移动端代码变更。

## 复现

从 `G:/CodeWeave` 根目录，在有交互桌面的 PowerShell 中执行：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$reproDeploy = Join-Path $env:TEMP ('CodeWeave-P2-7-repro-' + [guid]::NewGuid().ToString('N'))
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $reproDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
& "$reproDeploy/CodeWeaveQtShell.exe" --u3-matrix-json "$reproDeploy/evidence/matrix.json" | Out-Null
$LASTEXITCODE
```

构建、部署参数和矩阵入口已在本次实际执行。复现目录使用新名称，避免覆盖证据；不要在未创建空目录的情况下调用部署脚本。

## 现场、自审与回滚

- 矩阵通过 QTemporaryDir 创建隔离工作区、账户与数据，退出后自动清理。未使用真实账户或 `工作区/` 数据，没有远程写操作或依赖升级。
- 本次专用临时部署 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-7-20261108-current-deploy` 在取证后删除；本目录的报告与截图是正式交付证据，保留。
- 已复核源码 Diff、账户代次、异步忙碌门禁、快照日期与统计口径、损坏保护、保存修订及原有回归断言。未删除或弱化测试。
- 代码与文档以本检查点的本地提交恢复；需要回退时先保护新的用户修改，再 `git revert <本检查点提交>`，重跑标准构建。无需数据迁移或账本回写。
- 下一项：P2.8 侧栏打卡日历与复习角标，先调查真实数据契约与现有网页实现，再决定实现范围。
