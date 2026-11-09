# Phase 4.2 顶栏与设置对齐复测

复测日期：2026-11-09。结果为部分完成：设置行内控件和顶栏面包屑验收已完成，Phase 4.2 的整体视觉验收仍未关闭。

## 验收结果

- [通过] `cmd /c 工程文件\工具\构建当前Qt.cmd`：当前 Qt Release 构建成功，CTest 11/11 通过，总用时 114.90 秒。
- [通过] 最新完整 Qt 构建与 CTest：`cmd /c 工程文件\工具\构建当前Qt.cmd`，11/11 通过，总用时 104.06 秒。
- [通过] 最终 U3 真实窗口矩阵：222/222 项、59 张截图、隔离数据开启、QML warnings 为空。普通选中课程 `python-loop-sum` 的两位课程编号和辅助技术名称通过；挑战文档 `stage-d` 的标题从发布清单读取，按非首页课程语义显示文档 ID、不编造课程序号，且可访问名称与可见路径一致。最终报告与截图位于 `u3/pass-20261109-190906/`。
- [通过] Qt 可见窗口报告 `qt/qml-window-report-final.json`：`diagnostic=passed`，QML warnings 为空，共 11 张 DPR 1 截图，其中 7 张为 1440×900、4 张为 1100×720。8 个设置行均完整可见且文字未截断；开关为 48×28、右内距 3px，两个选择器分别为 81×44 和 72×44、右内距 0px。三项已接入设置启用，其余保持禁用。
- [通过] Web 参考报告 `web/web-topbar.json`：9 张当前参考截图，6 项浮层 Escape 关闭及焦点归还检查通过，浏览器错误为空。隔离 API 只提供参考账户；学习目录 API 保持不可用回退态。
- [通过] `node 应用端/项目/native/ui-qt/tests/compare_topbar_reference.mjs 应用端/工程文件/验收证据/Phase4-topbar-final-20261108/qt/qml-window-report-final.json 应用端/工程文件/验收证据/Phase4-topbar-final-20261108/web/web-topbar.json`：同一 Reference 账户、61 个课程 ID、6 个 Python 课程 ID、所选课程 `python-loop-sum` 及源码 SHA-256 一致。该脚本核对数据标识与代码，不核对布局或像素。
- [通过] 人工查看两端设置弹窗截图，并核对窄窗滚动末段。逐行完整可见性以 Qt smoke 断言为准；截图仅用于视觉复核。
- [通过] 最终 U3 矩阵检查数据与隐私、分析、1100×720 窄窗、普通课程和挑战文档工作台面包屑的可见文本及 `QAccessible::Name`；普通选课态只显示一次课程编号并播报标题。
- [通过] `node 工程文件/工具/check-layout.mjs`：目录规则通过。
- [通过] `git diff --check`：退出码 0；Git 提示部分既有 QML/JS 文件会在后续 Git 操作时转换 LF/CRLF，本次未运行格式化或换行转换。

## 尚存差异

| 项目 | Qt | Web |
| --- | --- | --- |
| 顶栏搜索框 | x=457，宽=665px | x=463.53，宽=658.47px |
| 账户浮层 | x=1220，y=57，高=311px | x=1220，y=56.5，高约 296.59px |
| 设置行高 | 87px；Tab 行 114px | 约 72.19px |

搜索框仍相差约 6.53px 的起点和宽度；设置文字字重/行高、恢复默认按钮尺寸、帮助正文和来源提示仍有差异。Qt 的本机目录状态与 Web 隔离 API 不可用状态并不相同；真实能力继续按各端实际情况显示，不能据截图像素尺寸一致推导为相同页面或数据状态。没有执行像素差分，也未联调正式账户/资料库。

## 失败记录

- `select-before-fix.json`：修复前的选择器紧凑样式断言未通过；该报告没有截图。
- `qt/qt-qml-load-first-failure.json`：初次 smoke 按统一的 0px 右内距检查开关时失败，报告实际值为 3px。后续断言按开关/选择器类型分别检查，最终 smoke 通过。
- `qt/qml-window-report-first-failure.json`：初次可见窗口 smoke 在第 14 步菜单焦点断言失败。重跑和最终报告通过；本次没有定位该次失败的根因，不据此认定为产品缺陷或已修复根因。
- U3 首轮及中间诊断报告保留在各自目录；中间挑战断言曾错误地使用首页 `selectedLesson` 推断工作台标题，最终测试改为核对发布清单标题，并区分首页课程编号与挑战文档 ID。最终 `pass-20261109-190906/qt-matrix-breadcrumb-final.json` 222 项全通过。

## 文件索引

- Qt：`qt/qml-window-report-final.json`、`qt/qml-window-report-retry.json`、两份失败报告及 11 张 `topbar-*.png`；最终 U3 报告和 59 张窗口截图见 `u3/pass-20261109-190906/`。
- Web：`web/web-topbar.json` 与 9 张 `topbar-*.png`。
- 修复前设置选择器断言：`select-before-fix.json`。
- 当前实现和跨端数据核对脚本：`应用端/项目/native/ui-qt/qml/`、`应用端/项目/native/ui-qt/tests/compare_topbar_reference.mjs`。

下一步：先处理搜索框几何及设置/帮助仍可收敛的视觉差异，再重新运行两端同状态截图；整体 4.2 在完成该验收前保持未关闭。
