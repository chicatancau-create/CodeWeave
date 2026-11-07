# P2.6 Java 源码行与局部变量快照

日期：2026-11-08。Java 使用真实 JDI 断点采集源码行、受限局部变量及未捕获异常；整个修缮目标仍未完成。

## 契约与决策

- 在现有一次性 Java 编译目录中创建 `codeweave.trace.CodeWeaveTraceRunner`，与学习源码一起通过原配置 JDK 的 `javac -g --add-modules jdk.jdi` 编译。运行和调试使用同一 JDK，不增加第三方库，要求完整 JDK（当前实测 25.0.2）。
- 使用 JDK 默认 LaunchingConnector 创建真实学习 JVM；只为 `Main.java` 的类/内部类/工作线程建立真实可执行行断点，并采集未捕获异常。标准输出和错误输出按字节转发，学习程序真实退出码返回原生层；辅助进程失败不伪装为学习成功，也不重新执行学习代码。
- JDK 本机源码已核对：默认连接器在 Windows 优先共享内存，socket 后备的默认地址为回环地址。没有配置外网地址或固定调试端口；未把静态源码核对当作网络抓包证明。
- 变量读取 JDI StackFrame 的可见局部变量；只显示原始标量/字符串，其余对象为 `<object>`，不调用对象 `toString()` 或学习代码求值方法。字符串先检查 backing array 长度，超过 1024 个元素显示 `<long string>`；短字符串最多保留 160 个 UTF-16 单元，未知布局显示 `<string>`，不完整下载任意大字符串。
- 最多 4096 个断点、512 次快照、16 个变量，变量名 128 个 UTF-16 单元，单步 8 KiB、总量 256 KiB；达到采样上限关闭请求并继续真实学习程序。沿用 JSONL/SourceStep 与回看契约，源码快照不写入 TraceStore。
- 学习 JVM 继承原生 ProcessRunner 的 Windows Job；超时/取消结束整个进程树。执行目录、runner、class 和快照由原有 RAII 清理，工作目录仍是本次 Java 编译目录。
- 编译阶段取消现在生成 Cancelled 末事件；编译失败先附诊断输出，再生成 Failed 末事件，避免界面把取消记为失败或把错误输出当成最终运行状态。
- 当前仍在运行结束后返回快照；暂停/继续/短间隔“单步”未变成源码调试命令。C++、JavaScript 模块快照、实时事件流和网页端同状态视觉验收仍待后续完成。

## 实际验证

- [通过] 首轮完整 Qt Release 与 CTest 10/10，63.64 秒；包含普通变量行号、真实异常与 `System.exit(7)`、编译失败、新线程 lambda、50 万字符字符串、对象不求值、512 步与字节上限、运行超时及取消后子进程不再写 tick 文件、目录清理。
- [通过] 首轮可见窗口矩阵 204/204、54 张截图、退出码 0、QML 无警告；实际选择第 7 行，局部变量 `total = 15`，截图已人工检查。
- [通过] 应用端 `corepack pnpm check`（76 个源码文件）、`corepack pnpm test` 4/4、根目录布局检查与 `git diff --check`。
- [先失败，修复后通过] 新增编译前取消回归复现末事件仍是 Failed；原生测试二进制在对应断言退出，CTest 9/10。原始失败日志见 `ctest-first-failed.txt`。修复取消分支与诊断/末事件顺序，保留原断言；重新执行标准 Qt Release 与 CTest 10/10，61.58 秒，原始最终日志见 `ctest-final.txt`（保留 CTest 的本机编码）。
- [通过] 最新构建重新部署后的最终可见窗口矩阵 `matrix.json`：204/204、54 张截图、退出码 0、QML 无警告；第 7 行与 `total = 15` 断言通过，最终关键截图 `u3-java-source-snapshot.png` 已人工检查。仅归档关键截图，其余报告路径属于临时部署。
- 最终报告 SHA-256：`2AAAA43B1B9B1FBFC58D6199DE46AC861672705F6EDD7A57D88C80DF0D6CB657`。部署与当前构建 EXE 的 SHA-256 均为 `0AEF36F538DC3A918E86F3D2645CE0ECA41C10B632550671F0953232BFE8199F`。
- [未执行] 非当前 JDK 的兼容验证、Java 虚拟线程专项、Java 源码级暂停/单步、C++ 源码快照、实时事件流、正式账户/资料库及网页视觉等价。本工具不是执行不可信代码的安全沙箱。

## 复现

在仓库根目录、有交互桌面的 PowerShell 执行；不访问真实工作区数据：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$javaTraceDeploy = Join-Path $env:TEMP ('CodeWeave-JavaTrace-repro-' + [guid]::NewGuid().ToString('N'))
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $javaTraceDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
New-Item -ItemType Directory -Path (Join-Path $javaTraceDeploy 'evidence') | Out-Null
& (Join-Path $javaTraceDeploy 'CodeWeaveQtShell.exe') --u3-matrix-json (Join-Path $javaTraceDeploy 'evidence/matrix.json') | Out-Null
$LASTEXITCODE
```

以上参数与命令已实际执行；当前安装版和启动链接未替换。窗口矩阵使用 QTemporaryDir 隔离账户/资料库。

## 临时资源

- [未清理] `C:/Users/Admin/AppData/Local/Temp/CodeWeave-JavaTrace-20261108-9cc91e7e35824cef9f1e444ba5838825` 与 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-JavaTrace-final-20261108-33ff1ae5693140519a8c871a37e371c8` 是本次创建的 Qt 部署目录。矩阵进程均已退出，原始失败/最终 CTest 日志、最终矩阵与关键截图已归档。
- 对以上两个准确目录的递归删除被自动审批审查拒绝，工具返回 `blocked by policy`，删除命令未执行；没有绕过或改用其它删除方式。目录含本次 Qt 依赖和隔离测试证据，不含真实用户账户。
- 后续清理应先核对完整路径仍在系统 Temp、用途与占用，再仅清理上述目录；不清空共享 Temp、不触碰之前 Python/JavaScript 检查点已被拒绝清理的目录。原生测试的临时执行目录及学习 JVM 已由本次回归验证清理。

## 自审与恢复

续作基线为 `5cc573e`，开始时 Git 干净。只修改应用端执行服务、runner、测试、工作台能力提示和工程记录；未修改目录规则、公共接口、存储格式、依赖锁文件或真实 `工作区/`，没有远程写操作。

检查实际断点来源、作用域访问、异常与退出码、线程、输出、字节限制、编译失败/取消、进程树清理、旧 Python/JavaScript 回归及 QML 展示。工程知识库 README/执行标准已读，JDI/Java debug/CodeWeave 检索无匹配正文，未写正式复盘。

回滚：保护后续用户修改后执行 `git revert <本检查点提交>` 并重跑标准 Qt 构建；无用户数据迁移，无需删除学习记录。

下一入口：C++ 的真实调试行与受限变量快照；之后继续实时事件流、P3 和同状态视觉验收。
