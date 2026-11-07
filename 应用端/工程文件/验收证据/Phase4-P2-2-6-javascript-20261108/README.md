# P2.6 JavaScript 源码快照检查点

日期：2026-11-08。本检查点扩展 Python 之后的 JavaScript 普通脚本快照；整个修缮目标和 P2.6 仍为部分完成。

## 契约与决策

- `native/src/javascript_trace_runner.hpp` 使用 Node 内建 `inspector.Session`，在本子进程连接，不打开 TCP 监听端口。仅为本次学习源码建立实际可停靠的断点，每行至多一个、最多 4096 行；从暂停事件读取源码行和作用域属性。
- 直接执行 `vm.Script`，保留原 stdin 的全局 `this`、`var`、shebang、相对 require、require.resolve 和 stdin 文件名语义。隔离目录只放 runner、源码、标记及快照；运行工作目录保持原值。来源文件用于 Inspector 定位，错误堆栈因此会显示临时源码路径。
- `vm.Script` 不能解析的模块语法/顶层 await，在学习代码尚未执行时写入专用标记；原生服务仅在非取消、非超时失败后使用原有 Node stdin 入口运行。原生 Node 继续决定是否接受语法，真实语法错误仍失败；此路径没有源码快照，不先执行再重试学习代码。
- 变量只读取作用域自有数据属性；标量和截断字符串原样文本化，其他对象为 `<object>`。不展开对象、不执行 getter，不调用学习代码的求值/转换方法。全局作用域过滤运行前已存在的宿主名称；宿主内建名称的局部遮蔽有回归。
- 最多 16 个变量，变量名 128 字符，字符串 160 字符；单步最多 8 KiB、最多 512 次暂停采样、总量 256 KiB，达到上限停止停靠，继续运行学习代码。仅记录源码范围，不收集包装器/生成位置。
- 复用 JSONL/SourceStep 和 facade 回看契约，临时目录由 RAII 清理；源码快照不写入 TraceStore。事件在运行结束后交付，现有控制仍是进程暂停/恢复/短间隔运行，不是源码单步。
- 行号栏从 TextArea 实际源码位置计算行距，并跟随其垂直滚动；保持原字号和设计令牌，没有新增依赖、接口/存储格式变更。

## 验证

- [通过] 根目录 `cmd /c 工程文件\工具\构建当前Qt.cmd`：Release 构建与 CTest 10/10，38.09 秒。原始日志见 `ctest.txt`（保留 CTest 生成的本机编码）。
- [通过] 原生测试覆盖真实源码行/变量、异常非零退出、语法失败、相对 require、shebang 行号、全局 this/var、宿主名称遮蔽、异步回调、ES module / await 回退、getter 不调用、512 步和字节边界、超时、每次执行后的临时目录清理。
- [通过] facade 现覆盖 Python 和 JavaScript 的非空源码行/变量；原有“运行失败不能新增练习成功事实”的回归保留。
- [通过] 最终可见窗口矩阵 `matrix.json`：202/202、53 张截图，退出码 0、QML 无警告。新增第 5 行与 `total = 15`、源码边界和代码/行号位置断言；人工复核最终 `u3-javascript-source-snapshot.png`，宿主 Symbol 已移除。只归档关键截图，报告中其它截图路径属于临时部署，不作为永久链接。
- 最终报告 SHA-256：`9FF1C4EC0E6F1683E3832685B60F964223906EC26383475613BDB15E2F401DDE`；最后复验部署 EXE 与当前构建 EXE 的 SHA-256 均为 `293E1C0A29A7535F62D6B6A48A47FCCDD913287595C50C294DB577FA02B8C01D`。
- [通过] 应用端 `corepack pnpm check`、`corepack pnpm test` 4/4、根目录布局检查及 `git diff --check`。
- [未执行] Java / C++ / JavaScript 模块源码快照、实时流式事件、网页端同状态视觉等价、正式用户资料库、Android。当前支持不等于完整调试器，也不是运行不可信代码的安全沙箱。

