# P2 2.2 挑战详情结构验收

日期：2026-11-07。验收范围是挑战详情的真实元数据、列表/详情切换与可用性边界；不包含 P2.3 判定接口、P2.4 提交历史/人工复核或网页视觉等价。

## 结果

- `challenge-matrix.json` 为最终隔离可见窗口原始报告：106/106 通过，`passed: true`，22 张截图，`qml-no-warnings` 通过。
- Enter 从第一张挑战卡打开详情，详情返回按钮获焦；Esc 关闭后列表可见、触发卡片恢复焦点。标题、起始代码与当前挑战清单一致；题目和编写/运行分区可见，运行按钮保持禁用。
- 本目录只归档与本任务直接相关的 `u3-challenge-detail.png`（1440×900）和 `u3-challenge-detail-small.png`（1100×720）。其余页面已在同一矩阵内回归，原始报告保留当时的临时截图路径。
- 人工查看两张最终截图：区块标题紧随对应内容，窄窗说明换行、起始代码可选取，返回入口及提交历史不可用状态可见。所选 A 关卡为外部环境关卡；其他关卡的长内容与教学运行器分支尚未逐关人工走查。
- [通过] `cmd /c 工程文件\工具\构建当前Qt.cmd`：Release 构建，CTest 9/9。
- [通过] `node 工程文件/工具/check-layout.mjs`；`git diff --check`。
- [通过] 网页端 `corepack pnpm verify`：87 个文件/1295 项测试、类型、Lint、契约、边界、构建、服务语法检查；覆盖率为 statements 89.75%、branches 82.98%、functions 87.44%、lines 92.79%。JSDOM 的 scrollTo/navigation 未实现提示不构成失败。

## 修复与决策

- [先失败，修复后通过] 初始详情块位于 GridView 的 delegate 内，列表隐藏后详情不可见，`detailBack` 在页面作用域不可解析。详情移到根 Item，与列表同级，消除运行时警告；不新增顶层 Loader。
- [先失败，修复后通过] 同一 tick 内 resize 后 grabWindow 仍可能拿到旧帧；改为各尺寸独立矩阵步骤后，两个尺寸断言均通过。隐藏窗口无法截图，正式验收使用可见窗口。
- [先失败，修复后通过] 人工截图检查发现标题集中堆叠及窄窗长说明裁切；改成标题/内容相邻，并按 ScrollView.availableWidth 限宽。只读代码自动折行，文本内容未改动。
- 中间矩阵扩展曾出现 case 编号重复及括号错误，构建明确失败后已修复；最终完整构建与矩阵通过，不使用中间结果冒充最终结果。
- 没有挑战运行/历史来源时保持禁用和“暂不可用”，不把课程 runCode 结果或空历史声明当作已完成挑战功能。

## 复现

仓库根目录构建：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
```

用 `应用端/项目/native/ui-qt/deploy-qt.ps1` 在空目录按其参数部署当前 EXE、Qt 依赖、QML、native/content 与 config 后，在可见交互桌面运行：

```powershell
& '<部署目录>/CodeWeaveQtShell.exe' --u3-matrix-json '<报告目录>/matrix.json' | Out-Null
$LASTEXITCODE
```

管道等待 Windows GUI 程序退出。验收模式内部使用 QTemporaryDir 隔离账户和数据，不操作真实工作区。窗口必须可见；矩阵自动退出，成功码为 0。

## 剩余范围

- [未执行] 网页端同一挑战详情的逐区块截图比较、像素差分、真实账户/资料库联调、逐关滚动与鼠标专项走查。
- P2.3/P2.4/P2.5 等仍按 Phase4 主计划推进；本次结构验收不代表全阶段完成。
