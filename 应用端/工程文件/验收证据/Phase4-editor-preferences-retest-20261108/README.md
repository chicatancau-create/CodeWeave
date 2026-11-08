# Phase 4 设置偏好可见窗口复测（2026-11-08）

## 结果

- [通过] `cmd /c 工程文件\工具\构建当前Qt.cmd`：Qt Release 构建完成，CTest 11/11 通过，总用时 102.22 秒；包含 C++ 编译运行回归。
- [通过] 真实窗口 smoke 使用隔离 `Reference` 账户和本机发布课程目录；报告 `qml-window-report.json` 的 `diagnostic` 为 `passed`，QML warnings 为空。
- [通过] 8 张截图均断言实际像素尺寸与逻辑窗口一致：1440×900，设置窄窗 1100×720，DPR 1。课程目录 61 项，Python 筛选 6 项，选中 `python-loop-sum`。
- [通过] 设置窗口验证减弱动画、字号切换为 16px、行号开关、恢复默认、辅助技术 toggleAction 和写入失败状态保持；真实编辑器字号、行号栏宽度/位置和草稿文本/修订号均受断言覆盖。
- [先失败，修复后通过] 首次 smoke 在复合编辑器断言失败。检查流程后发现 smoke 先回到“学习”页，再只加载课程而未切换回“编辑器”；编辑器行号栏因此处于隐藏祖先下。课程读取又是异步的。现明确切换页面，并在内容与起始代码加载完成后检查；原失败报告和截图保留在 `../Phase4-editor-preferences-20261108/`，修正后的完整报告在本目录。

## 文件

- `qml-window-report.json`：最终运行状态、所选课程、警告与截图索引。
- `topbar-*.png`：顶栏各浮层和设置大/窄窗口截图；截图已人工检查。

## 复现

在仓库根目录执行标准构建与 CTest：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
```

可见窗口 smoke 使用 Qt 6.8.3 SDK 环境，不设置 `QT_QPA_PLATFORM`：

```powershell
$qtRoot = 'G:\CodeWeave\.local\prep\qt\6.8.3\msvc2022_64'
$env:PATH = (Join-Path $qtRoot 'bin') + ';G:\CodeWeave\.local\qt\current\ui-qt;' + $env:PATH
$env:QT_PLUGIN_PATH = Join-Path $qtRoot 'plugins'
$env:QML_IMPORT_PATH = Join-Path $qtRoot 'qml'
& 'G:\CodeWeave\.local\qt\current\ui-qt\CodeWeaveQtShell.exe' `
  --qml-load-smoke 'G:\CodeWeave\应用端\工程文件\验收证据\Phase4-editor-preferences-retest-20261108\qml-window-report.json' `
  --topbar-reference-content 'G:/CodeWeave/应用端/项目/native/content'
```

测试账户、配置和草稿位于程序自动创建并清理的临时目录；真实 `工作区/`、正式账户、安装版和资料库未使用。

## 回滚

本轮只有 smoke 流程修正，没有产品数据迁移。若需要撤回，应只撤销 `ui_main.cpp` 中编辑器页切换与异步等待逻辑，并重跑标准 Qt 构建/CTest；保留其它尚未提交的工作区改动。
