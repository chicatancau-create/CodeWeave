# P1 1.3–1.5 顶栏交互验收

日期：2026-11-07。面包屑、顶栏浮层及设置/帮助弹窗完成隔离真实窗口交互验收；网页端视觉等价和真实账户设置持久化仍未验收。

## 结果

- `topbar-smoke.json`：可见窗口 smoke 为 `passed`，QML 警告为空。
- 自动验证覆盖面包屑随页面变化、快捷动作与通知互斥切换、搜索空态与 Esc、设置/帮助打开关闭和焦点归还。
- `topbar-quick.png`、`topbar-notifications.png`、`topbar-settings.png`、`topbar-settings-small.png`、`topbar-help.png`：真实桌面窗口截图。人工检查控件颜色使用设计令牌；设置在 1100×720 逻辑窗口内完整显示，无裁切。
- 标准 Qt Release 构建及 CTest 9/9、目录纯函数测试 5/5、根目录布局检查和 `git diff --check` 通过。

## 复现

从仓库根目录运行 `cmd /c 工程文件\工具\构建当前Qt.cmd`，随后在包含 Qt DLL/QML imports 的部署目录启动 `CodeWeaveQtShell.exe --qml-load-smoke <报告绝对路径>`。smoke 会创建临时数据目录，不使用真实用户工作区；可见窗口模式需保持桌面窗口可见。

直接调用 CMake 部署 target 未能重新配置，因为它缺少标准构建脚本临时建立的英文 Qt SDK 映射路径。此次使用现有部署依赖，仅替换为刚构建的 EXE 完成真实窗口 smoke；未改变 SDK、junction 或构建目录规则。

## 边界

- 设置偏好尚无本地持久化，相关选项保持禁用并明确标注“待接入”。
- 未做网页端截图像素差分、真实账户联调或生产资料库联调；截图只作为布局和控件状态证据。
