# P2.9 证据写回与资料库进度

日期：2026-11-08。本记录证明隔离工作区的功能验收，不代表正式账户/资料库联调或与网页端视觉等价已完成。

## 验收范围

- 账户页连接资料库后显示目录名称；绑定资料库拥有者必须显式确认，绑定记录按本机账户隔离。
- 隔离账户展示待写回与已同步证据、只读资料库进度、写回预览、事务状态和目标文件。
- 提交必须再次确认并携带预览指纹；资料库第三方修改、重复提交、损坏事务和不安全路径均拒绝覆盖。
- 写回事务保存备份和逐步状态，支持崩溃后续交、确认后回滚、旧证据补录不倒退最新进度，以及已有日志追加。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `cmd /c 工程文件\工具\构建当前Qt.cmd` | [通过] Release 构建，CTest 10/10；包含 `qt-vault-writeback` |
| `CodeWeaveQtShell.exe --u3-matrix-json <绝对路径>` | [通过] 197/197，52 张截图，`qml-no-warnings` 通过 |
| 应用端 `corepack pnpm check` | [通过] native boundary/release audit 与脚本语法检查 |
| 应用端 `corepack pnpm test` | [通过] Node 4/4 |
| `node 工程文件/工具/check-layout.mjs` | [通过] 三端目录和启动入口布局通过 |
| `git diff --check` | [通过] 无空白错误 |

## 复现命令

从仓库根目录的交互式 PowerShell 执行：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$deploy = Join-Path $env:TEMP ('CodeWeave-P2-9-20261108-final-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $deploy | Out-Null
& 应用端/项目/native/ui-qt/deploy-qt.ps1 `
  -Exe G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe `
  -OutputDir $deploy `
  -QmlDir G:/CodeWeave/.local/app/native/ui-qt/qml `
  -ContentDir G:/CodeWeave/.local/app/native/content `
  -ConfigDir G:/CodeWeave/.local/app/config `
  -QtBin G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin
& (Join-Path $deploy CodeWeaveQtShell.exe) --u3-matrix-json (Join-Path $deploy matrix.json) | Out-Null
Get-Content (Join-Path $deploy matrix.json)
```

最终复测使用的构建 EXE 与隔离部署 EXE SHA-256 均为：
`719F65E6984428ACC40FBE6BE5C50A4CD10B2E59FD739E75920B26064A22FEE0`。

## 截图

本目录保留矩阵报告 `matrix.json` 和 52 张 `u3-*.png` 截图。人工检查了 `u3-vault-connected-name.png`、`u3-vault-evidence-preview.png`、`u3-vault-confirmation.png`、`u3-vault-ledger-narrow.png` 与 `u3-vault-rolled-back.png`：资料库名称、只读预览、确认复选框、事务目标及回滚状态可读，深色主题复选框有清晰边界。

`matrix-initial-failure.json` 保留初轮 196 项矩阵的失败证据：自定义按钮 `enabled` 属性读取及面板滚动定位修正后，最终 197 项全部通过。初轮报告中的临时截图路径不作为本次最终验收入口；最终 `matrix.json` 的截图按文件名对应本目录同名文件。

存储回归曾因跨日期批次中新日志标题复用最新课程名而失败；标题已改为各自日志分组的日期和课程名，专门回归及完整 CTest 随后通过。

## 未执行与风险

- [未执行] 正式用户账户/资料库联调、目录选择器跨重启人工验证、写入期间杀进程恢复、Windows 文档目录受控文件夹/权限专项，以及网页端同状态视觉差异比较。
- 构建仍提示可选 Vulkan 头缺失，部署仍提示未找到 `dxcompiler.dll`/`dxil.dll`；当前部署与矩阵运行不受影响，未将这些环境提示冒充为已解决。
- 未使用或修改 `工作区/`，没有替换外层安装版本或执行远程写操作。

## 回滚

源码回滚使用本次检查点提交的 `git revert <commit>`，然后重新运行标准 Qt 构建。运行时资料库事务由界面“确认回滚”恢复，第三方修改时会停止并保留现场。

工程知识库 README 与工程执行标准已读取；按 CodeWeave、Qt、QML、QLockFile、QSaveFile 检索未命中直接相关复盘。本次未写入错误复盘。

## 临时资源与自审

[保留] 以下目录是本任务的隔离部署或失败部署输出，相关应用进程均已退出。精确目录清理命令被执行环境策略拒绝，未绕过；目录不含真实账户数据。仅在确认不再需要且获准清理后删除这些准确目录，不清空共享 Temp。

- `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-9-20261108-final-a1b700328c17483bac27472d51fa3c01`
- `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-9-20261108-final-acc91f1a1309408e9dcf28cd66f19dd2`
- `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-9-20261108-final-b069415470074339ba58471a7fa5c8d3`
- `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-9-20261108-final-b72e5d`
- `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-9-20261108-final2-c8814f`
- `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-9-20261108-verify-a31c7b`

已复查账户与任务代次、写入期间账户切换和关闭保护、预览指纹、第三方冲突、逐步恢复记录、原文件备份、路径白名单、损坏保护、差异范围与敏感信息。未新增依赖，不改变既有公共接口或执行不可逆迁移。在当前已执行的验证范围内，未发现已知阻断问题。

下一入口：P2.6 源码节点与变量快照的真实执行契约。
