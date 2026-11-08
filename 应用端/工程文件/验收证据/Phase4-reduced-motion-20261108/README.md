# Phase 4 减弱动画验收（2026-11-08）

## 结果

- [通过] 标准 Qt Release 构建及完整 CTest：11/11 通过，用时 130.87 秒。
- [通过] Qt QML smoke：默认动态 BusyIndicator、键盘开启减弱动画、恢复默认、辅助技术 `toggleAction` 开关及再次恢复默认均通过；检查 duration token、复选框状态和 spinner/静态指示状态。
- [通过] 非 offscreen 窗口 smoke：`qml-window-report.json` 的 `diagnostic` 为 `passed`，QML warnings 为空。生成 8 张截图；设置页截图为 1440×900 与 1100×720，DPR 均为 1。
- [通过] 配置写入失败注入：facade 与窗口路径均确认开关保持旧值，动画行为不变。
- [通过] `node 工程文件/工具/check-layout.mjs` 与 `git diff --check`。
- [先失败，修复后通过] 首次 facade 故障夹具在测试期间改名 QSettings 正在跟踪的 INI，并错误地继续断言原值可重载；改为先验证恢复默认，再独立注入不可写路径，最终完整 CTest 通过。
- [先失败，修复后通过] 首次真实窗口 smoke 缺少已有顶栏流程要求的参考内容参数，在账户弹层检查退出；按标准 smoke 参数加入本机发布内容目录后完整通过。应用功能本身未触发 QML 警告。

## 行为与存储

- 设置保存在本机应用数据根目录的 `preferences.ini`，使用 `preferences/reducedMotion`、`preferences/editorFontSize` 和 `preferences/editorLineNumbers` 三个键，不进入工作区、账户或保险库。
- 当前默认值为减弱动画关闭、编辑器字号 13px、显示行号开启。保存成功后才更新界面状态；恢复默认会移除这三个已接入偏好键，尚未接入的偏好仍禁用。
- 开启后将 DesignSystem 的过渡 duration token 设为 0，并把 7 处产品 BusyIndicator 切换为静态环形/圆点指示。默认关闭的 benchmark 专用滚动动画不属于产品交互路径。
- 编辑器字号和行号设置只修改编辑器显示状态，不改写代码草稿；设置存储不可写时保留旧值。

## 文件

- `qml-window-report.json`：真实窗口 smoke 运行结果、无警告摘要、几何和截图索引。
- `topbar-settings.png`、`topbar-settings-small.png`：设置页大窗与窄窗截图。
- 其余 `topbar-*.png`：窗口流程其他状态截图。

## 后续设置扩展（2026-11-08）

- 编辑器字号和行号控制现已接入本机偏好存储；完整可见窗口 smoke、写入失败保护及草稿版本不变断言见 `../Phase4-editor-preferences-retest-20261108/README.md`。
- 首次扩展 smoke 报告见 `../Phase4-editor-preferences-20261108/qml-window-report.json`；它暴露的是测试流程没有回到编辑器页的问题，修正后报告为 `diagnostic: passed`。

## 复现

在仓库根目录执行：

```powershell
.\工程文件\工具\构建当前Qt.cmd
node 工程文件/工具/check-layout.mjs
```

真实窗口 smoke 使用当前 Qt SDK 的 `bin`、`plugins`、`qml` 设置 `PATH`、`QT_PLUGIN_PATH`、`QML_IMPORT_PATH`，清除 `QT_QPA_PLATFORM`，再运行：

```powershell
& '.local/qt/current/ui-qt/CodeWeaveQtShell.exe' --qml-load-smoke '应用端/工程文件/验收证据/Phase4-reduced-motion-20261108/qml-window-report.json' --topbar-reference-content '应用端/项目/native/content'
```

## 回滚

无数据迁移。代码尚未提交时，只撤销本阶段对应 Qt 源码改动并删除本阶段证据目录；不得覆盖同工作区的其他工程文件或 `Main.qml` 搜索边距修改。若代码已提交，先确认后续工作，再对对应提交执行 `git revert <commit>`，然后重跑 Qt 构建/CTest 与布局检查。
