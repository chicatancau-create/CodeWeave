# P2.6 工作台程序状态图

日期：2026-11-08。此检查点把 P2.6 已有真实执行事件接入图形状态图和变量格；源码级运行控制、网页端同状态视觉和整体修缮仍未完成。

## 行为与边界

- 状态图按当前回看事件前缀生成，节点表示来源源码行或无源码行号的真实执行/输出/终态事件；连线按真实事件顺序连接。重复访问显示回连与访问次数；同一源码行重访是事件层观测，不声明其与语法级控制流完全等价。
- 播放头只指向选中事件。向前/向后、Home/End、点击图中节点共用原事件列表索引；返回早期事件会从该前缀重算，不显示未来节点、变量或输出。结束事件展示最近一份真实源码变量快照；普通输出和控制事件不伪造局部变量。
- 课程结构标签显示内容中实际提供的流程节点及按数组顺序连线，未运行时节点明确标为未执行，不造事件序号和变量值。内容没有流程元数据时显示空态。
- 变量格按相邻源码快照名称和值比较，显示新增、变化、未变；对象维持采集契约中的 `<object>`。读取仍限制为真实快照数据，不调用对象 getter，不持久化局部变量。
- 画布采用固定节点尺寸和可视区域绘制，窄窗口及长轨迹通过内部水平/垂直滚动查看；键盘方向键、Home/End 控制事件列表，图中真实事件节点支持键盘/触屏选择。颜色与间距复用设计令牌。
- 没有引入依赖、修改 Trace/账户持久化格式或运行时数据，也没有将采样事件宣称为完整源语言控制流、指令级时间轴或源码级单步。

## 验证

- [通过] 最终 `cmd /c 工程文件\工具\构建当前Qt.cmd`：Release 构建与 CTest 11/11，92.69 秒，原始日志 `ctest-terminal.txt`；包括 `qt-execution-stage` 9 项帧折叠测试：空数据/边界、回退幂等、重复访问回连、变量变化、异常/取消、特殊名称、窄视口布局、输出后取消和无快照失败。前轮 92.62 秒日志 `ctest-final.txt` 保留为历史。
- [通过] 应用端 `corepack pnpm check`；根目录 `node 工程文件/工具/check-layout.mjs`；`git diff --check`。
- [通过] 最终真实窗口矩阵 `matrix-terminal.json`：218/218，57 张截图，隔离数据标记为 true；检查图形节点/连线/当前指针/变量格，当前项可完整留在视口，回看起点时后续节点与变量消失。新增取消末节点和失败末节点/错误文本可见断言均通过，QML 警告为空；`u3-execution-trace-cancelled.png` 与 `u3-execution-trace-failed.png` 已人工核对。前轮 `matrix.json` 为 216/216；`u3-execution-state-diagram.png` 显示第 4 行指针、4→5→6 的真实事件路径、`total = 15` 和变化标记。前序发现旧滚动位置会短暂露出错误节点、变量状态文字被挤出；保留修复前截图 `before-scroll-and-table-width.png`，最终改为同步定位当前节点并使用表格可用宽度。
- [通过] 最终构建和窗口矩阵 EXE SHA-256 相同：`B6D3733CBBE508828E1286D09737816D6F93BEA8562233999110F733DC7666F7`。`matrix-terminal.json` SHA-256：`5F9D94958A6BA3BF397AEE08956C2318A5DF0720ECBF23EF6964D3F9C095C08E`。前轮 EXE 为 `D1BC0780986D0D2725E9D01615A90621C8AE5909858EC47E47D83B4975B7AF1A`，本目录历史 `matrix.json` 当前字节 SHA-256 为 `BED7535B49B19F80B0509573F745C98CA9F96176A1E94AE37DDFF0299F7404C5`；均已重新计算。
- [未执行] 网页端/Qt 运行中同状态视觉等价、正式账户/资料库、非当前环境回归、源码级暂停/单步与 Android。此轮截图为模块代码样本，状态图仅对照可见行为，不代表与网页端同数据对比。

## 复现

在仓库根目录、有交互桌面的 Windows PowerShell：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
& '应用端/项目/native/ui-qt/deploy-qt.ps1' -Exe 'G:/CodeWeave/.local/qt/current/ui-qt/CodeWeaveQtShell.exe' -OutputDir $stageDeploy -QmlDir 'G:/CodeWeave/.local/app/native/ui-qt/qml' -ContentDir 'G:/CodeWeave/.local/app/native/content' -ConfigDir 'G:/CodeWeave/.local/app/config' -QtBin 'G:/CodeWeave/.local/prep/qt/6.8.3/msvc2022_64/bin'
& (Join-Path $stageDeploy 'CodeWeaveQtShell.exe') --u3-matrix-json (Join-Path $stageDeploy 'evidence/matrix.json') | Out-Null
$LASTEXITCODE
```

`$stageDeploy` 应是本机 Temp 下的空、唯一目录；复现用隔离账户与资料库。当前安装版和启动链接未替换。

## 现场与回滚

- [保留] 隔离部署目录 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-Stage-20261108-5e4a177a0ebd441cadca4a5c68beaa06`，含 Qt 依赖及窗口回归过程文件。窗口矩阵退出码 0，部署目录用于复现；未递归删除。
- [保留] 终态补验部署目录 `C:/Users/Admin/AppData/Local/Temp/CodeWeave-Stage-Terminal-20261108-2b739da21e6e4fccba216657b2196b3d`，本次创建、无 reparse point，进程已退出。关键报告、原始 CTest 日志及终态截图已收入本目录。精确路径 `Remove-Item -LiteralPath '<上述终态部署目录>' -Recurse -Force` 被自动审批返回 `blocked by policy` 拒绝，工具未提供更具体原因；未绕过。确认不再需要其余过程截图后，可由用户在 PowerShell 手动执行同一命令清理，勿清空整个 Temp。
- 没有操作真实 `工作区/`、账户数据、远程或仓库布局；无依赖升级和数据迁移。回滚：保护后续改动后 `git revert <本检查点提交>`，再运行标准 Qt 构建。
- 下一入口：建立网页端与 Qt 的同一课程、同一运行状态、同一 1440×900 截图对比，再修订差异记录；P2.6 源码级运行控制按语言工具契约继续评估。
