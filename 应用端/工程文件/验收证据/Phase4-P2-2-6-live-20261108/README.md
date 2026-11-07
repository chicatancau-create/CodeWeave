# P2.6 实时执行事件

日期：2026-11-08。前序提交 `9fb9e9f`。本检查点完成运行中事件接入；P2.6 的模块快照、源码级控制、视觉等价及整个修缮仍未完成。

## 实现与边界

- `ProcessRunner::Observer` 在执行线程每 50ms 提供新增输出和控制事件，空闲时仍触发轮询，进程树退出并排空 I/O 后再做最终发布。读取线程和控制线程各自用互斥锁保护数据，不在持锁状态调用 observer。
- `ExecutionService` 增量读取快照 JSONL，只发布完整行，保留原来的 512 步、单步 8 KiB、合计 256 KiB 限制。C++ 输出仍从隔离文件读取，避免混入 GDB 诊断；既有 20ms 限量监控不变。
- `Trace::Observer` 同步接收成功追加的事件，序号连续，与返回的最终 Trace 一致；回调需保持轻量且不抛异常。Qt observer 只写互斥队列，由界面线程每 50ms 批量更新；任务 ID、账户代次和文档保护阻止旧结果串入新状态，完成时停表并用同一次运行的最终轨迹替换，不再重复追加。
- 学习程序的真实 stdout 缓冲语义不变，只有已经写出/flush 的字节才可实时显示。跨批次 UTF-8 尾部和 CRLF 延后到完整边界再发布；程序结束时保留剩余原始字节。纯源码变化不触发输出变化通知，避免重置已清空的控制台。
- 用户浏览旧事件时保持所选序号；End 或选择最后一项恢复跟随。沿用现有布局、令牌和空态，没有新增依赖或更改账户/学习证据格式。
- JavaScript 普通脚本解析失败时，在学习代码执行前写回退标记并退出，不将辅助 parser 诊断作为实时学习输出；原始 Node 入口继续提供实际输出/错误。模块快照仍不支持，不在学习代码执行后重跑。
- C++ 临时目录/runner 准备失败现在发出 Failed 末事件，避免实时轨迹只留 Started；缺失 TEMP 有回归。编译诊断只在编译失败时加入轨迹，不把成功编译的 warning 冒充学习程序输出；新增带 `#warning` 的成功编译回归确认事件输出只有学习输出。其它编译错误、超时、取消继续沿用真实终态。
- 同一轮询内先采集步骤，再采集输出/控制。跨文件和管道的顺序是观察顺序，不是逐条指令的精确发生时间；正常负载下约 50ms 采集加 50ms UI 批处理，没有硬实时延迟保证。局部变量不持久化，本工具不提供不可信代码安全沙箱。

## 验证证据

