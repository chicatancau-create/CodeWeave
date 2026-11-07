# P2.6 真实执行事件与 Python 源码快照检查点

日期：2026-11-08。真实进程事件已接入，Python 源码节点与受限变量快照已补齐；P2.6 完整版仍为部分完成，不代表其它语言源码调试、实时流式执行或网页端视觉等价已经验收。

## 契约与决策

- 复用 `native/src/trace_contract.hpp` / `execution_service.cpp` 的 Started、Output、Paused、Resumed、Completed、Failed、Cancelled。服务在运行结束后返回完整 Trace；本次没有改成实时流式回调。
- Python 运行使用隔离 runner 和旁路 `snapshots.jsonl`，从 Python `sys.settrace` 取得真实 `line`、`return`、`exception` 事件，再由原生层解析并加入受限 `SourceStep` 事件。C++、Java、JavaScript 不伪造源码节点，继续显示能力空态。
- facade `executionTrace` 返回 `sessionId`、`documentId`、`sourceRevision` 与按原始 sequence 排序的 `events`；每项含 kind、中文 label 与纯文本 payload。输出统一换行，不将错误文本当成代码或富文本执行。
- 新运行清空旧轨迹；切课、切自由编程、切账户和退出清空轨迹。自由编程同时清空上一课程原文，避免显示无关内容。异步结果沿用账户代次和任务 ID 门禁；运行中编辑代码后，结果仍对应发起时的源码版本。
- 工作台保留课程静态结构，增加执行事件切换、事件连线、当前事件指针、前后回看、方向键/Home/End 以及截至当前事件的输出；结束后默认选择末事件。失败事件显示真实错误 payload；代码修订变更后提示旧版本。
- Python `SourceStep` payload 只包含源码行、阶段和受限变量文本；单步最多 8 KiB、最多 512 步、总量最多 256 KiB。源码步骤不写入 `TraceStore`，避免长期保存任意局部变量；其它语言的变量区显示“暂无变量快照”。源码事件仍是运行结束后回看，不绑定课程静态节点为已执行。
- 工作台使用纵向滚动和内容最小高度保护 1100×720 布局，分区按钮滚动到对应区域；运行控制支持换行。新增颜色使用 `ds` 令牌，没有新增依赖、数据迁移或存储格式修改。

## 验证与证据

- [通过] 本轮重新执行标准入口 `cmd /c 工程文件\工具\构建当前Qt.cmd`：Release 构建成功，CTest 10/10（37.81 秒）。目录中的 `ctest-final.txt` 保留前一检查点的 9/9 记录，不作为本轮日志。
- [通过] 应用端 `corepack pnpm check`：源码/发布边界和脚本语法；`corepack pnpm test`：4/4。
- [通过] 根目录 `node 工程文件/工具/check-layout.mjs` 与 `git diff --check`。
- [通过] 既有进程事件回看隔离窗口矩阵 `matrix.json`：186/186，47 张截图，退出码 0、QML 无警告；全部截图保留在本目录。Python 源码快照由 native/facade 回归覆盖，未把旧矩阵误写成源码快照窗口证据。
- [保留] `matrix-first-failed.json` 与 `first-failed-narrow.png` 是修复前证据，不作为当前通过结果。
- facade 覆盖四种语言正常结束、会话课程绑定、非零退出失败、取消、切课和退出清空；Python 额外覆盖真实源码行、阶段、变量字段及空快照边界。真实窗口覆盖默认末事件、前后回看、Home/End、暂停/继续事件、取消/超时、修改代码旧版本提示及最小窗口边界。
- [未执行] C++、Java、JavaScript 源码节点与变量快照、实时流式执行事件、网页端同状态逐区块/像素差分、正式账户和资料库联调、Android。不同语言的源码追踪需要各自真实执行契约，不能由 QML 猜测。

## 失败与修复

- [先失败，修复后通过] 新增取消测试留下未保存自由编程稿，随后退出被既有保护拒绝；显式放弃后，后续保存测试仍因自由文档没有课程语言前置条件而失败。取消用例结束恢复 Python 发布课程，保留原保存/关闭断言，并补轨迹清空检查。
- [先失败，修复后通过] 初轮窗口矩阵发现默认指针停在首事件、窄窗轨迹区被压缩。模型更新后延迟定位末事件，并给内容设置最小高度与滚动；原断言全部保留，增加键盘和暂停/继续事件检查。
- [先失败，修复后通过] 新增 Flow 显式赋值只读 implicitHeight 导致 QML 加载失败；通过 Qt stderr 定位后移除该赋值，使用 Flow 自带高度。没有禁用 QML smoke 或吞掉警告。
- 人工检查成功、窄窗、旧版本、取消和超时截图。自由编程截图曾显示旧课程原文，已清空并添加 facade/窗口断言；最终截图作为当前证据。
- 构建仍提示缺少可选 Vulkan 头，隔离部署提示 dxcompiler/dxil 未找到；未声称这些环境提示已解决。

## 复现

