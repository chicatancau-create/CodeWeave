# Phase4 设置滚动与顶栏几何补验（2026-11-08）

## 结果

- [通过] `cmd /c 工程文件\工具\构建当前Qt.cmd`：当前 Qt Release 构建成功，CTest 11/11（134.94 秒）。
- [通过] `node 工程文件/工具/check-layout.mjs` 与 `git diff --check` 通过。
- [先失败，修复后通过] 直接执行 `ctest --test-dir .local/qt/current --output-on-failure` 时，8/11 通过，3 个 Qt 测试因生成 CTest 环境引用未挂载的 `Q:\bin` 而以 `0xc0000135` 退出。按标准构建脚本建立临时 Qt SDK 映射后，三个失败项重跑 3/3 通过；映射已卸载，没有遗留测试进程。
- [通过] 当前窗口 smoke 报告 `qt/qml-window-report.json` 的 `diagnostic` 为 `passed`，QML warnings 为空，共 9 张截图。1440×900 顶栏品牌、工作区/个人中心切换器、搜索框和动作栏几何均被采集。
- [通过] 1100×720 设置弹窗滚动到底后，导出和清除数据按钮完整处于滚动视口内，且仍为禁用状态；底部截图见 `qt/topbar-settings-bottom-small.png`。本次验证只覆盖底部这两个操作，不代表所有设置行都逐项滚动验收。
- [通过] 人工查看 1100×720 首屏与底部截图，未见文字遮挡，数据操作按钮完整可见。

## 改动边界

- 可见窗口 smoke 记录顶栏四个主要布局项的逻辑几何，并验证设置内容确实可滚动到底。
- 设置数据操作继续禁用；没有接入导出或批量清除功能，也未操作账户或工作区数据。
- 来源提示的重读按钮文案保持“重新读取”，并增加本机目录用途提示。
- 本机安装版未替换；未运行网页端与 Qt 的同状态逐像素比较。

## 复现

在仓库根目录执行标准 Qt 构建和 CTest：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
node 工程文件/工具/check-layout.mjs
git diff --check
```

真实窗口 smoke 需要 Qt 6.8.3 SDK。沿用 `验收证据/Phase4-source-settings-retest-20261108/README.md` 的隔离启动方式，将报告输出路径设为本目录的 `qt/qml-window-report.json`，并使用 `--qml-load-smoke` 和 `--topbar-reference-content` 参数；不要设置 offscreen 平台，以生成可见窗口截图。

## 未完成项

- 所有窄窗口设置行的逐项滚动截图。
- 正式账户/资料库联调，以及 Web 与 Qt 同状态的完整视觉等价验收。
- Android APK 与设备运行验证。

## 回滚

本批为 smoke 断言、objectName 和提示呈现调整，没有数据迁移或公共接口变化。需要撤回时先保护后续改动，再对本批本地提交执行 `git revert <commit>`，随后重跑 Qt 标准构建、CTest、窗口 smoke 和目录检查。
