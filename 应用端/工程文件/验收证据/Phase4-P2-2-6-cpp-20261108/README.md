# P2.6 C++ 源码行与局部变量快照

日期：2026-11-08。当前检查点已实现 GNU C++/同目录 GDB 的真实源码快照；P2.6 和整个修缮仍为部分完成。

## 契约与决策

- GNU 编译入口改为真实源文件并加 `-g`，寻找编译器同目录的 `gdb.exe`。未找到调试器时保留直接执行；非 ASCII 工具/系统 TEMP 路径在学习程序执行前选择直接运行，不在执行失败后重跑学习程序。
- GDB 的 Windows `-x` 路径解码不支持本次中文执行目录，调试源码、EXE、runner 和快照因此放在系统 TEMP 的一次性 ASCII 子目录。编译和学习程序仍使用原 cwd，`-iquote` 保留相对头文件查找；清理由 RAII 执行。
- GDB 禁用自动加载，Python runner 只在学习源文件真实可执行行采样。最多 4096 个断点、512 次采样、16 个局部变量、128 字符变量名、160 字节字符串、单步 8 KiB、合计 256 KiB；达到采样上限关闭断点并继续程序。
- 原始标量直接读取，对象显示 `<object>`，不调用学习对象运算符或求值方法。已知 libstdc++ 字符串只读受限内存并保留内嵌 NUL，字符数组按 C 字符串终止，未知布局不展开。
- 学习程序 stdout/stderr 单独重定向到 `program-output`，不混入 GDB 诊断。原生监控每 20ms 检查大小，超限停止进程树，返回至多允许的字节数；缺失/无法读取的输出不记为有效。临时磁盘写入可能在两次轮询之间超过上限，不宣称磁盘配额隔离。
- 返回真实退出码，包括非零退出及 Windows 状态 `0xC0000005`；沿用 ProcessRunner 的 Job 超时/取消进程树控制。GDB 暂停/单步返回不支持，通过 RAII 解除控制回调，不把挂起 GDB 误报为学习程序已暂停。
- `ProcessPlan.environment_path_prefix` 是带默认值的子进程环境选项；C++ 编译/GDB/直接执行的 PATH 前置工具链目录，以查找工具链 DLL，不修改宿主或系统 PATH。
- 沿用 SourceStep/facade/QML 回看契约，快照仅运行结束后返回，不写入 TraceStore。没有新增依赖、账户格式或用户数据迁移。

## 实际验证

- [通过] 标准命令 `cmd /c 工程文件\工具\构建当前Qt.cmd`：Release 与 CTest 10/10，88.11 秒。`ctest-final.txt` 保留原始本机编码，包含 10 项 Test Passed。
- [通过] 原生测试覆盖真实源码行/变量、正常输出、退出 7、Windows 异常状态、对象不求值、字符串内嵌 NUL、输出/采样/字节限制、中文及空格 cwd、相对头文件/输出、超时、取消后 tick 文件不再更新、临时执行目录清理、GDB 暂停明确失败及直接运行时 DLL 查找。
- [通过] 最终真实窗口矩阵 `matrix.json`：206/206、55 张截图、退出码 0、QML 无警告；`u3-cpp-source-snapshot.png` 已人工核对，第 5 行、`total = 15` 与最终输出 `15` 均可见。只归档本检查点关键截图，其余截图路径属于临时部署，不保证长期存在。
- [先失败，修复后通过] `matrix-initial-failed.json` 两项失败：新截图加入后总数仍断言 54；前面的专用 100ms 超时未恢复，影响后续 JavaScript 课程练习。现将截图数同步为 55，并在超时测试结束后恢复 5000ms，保留后续原断言。`before-timeout-restoration.png` 为原始失败现场。
- [通过] 应用端 `corepack pnpm check`、`corepack pnpm test`（4/4）、根 `node 工程文件/工具/check-layout.mjs` 与 `git diff --check`；文档收尾后再次执行。
- [基线失败] 当前 MinGW 汇编器在中文 TEMP/TMP 下失败，设置 TMPDIR 也不能覆盖该行为。回归在相同环境比较旧 stdin 编译入口与本次直接执行分支，二者均编译失败且失败输出仍有效呈现；另行生成的 MinGW EXE 验证最小 PATH 下的 DLL 前缀可正常运行。未将“选择直接运行”记录为已解决中文 TEMP 编译问题。
- [未执行] 其它 GDB/编译器组合、非当前 libstdc++ 布局、源码级暂停/单步、实时流式事件、JavaScript 模块快照、正式账户/资料库和网页同状态视觉等价。本工具不是执行不可信代码的安全沙箱。

最终报告 SHA-256：`A96A0E637F817B9637F64876EE451669E42249B0251D3D31232DCC0565A41A7E`。

部署与当前构建 EXE SHA-256 均为：`15B0E81039B3C3297BA044DDEB780E6D47E5B6D6019ED8F19E2975883DD61619`。

## 复现

在仓库根目录、有交互桌面的 PowerShell 执行；当前安装版和启动链接未替换，窗口矩阵使用 QTemporaryDir 隔离账户/资料库。

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$cppTraceDeploy = Join-Path $env:TEMP ('CodeWeave-CppTrace-repro-' + [guid]::NewGuid().ToString('N'))
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $cppTraceDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
New-Item -ItemType Directory -Path (Join-Path $cppTraceDeploy 'evidence') | Out-Null
& (Join-Path $cppTraceDeploy 'CodeWeaveQtShell.exe') --u3-matrix-json (Join-Path $cppTraceDeploy 'evidence/matrix.json') | Out-Null
$LASTEXITCODE
```

以上入口和参数已在本次检查点实际执行；生成目录名按复现时唯一命名。

## 临时资源

- [已清理] 本检查点创建的四个输出/退出码/重定向/Unicode 探针目录已核对并删除；没有清理前序检查点来源不明的探针或失败测试夹具。
- [保留] `C:/Users/Admin/AppData/Local/Temp/CodeWeave-CppTrace-final-20261108-a8b1157066bd4736b0e498e027abd6fd` 为本次 Qt 部署目录。矩阵进程已退出，最终矩阵、关键截图、CTest 日志已归档，报告与 EXE 哈希已核对。
- 对上述准确目录的递归清理被自动审批拒绝，返回 `blocked by policy`，命令未执行，未更换删除方式绕过。目录含 Qt 依赖和隔离测试证据；后续清理应再次核对完整路径及占用，只删除本次目录，不清空系统 TEMP。

## 自审与恢复

前序检查点为 `6bf12ad`，接手时已有 C++ 实现的未提交修改，逐项核对并续作，未恢复用户文件。范围仅为应用端执行服务、runner、测试、工作台能力提示及工程记录；未修改根 AGENTS.md、布局检查器、依赖锁文件或真实 `工作区/`，无推送或其它远程写入。

已复查实际行号来源、局部变量读取、输出隔离与边界、异常/退出码、进程树取消、路径回退、工具链 DLL 环境及旧语言回归；前序独立只读审查意见已处理，并对最终差异复查。当前已执行验证范围内未发现已知阻断问题，不能据此宣称 P2.6 完整调试能力或两端视觉等价。

工程知识库 README/执行标准已读，按 CodeWeave/GDB/MinGW/中文路径/CTest 检索无相关正文，未写正式错误复盘。

回滚：保护后续用户修改后执行 `git revert <本检查点提交>`，再运行标准 Qt 构建；无需删除学习数据。下一入口为实时执行事件流，随后继续 P3 和同状态视觉验收。
