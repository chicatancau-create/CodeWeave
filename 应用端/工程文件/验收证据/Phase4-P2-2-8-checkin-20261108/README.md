# P2.8 侧栏打卡日历与复习角标

日期：2026-11-08。完成本机功能验收，不代表 Phase 4 全部完成或与网页端视觉等价。

## 数据契约与决策

- 每个账户的学习目录保存 `learning/checkin.v1.json`，格式为 `{"schemaVersion":1,"dates":["YYYY-MM-DD"]}`。本地日期与网页端 `use-checkin.ts` / `date-helpers.ts` 一致；浏览器与原生存储互相独立，不迁移真实用户记录。
- 日期严格校验、排序去重；连续天数从今天或昨天向前数，上限 3650 天。按发起打卡时的本地日期写入，界面按当前本地日展示。
- 文件上限 1 MiB；写入先获取 QLockFile，再读取、合并并通过 QSaveFile 原子替换，禁止直接写入降级。相同日期不重写。损坏、非法日期、不支持版本与不可写条件均保留原文件并报告错误。
- 拒绝相对路径、符号链接及 Windows reparse point。写入期间禁止切换账户/关闭；账户代次和任务 ID 防止迟到结果污染新账户。
- 复习角标消费实际排期，切换课程保留账户汇总，切换账户清除汇总和旧复习项。30 秒定时检查本地跨日并刷新状态；没有学习时长与到期任务分母时继续显示空态。
- 日历复用 ShellPopup，支持切月、方向键/Home/End、Esc、外部点击及关闭归焦。窗口最小支持尺寸是 1100×720。

## 验证

| 检查 | 结果 |
| --- | --- |
| 根目录 `cmd /c 工程文件\工具\构建当前Qt.cmd` | [通过] Release 构建、CTest 9/9，最终 43.38 秒 |
| `CodeWeaveQtShell.exe --u3-matrix-json <绝对路径>` | [通过] 176/176，42 张截图，QML 无警告 |
| 应用端 `corepack pnpm check` / `corepack pnpm test` | [通过] 源码/发布边界与脚本语法、Node 4/4 |
| 根目录 `node 工程文件/工具/check-layout.mjs`、`git diff --check` | [通过] |

存储与 facade 测试覆盖缺失文件、重复日期不重写、闰日与连续跨日、断签、账户隔离、重复点击、写入锁冲突及重试、损坏/非法文件拒绝覆盖、路径错误、账户切换与关闭写入保护。窗口矩阵包含全部既有回归及新增访客禁用、打卡写入与禁用、到期角标、日历键盘/切月/关闭/归焦、损坏文件保护与修复重试、最小窗口边界。1 MiB 大小上限及 reparse point 保护经过代码检查，未补专项运行测试。

人工检查 `u3-checkin-sidebar.png`、`u3-checkin-calendar.png`、`u3-checkin-error.png` 与 `u3-checkin-narrow.png`。初轮最小窗口截图发现月末与底部累计说明裁切，原断言只检查当天日期；已增加窗口高度约束和累计说明完整边界断言，重新构建并通过矩阵。日历截图包含切到次月状态。仅确认布局与交互，不宣称网页端视觉等价。

## 复现与环境边界

从仓库根目录、交互桌面的 PowerShell 执行；以下构建、部署与矩阵入口均已实际执行：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
$reproDeploy = Join-Path $env:TEMP ('CodeWeave-P2-8-repro-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $reproDeploy | Out-Null
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $reproDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
& "$reproDeploy/CodeWeaveQtShell.exe" --u3-matrix-json "$reproDeploy/evidence/matrix.json" | Out-Null
$LASTEXITCODE
```

- 构建仍提示缺少可选 Vulkan 头，部署提示 dxcompiler/dxil 未找到；部署和实际窗口通过，未声称已解决环境提示。
- [未执行] 正式账户与资料库、网页端同状态视觉等价、Android、系统时区运行期间切换、排队写任务跨午夜专项。
- 当前安装版本没有替换；外层启动链接仍指向安装版，不保证包含本次源码变更。

## 现场、自审与回滚

矩阵使用 QTemporaryDir 隔离账户和数据，退出后自动清理；没有使用 `工作区/`、远程写操作或新依赖。正式矩阵和截图保留在本目录。已检查账户/任务代次、忙碌门禁、损坏保护、日期口径、目录规则与 Diff。

[保留] 以下两个本轮专用临时部署均已结束运行；检查过其绝对路径在系统 Temp 内且属于本任务，但 Remove-Item 清理命令被执行策略拒绝，未绕过拒绝。目录含 Qt 运行文件及隔离验收证据，不含真实用户账户；不影响仓库构建。后续获准清理时仅删除下面两个准确目录，不清空共享 Temp：

- `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-8-20261108-deploy`
- `C:/Users/Admin/AppData/Local/Temp/CodeWeave-P2-8-20261108-recheck-ddd667d41ff44a8ba1d5e07d20299671`

工程知识库 README 与工程执行标准已读取；按 CodeWeave、Qt、QML、QLockFile、QSaveFile 检索相关目录未命中。本次未写错误复盘，日历问题与验证保留在本证据说明中。

需要回退时，先保护后来产生的用户改动，执行 `git revert <本检查点提交>`，重新运行标准构建。新增 JSON 可由旧版忽略，无迁移或真实记录重写；不要删除用户打卡数据。

下一入口：P2.6 程序状态图真实执行事件与变量接入。