从仓库根目录、有交互桌面的 PowerShell 执行；使用本机现有工具链配置，不访问真实用户目录：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$traceDeploy = Join-Path $env:TEMP ('CodeWeave-P2-6-repro-' + [guid]::NewGuid().ToString('N'))
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $traceDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
& "$traceDeploy/CodeWeaveQtShell.exe" --u3-matrix-json "$traceDeploy/evidence/matrix.json" | Out-Null
$LASTEXITCODE
```

以上构建、部署参数和矩阵入口已实际执行。复现使用新目录，避免覆盖验收证据；当前安装版本未替换，外层快捷方式仍启动安装版。

## 自审、现场与回滚

本轮开始时工作区干净，分支 `codex/project-layout-20261106`，基线提交 `efa0802`。仅修改应用端源码、测试和工程证据，没有远程写操作，没有读取或修改 `工作区/`。矩阵用 QTemporaryDir 隔离账户/数据并自动清理；正式报告和截图保留在本目录。

[保留] 本轮临时部署 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-6-20261108-deploy-8f604a` 的窗口矩阵进程已正常退出，正式证据已复制。递归删除命令被自动审批审查以执行策略阻止，未绕过拒绝；目录含 Qt 运行文件与隔离测试证据，不含真实账户。后续获准清理时，先确认绝对目标仍在系统 Temp、无本轮进程占用，再只删除这一准确目录；不清空共享 Temp。上一 P2.8 遗留目录不属于本轮，未改动。

已检查 Diff、账户/任务代次、空态、源码版本、纯文本输出、QML 注册、测试强度和目录规则。未把其它模型结论或历史测试当成本次证据。

工程知识库 README 与执行标准已读取；按 CodeWeave、Qt、QML、draftSaving 检索项目索引/模式/复盘无命中。未写正式错误复盘，具体失败与修复保留在本说明。

回滚：保护后来产生的用户修改后，执行 `git revert <本检查点提交>` 并重跑标准构建。没有新增存储格式和迁移，无需删除或重写账户 trace。

下一入口：其它语言源码节点与变量快照的真实执行契约及程序状态图绑定；P2.9 的正式资料库和网页视觉等价保留待办。

## 2026-11-08 续验：源码快照真实窗口断言

- 修正隔离窗口夹具：草稿保存断言与两行 Python 程序一致；选择源码快照检查后恢复末事件，再单独验证上一事件回到开头、下一事件到达输出节点。
- [通过] 再次执行 `cmd /c 工程文件\工具\构建当前Qt.cmd`：Release 构建成功，CTest 10/10。
- [通过] 使用当前构建重新部署并执行可见窗口矩阵：`matrix.json` 198/198，52 张截图，进程退出码 0；新增 `python-source-snapshot-line-and-local-variable` 检查、回看按钮检查及 `qml-no-warnings` 全部通过。矩阵与同名截图已归档在本目录。
- [先失败，修复后通过] 首轮新矩阵发现 `draft-save` 仍断言旧的单行源码；同时源码快照检查改变了当前事件，导致前后按钮测试从错误索引起步。更新保存内容断言，并在快照检查后恢复末事件，完整矩阵复测通过。
- [未执行] C++、Java、JavaScript 源码快照、实时流式执行、正式账户/资料库联调和网页端视觉等价仍未覆盖。

复现时先用标准命令构建，再部署到新目录；部署成功后创建报告目录并运行矩阵：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$traceDeploy = Join-Path $env:TEMP ('CodeWeave-P2-6-repro-' + [guid]::NewGuid().ToString('N'))
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $traceDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
New-Item -ItemType Directory -Path (Join-Path $traceDeploy 'evidence') | Out-Null
& "$traceDeploy/CodeWeaveQtShell.exe" --u3-matrix-json "$traceDeploy/evidence/matrix.json" | Out-Null
$LASTEXITCODE
```

最终归档 `matrix.json` SHA-256：`8185E828D24F7ACEC13E018EE5B63E116E4BE63A29E126B13D3152B203CCE101`。隔离部署位于系统临时目录；测试账户与数据由 `QTemporaryDir` 管理，不读取或写入真实工作区。部署提示缺少可选 `dxcompiler.dll`/`dxil.dll`，本次矩阵仍通过。

## 临时目录

- [未清理] 本轮隔离部署及失败尝试目录：`C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-6-20261108-verified-94214a57dd18471eb2840f6e140bc74b`（通过矩阵部署）、`C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-6-20261108-next-2e68c5317f4e4dc99824522bd599ae74`（首次矩阵失败记录）、`C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-6-20261108-verified-10bd5299323d48f4bf093aaba7401ea4`（部署前输出目录误创建后被脚本拒绝）。矩阵应用进程均已退出。
- 对以上准确目录执行清理时，工具执行策略拒绝了递归删除命令；没有删除任何内容或改用其它删除方式。目录只在系统 Temp 下；后续清理前应重新确认准确路径、用途和进程占用，不要清空共享 Temp。
