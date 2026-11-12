# Phase 4 组件视觉与设置文本复测（2026-11-11）

本目录保存本轮 Qt/Web 顶栏、设置、帮助和工作台参考的最终复测证据。它用于关闭原始任务 4.2 的可比组件验收，并记录仍需继续跟踪的整页视觉差异；不能据此宣称四个页面已经像素级或整页等价。

本目录中 `QML warnings 为 0` 指 smoke 连接的 `QQmlEngine::warnings` 创建/加载期信号为空；当时没有安装全局 Qt 消息处理器，因此不覆盖 resize 后所有动态绑定警告。2026-11-12 A1 窄窗分支由独立 1100×720 几何断言验证，详见 `../Phase4-qml-responsive-audit-20261112/README.md`。

## 结果

- [通过] Qt 标准 Release 构建与 CTest 11/11。构建日志：`qt-build-final.log`。
- [通过] 正常偏好存储和存储不可用两态的真实窗口 smoke，均为 `diagnostic=passed`，QML warnings 为 0。
- [通过] 两种状态各在 1440×900 与 1100×720 检查 8 行设置标题/说明边界，均为 16/16；初始视口 8/8 行完整可见，滚动后底部内容可读。
- [通过] 最终 17 张 PNG 已用 Pillow 检查，尺寸为 1440×900 或 1100×720；SHA-256 与文件清单见 `validation-summary.json`。
- [通过] Web 参考截图、账户/课程/源码核对和 6 项 Escape/焦点归还检查见 `web-topbar/` 与 `reference-compare-final.json`。
- [先失败，修复后通过] 弹层动画后首次真实窗口 smoke 在通知退场期间提前检查归焦，失败报告保留于 `qt-popup-motion-final/` 和 `qt-popup-motion-focus-diagnostic/`。运行器现等待可见 Popup 完成转场，再执行原焦点断言；200 tick 超时不变。
- [通过] 最终弹层动画真实 Windows smoke：`qt-popup-motion-verified/report.json` 为 `diagnostic=passed`、QML warnings 0、11 张截图；包含通知关闭后的焦点归还和减少动效断言。截图为 1440×900 或 1100×720。
- [通过] 存储不可用状态的弹层动画复测：`qt-popup-motion-preferences-unavailable/report.json` 为 `diagnostic=passed`、QML warnings 0、6 张截图；设置文本边界 16/16、初始视口 8/8。
- [记录] 四次弹层复测的报告和图片 SHA-256 清单见 `popup-motion-sha256.json`；失败诊断不计入通过。
- [记录] `pixel-diff-final.json` 是全视口 RGB 描述性指标，无任务定义的通过率阈值；由于数据状态、字体、控件和焦点不同，差异百分比不能作为失败判据。

## 修复证据链

1. `settings-regression-build.log` 与 `settings-regression-before.json` 保留了新增首屏断言首次捕获第八项被裁切的红灯。
2. `settings-line-height-build.log` 与 `settings-line-height-window/` 保留了只改行高后仍差 2px 的真实窗口失败；当时末行底部为 620、视口底部为 618。
3. 最终修复同时收紧 QML 文本行高、段间距与设置 Dialog 底部留白，并在 C++ smoke 中检查完整行边界；两种存储状态最终均通过。
4. `qt-topbar/` 是修复前参考，不作为最终通过证据；最终证据使用 `qt-topbar-final/` 和 `qt-settings-unavailable-final/`。

## 组件对照结论

- 顶栏、搜索、快捷动作、通知、账户菜单、设置和帮助的可比几何、关闭反馈、文本边界及真实能力说明已复测通过。
- 帮助执行说明按当前运行器能够提供的数据描述；未采集到的步骤和变量不补造。
- 平台字体、待接入设置的禁用态、来源状态、通知数据和帮助内容仍按各端真实能力呈现，保留为差异记录。

## 四页差异记录

以下差异属于 Phase 4 后续整页复刻工作，不阻断本轮原始 4.2 可比组件验收：

| 页面 | 仍需跟踪的差异 |
| --- | --- |
| 学习 | 来源条/问候位置、主题背景、学科顺序、卡片大小与位置；部分 Qt 访客/Web 参考账户状态不同 |
| 复习 | Qt 三组空表和页脚与 Web 单一空卡不同；资料库警告会造成垂直偏移 |
| 挑战 | Qt 标题字号、筛选栏位置、原生浅色下拉、卡片高度与间距不同 |
| 工作台 | 编辑区比例、运行栏结构、流程图 3×2 与 4+2 排列、指南模态与正文展开结构不同 |

## 复现入口

在仓库根目录使用标准 Qt 构建入口：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
node 工程文件\工具\check-layout.mjs
```

可见窗口 smoke 需要 Qt 6.8.3、当前部署目录和 Windows 桌面会话。报告目录必须预先创建，运行时通过 `--qml-load-smoke <绝对报告路径>` 和 `--topbar-reference-content G:/CodeWeave/应用端/项目/native/content` 指定；存储不可用复测追加 `--qml-load-smoke-preferences-unavailable`。不要使用 offscreen，也不要并行启动两个真实窗口。

网页端参考在 `网页端/项目` 执行：

```powershell
corepack pnpm verify
```

## 边界与未执行项

- 未联调正式账户、正式资料库和用户真实学习记录。
- 未执行 Android APK、Android Lint、设备运行；当前环境未发现 Android SDK/adb。
- 未把全视口像素差异设为门禁；四页整页视觉等价仍未关闭。
- 帮助与设置证据来自隔离内容和真实窗口；Qt/Web 数据来源状态仍可能不同。

## 清理记录

- [已清理] 本轮创建的临时 Qt 部署目录：`C:\Users\Admin\AppData\Local\Temp\CodeWeave-Phase4-visual-retest-20261111-b14d5db5ba0f47858525ddb4ffe25047`。删除前再次确认目录无 ReparsePoint、无运行中的 Qt 进程；删除后路径不存在。
- [已清理] 本轮启动的 Vite 进程链及 `127.0.0.1:5174` 监听；未触碰 Codex/ChatGPT 祖先进程。
- [保留] 本目录中的截图、日志和 JSON 是正式验收证据，不清理。
- [保留] `qt-popup-motion-final/`、`qt-popup-motion-focus-diagnostic/` 是失败诊断证据；`qt-popup-motion-verified/` 与 `qt-popup-motion-preferences-unavailable/` 是两态最终通过证据。
