# Phase 4 QML 颜色令牌收口复核（2026-11-12）

## 范围与结论

把应用端业务 QML 中迁移遗留的颜色字面量集中到 DesignSystem.qml，并让组件和页面继续通过 ds.* 使用令牌。网页端审查发现的 desktop-theme.css 新增颜色也已改用 --ds-content-source-surface。

- [通过] DesignSystem.qml 与 QML 中 ds/designSystem 引用全量检索：119 个声明，0 个未声明引用。
- [通过] 排除 DesignSystem.qml 后，对应用端全部 QML 扫描 Qt.rgba(...) 和十六进制颜色字符串，0 处命中。PowerShell 可复跑：rg -n 'Qt\.rgba\([^)]*\)|"#[A-Fa-f0-9]{3,8}"' 应用端/项目/native/ui-qt/qml --glob '*.qml' --glob '!DesignSystem.qml'。rg 退出码 1 表示无匹配。
- [通过] 网页端 desktop-theme.css 的资料来源提示背景使用 --ds-content-source-surface；令牌定义位于网页端/项目/src/design/tokens.css。

## 状态与视觉对照

对照基线与令牌化后的 Qt Release 截图使用隔离数据、相同课程 python-loop-sum、相同执行状态和 1440×900 / DPR 1。每个报告都有 15 项状态/交互检查通过，分别生成 8 张截图；before-repeat 是对基线的重复采集，用来估计截图波动。

使用 FFmpeg ssim 对每页同名 PNG 做描述性比较。以日志中的 All dB 项计，before 与 before-repeat 为 35.14–69.70 dB，before 与 after 为 35.14–70.33 dB；逐页差异与同页重复采集处于相近量级。学习页与挑战页已人工核对，未发现令牌化造成的可辨识外观变化。该指标和人工抽查不证明逐像素相同，也不代表 Qt 与 Web 整页视觉等价。

逐页可复跑命令示例：

    ffmpeg -hide_banner -i 应用端/工程文件/验收证据/Phase4-color-token-audit-20261112/before/qt-learning.png -i 应用端/工程文件/验收证据/Phase4-color-token-audit-20261112/before-repeat/qt-learning.png -lavfi ssim -f null NUL
    ffmpeg -hide_banner -i 应用端/工程文件/验收证据/Phase4-color-token-audit-20261112/before/qt-learning.png -i 应用端/工程文件/验收证据/Phase4-color-token-audit-20261112/after/qt-learning.png -lavfi ssim -f null NUL

## 验证结果

- [通过] Qt Release 构建及 CTest 11/11：cmd /d /c 工程文件\工具\构建当前Qt.cmd。该构建覆盖本次 Qt/QML 改动；颜色截图采集之后没有再修改 Qt 源码。
- [通过] before、before-repeat、after 三份 report.json 均记录 passed=true、15/15 检查通过、8 张截图和 qmlWarnings=[]。该数组只收集 `QQmlEngine::warnings` 创建/加载期信号，不是全局 Qt 消息采集；窄窗动态绑定由本批之外的侧栏几何断言单独验证，详情见 `../Phase4-qml-responsive-audit-20261112/README.md`。
- [未执行] Android APK、正式账户/资料库联调、跨端逐像素阈值门禁；这些不属于本次颜色令牌收口证据。

## 证据目录

- before/：令牌化前截图和检查报告。
- before-repeat/：基线重复采集，用于观察运行间变化。
- after/：令牌化后截图和检查报告。
