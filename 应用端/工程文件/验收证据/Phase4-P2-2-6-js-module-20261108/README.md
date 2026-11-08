# P2.6 JavaScript 模块源码快照

日期：2026-11-08。前序提交 `3cdb832`。本检查点补齐 JavaScript ES module 与顶层 await 的源码快照；P2.6 和整个修缮仍为部分完成。

## 契约与决策

- 普通脚本继续使用 `vm.Script`；仅在执行前发生语法解析失败时，使用 Node 内建 `Module.registerHooks` 将原始源码作为模块加载。Inspector 复用真实源码断点，新增 module scope 的受限变量读取；不包装或重复执行学习代码，不开放调试监听端口。
- 模块入口 URL 与 Node stdin 的 `[eval1]` 一致，保留相对导入的 cwd、`import.meta.filename/dirname` 和模块顶层 `this === undefined`，移除普通脚本专用的全局 require/module 等名称。相对 CJS 默认导入有回归。
- 模块导入/运行异常保持非零退出，`process.exit(7)` 保持退出码 7；未完成且无待处理事件的顶层 await 以 13 退出。缺少 `Module.registerHooks` 时沿用执行前标记及原始 Node 入口，不宣称此环境具有模块快照；该兼容路径尚未专项实测。
- 变量只读作用域自有数据属性，不展开对象、不调用 getter，不将局部变量写入 TraceStore。沿用 16 个变量、512 次采样、单步 8 KiB 和合计 256 KiB 上限，以及现有增量事件流；输出和步骤仍按轮询观察顺序发布，不承诺指令级精确顺序。
- facade 回归检查完整输出拼接、连续序号、源码事件及唯一终态。实时采样允许输出之后继续出现源码事件，因此不再要求 output 固定为倒数第二项。
- 没有新增依赖、公共接口或存储格式变化。源码级暂停/单步尚未实现，现有进程控制不等于源码调试命令。

## 验证证据

- [先失败，修复后通过] `ctest-before-module.txt`：新断言在原实现中未找到模块第 2 行源码事件，证明原入口只有模块输出。加入模块追踪后通过。
- [通过] 标准 `cmd /c 工程文件\工具\构建当前Qt.cmd`：本轮续作复验 Release 与 CTest 10/10，93.93 秒；`ctest-final.txt` 保存复验原始日志（本机编码）。原生回归覆盖模块行号/变量、顶层 await、缺失导出、运行异常、退出 7、未完成 await 退出 13、相对 CJS 导入及 import.meta；普通脚本及其它语言原有回归保留。
- [通过] 最终真实窗口 `matrix.json`：213/213、57 张截图、QML 无警告；模块输出为 `15 1`，源码第 4 行和 `total = 15` 可见。关键截图 `u3-javascript-module-source-snapshot.png` 已人工检查，只归档关键截图，其余矩阵截图位于临时部署目录。
- [先失败，修复后通过] `matrix-before-screenshot-count.json`：新增截图后总数断言仍要求 56。同步为 57 后最终矩阵通过，没有删除或跳过截图断言。
- [通过] 应用端 `corepack pnpm check`、`corepack pnpm test` 4/4，根目录 `node 工程文件/工具/check-layout.mjs`、`git diff --check`。
- [未执行] 其它 Node 版本、缺少 registerHooks 的兼容路径专项、源码级控制、指令级跨通道顺序、正式账户/资料库、网页端同状态视觉等价及 Android。本工具不提供运行不可信代码的安全沙箱。

最终矩阵 SHA-256：`97E5712DED6E66BABD08BA4D5A3F9E64F4FFFC1769CCA67AE73D65F3557962B7`。

部署和构建 EXE SHA-256：`536A364740B8F417F84378164E56A49E3BCD11ADE0B42F8AC8EB2D949702692F`。

## 运行与复现

在仓库根目录、有交互桌面的 PowerShell 执行，沿用本机 Qt 6.8.3、VS2022 和 `.local` junction。下列构建、部署和矩阵参数已经执行验证：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$moduleTraceDeploy = Join-Path $env:TEMP ('CodeWeave-JsModule-repro-' + [guid]::NewGuid().ToString('N'))
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $moduleTraceDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
New-Item -ItemType Directory -Path (Join-Path $moduleTraceDeploy 'evidence') | Out-Null
& (Join-Path $moduleTraceDeploy 'CodeWeaveQtShell.exe') --u3-matrix-json (Join-Path $moduleTraceDeploy 'evidence/matrix.json') | Out-Null
$LASTEXITCODE
```

## 现场、自审与回滚

- [保留] 完整隔离部署：`C:/Users/Admin/AppData/Local/Temp/CodeWeave-JsModule-20261108-f596141a51734cb59b104d4c435d81b5`，用于复现，正式证据已归档。此前对该目录递归删除的自动审批返回 `blocked by policy`，未绕过；本次续作未重复尝试删除。
- [保留] 失败测试隔离夹具：`C:/Users/Admin/AppData/Local/Temp/codeweave-qt-facade-tests-DvmfNO`。为前序运行产生的测试账户/中文工作区，不作为用户数据删除；本轮未清理。前序其它临时目录见各自检查点记录。
- 成功测试的执行目录仍由 RAII 清理并有断言。没有替换安装版或启动链接，没有操作真实 `工作区/`，没有远程写入。自审核对源码/调用方/测试差异、执行前回退、异常退出、变量读取、限量和终态契约。
- 工程知识库 README、执行标准已读取；按 CodeWeave/Qt/Inspector/trace 检索无匹配正文，未写正式错误复盘。

回滚：保护后续用户改动后执行 `git revert <本检查点提交>`，再运行标准 Qt 构建；无需迁移或删除账户学习数据。

下一入口：评估源码级暂停/单步与现有 ProcessControl 的契约差异，再推进工作台程序状态图和网页端同状态视觉验收。不能把本检查点作为整个修缮已完成的证据。