- [先失败，修复后通过] 新增 Qt 实时回归在旧实现中等待运行中的输出超时，标准构建 CTest 9/10，86.47 秒；`ctest-before-streaming.txt` 保留原始日志。程序已输出并继续休眠，旧实现直到退出才返回数据。
- [先失败，修复后通过] 第一轮接入后 Qt 已通过，原生新增清理断言失败，CTest 9/10，87.74 秒；`ctest-first-streaming.txt` 保存日志。Fixture 自带 `config/codeweave.config.example.json`，实际运行文件已清理；改用独立 `stream-execution/` 验证其完全为空，保留原清理强度。
- [通过] 最终 `cmd /c 工程文件\工具\构建当前Qt.cmd`：Release、CTest 10/10，91.46 秒，原始 `ctest-final.txt` 保留本机编码。四种语言的真实快照与输出在程序退出前到达，observer 立即取消仍在休眠的程序；回归逐项比较 observer 和最终 Trace 的顺序、载荷、单一 Cancelled 末事件及执行目录清理。
- [通过] Python 每 120ms 只写出一个 UTF-8 字节或 CR/LF 的回归，最终字节保持一致，事件不会拆开中文字符和 CRLF；旧语言边界、输出/采样上限、退出码、超时和取消测试仍通过。
- [通过] Qt facade 在 Python 休眠期间读到实时输出，随后读到变量从 15 到 16 的变化；只有源码变化时输出通知数不变。既有账户/文档清空、草稿修订、异常、取消与关闭回归均通过。
- [通过] 最新 EXE 的隔离真实窗口 `matrix.json`：210/210、56 张截图、退出码 0、QML 无警告。新增四项覆盖运行中快照和输出、实时暂停事件、浏览保留、End 跟随；`u3-execution-trace-live.png` 已人工检查，无新增遮挡。只归档关键截图，报告中的其余截图路径属于临时部署。
- [通过] 应用端 `corepack pnpm check`（77 源码文件）、`corepack pnpm test` 4/4、根目录 `node 工程文件/工具/check-layout.mjs`、`git diff --check`。
- [未执行] 高负载延迟基准、指令级精确顺序、JavaScript 模块快照、源码级暂停/单步、非当前工具组合、正式用户资料库和网页端同状态视觉等价；C++ 中文 TEMP/工具路径边界沿用前一检查点。

最终矩阵 SHA-256：`0F7E6D4B6C6DC605ECE9342606F0EFC864E0B113AE62F6962DEF24D329618341`。

部署与当前构建 EXE SHA-256：`848036C7332705500051B742355E54288683A8C79371FAD15976250116EADCDE`。

## 运行与复现

在仓库根目录、有交互桌面的 PowerShell 执行。以下构建、部署参数和窗口命令已实际执行；目录名按复现时唯一命名。

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$liveTraceDeploy = Join-Path $env:TEMP ('CodeWeave-LiveTrace-repro-' + [guid]::NewGuid().ToString('N'))
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $liveTraceDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
New-Item -ItemType Directory -Path (Join-Path $liveTraceDeploy 'evidence') | Out-Null
& (Join-Path $liveTraceDeploy 'CodeWeaveQtShell.exe') --u3-matrix-json (Join-Path $liveTraceDeploy 'evidence/matrix.json') | Out-Null
$LASTEXITCODE
```

当前安装版和启动链接未替换；窗口矩阵使用临时隔离账户/资料库。最终窗口复验在同一次临时部署中替换本次 EXE，使用独立 `evidence-compiler-final/` 输出目录，确认矩阵进程退出后才替换。

## 临时资源与自审

- [保留] 本次部署 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-LiveTrace-20261108-1794094232007`：矩阵进程已退出，报告、关键截图和原始 CTest 日志已归档，保留完整部署便于复现，没有创建仓库外产品副本。
- [未清理] 本次原生断言失败留下 `C:/Users/Admin/AppData/Local/Temp/codeweave-native-core-fixture-3588965333`，已只读确认仅有自动生成的配置夹具。对该准确目录的递归清理被自动审批返回 `blocked by policy` 拒绝，命令未执行，未换方式绕过。其它来源不明临时目录未清理；成功回归的执行目录由 RAII 清理并断言验证。
- 后续清理以上目录前，重新核对完整路径、用途及占用，仅删除本次对象；不清空系统 TEMP 或前序证据目录。
- 已检查最终差异、线程数据访问、增量偏移、完整 JSONL、输出编码、取消/终态、旧语言回归、Qt 界面线程及账户/任务过滤；没有改动根 AGENTS.md、布局检查器、依赖锁文件或真实 `工作区/`，没有远程写入。
- 工程知识库 README/执行标准已读，无匹配的项目/GDB/MinGW/CTest 正文；本次未写正式错误复盘，也未修改记忆库。

回滚：保护后续用户改动后执行 `git revert <本检查点提交>`，再运行标准 Qt 构建；无需迁移或删除学习数据。下一步继续核对 P2.6 剩余能力与两端同状态视觉差异，不将本检查点标为整体完成。