## 失败与修复

- 初始实现将学习代码放在 Inspector 回调中运行，异常被回调机制吞掉，既有 facade 测试发现运行失败也新增练习事实。执行移到回调之外，实际异常保留非零退出，原断言重新通过。
- 模块函数包装改变 stdin 的顶层 this/var、相对 require 和 shebang 语义，截图还暴露一个额外的第 6 行结束事件。最终改为直接脚本执行和正确的 stdin 模块上下文，模块解析失败回到原入口；补兼容性和源码边界回归。
- 截图发现行号栏 1.4 倍行距与代码默认行距不同。改为真实行距并同步滚动，窗口回归核对第 5 行代码位置；没有修改源码行号去迎合错误显示。
- 最终截图复核发现全局作用域混入 Node 宿主 Symbol 属性；Inspector 的属性列表包含符号键，而运行前的普通名称集合不包含。现排除 Symbol 属性，并在 native/窗口断言中验证不会混入学习变量列表。
- `before-symbol-filter.png` 保留修复前的人工观察证据，不作为最终通过截图。
- 构建的可选 Vulkan 头提示、部署的 dxcompiler/dxil 缺失提示仍存在，未声明已修复。

## 复现与现场

从仓库根的交互桌面 PowerShell 执行，工具链来自当前本机配置：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$jsTraceDeploy = Join-Path $env:TEMP ('CodeWeave-JsTrace-repro-' + [guid]::NewGuid().ToString('N'))
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $jsTraceDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
New-Item -ItemType Directory -Path (Join-Path $jsTraceDeploy 'evidence') | Out-Null
& (Join-Path $jsTraceDeploy 'CodeWeaveQtShell.exe') --u3-matrix-json (Join-Path $jsTraceDeploy 'evidence/matrix.json') | Out-Null
$LASTEXITCODE
```

构建和部署命令已实际执行，不覆盖安装版或启动链接。测试账户/资料库由 QTemporaryDir 隔离，不读取或修改真实 `工作区/`，没有远程写入。前一 Python 检查点 `d166376` 之后的 JavaScript 变更在当前分支续作，任务开始时这些变更未提交，已保留并完成验证。

## 临时目录

- [未清理] 本次隔离部署 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-JsTrace-final-20261108-2ae1191819f34c79a76bd0487ffd0915` 和 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-JsTrace-accepted-20261108-ab5790d610984f00876e821ed5556c4e`。窗口矩阵进程均已正常退出；正式报告、CTest 日志、最终/修复前关键截图已复制到本目录。
- 自动审批审查拒绝了对以上两个准确目录的递归删除，工具返回 `blocked by policy`，命令未执行；没有改用其它删除方式。保留 Qt 运行依赖和隔离取证文件，不包含真实账户。后续清理时应先核对绝对路径仍在系统 Temp、用途和占用，再仅清理这两个目录，不清空共享缓存。
- 续作前已有部署 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-JsTrace-20261108-fe7a91b0509f47c1817c0763daf8b69a` 保留，未删除。之前 Python 检查点的清理拒绝与目录清单仍见其证据说明。

## 自审与恢复

检查源码/调用方/测试 Diff、错误退出、旧 Python 路径、对象访问、输出界限、取消/超时、临时目录和 QML 纯文本展示。没有升级依赖或迁移用户数据；没有削弱现有门禁。工程知识库 README、执行标准已读取，按 CodeWeave/Qt/QML/Inspector 检索无匹配正文，未写正式复盘。

回滚：保护后来产生的用户改动后执行 `git revert <本检查点提交>`，再运行标准 Qt 构建。无需重写账户/学习数据，不用 reset/clean。

下一入口：Java 的真实调试行与受限局部变量快照；随后仍需 C++、事件流和网页同状态视觉验收。不得将本检查点标为全部修缮完成。
