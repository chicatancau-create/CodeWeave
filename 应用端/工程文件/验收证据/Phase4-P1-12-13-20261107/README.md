# P1 1.12 / 1.13 验收记录

日期：2026-11-07。范围为登录介绍区、草稿结构和相关状态修复，整体 Phase4 尚未完成。

## 当前证据

- `draft-account-matrix.json` 为最终真实窗口矩阵原始输出，60/60 通过，十三张截图。JSON 中保存原始临时截图位置，同目录有对应文件名的交付副本。
- `u3-login-intro.png`：访客介绍区及修复后的账户内容宽度。
- `u3-drafts.png`：加载已保存课程草稿后的真实字段、文件列表、行数与空快照。
- `u3-drafts-save-error.png`：将隔离账户的草稿文件替换为空目录，真实写盘失败；编辑仍保留，可关闭错误提示并重试。
- `u3-drafts-small.png`：1100×720 逻辑窗口，草稿详情使用纵向滚动以保留字段和操作的可达性。
- 截图像素尺寸受当前 Windows DPR 影响；不宣称全套截图都是 1440×900 像素，也未执行网页/应用像素差分。

## 复现

在 `G:\CodeWeave` 执行 `cmd /c 工程文件\工具\构建当前Qt.cmd`。本轮 Release 构建及 CTest 8/8 通过。

部署目录已包含 Qt DLL、QML imports 与当前内容。复制新 EXE 后，在该目录执行 `CodeWeaveQtShell.exe --u3-matrix-json <新的绝对路径>/matrix.json`。矩阵自动建立临时账户/数据目录，不使用真实工作区。窗口须可见，否则无法截图。

本次最终报告原路径：`C:\Users\Admin\AppData\Local\Temp\CodeWeave-P1-1-9-20261107-a\draft-verified-run\matrix.json`。

## 失败与修复

1. 首次截图发现账户列过窄，使用页面宽度修正 ScrollView 子布局绑定，增加宽度断言并复核截图。
2. 成功读取草稿被状态分类函数当作错误；补齐成功、无已保存草稿和取消读取的正常分类，矩阵断言正常状态不显示错误条。
3. 矩阵注册后可能仍在读取草稿，旧检查仅断言 dirty 为 false；增加读取等待，并断言实际代码和保存成功状态。最终故障注入、提示关闭、重试及磁盘内容核对全部通过。
4. 在标准脚本外裸跑 CTest，两项 Qt 测试缺少 DLL 搜索环境，退出 `0xc0000135`；标准脚本内同一套八项通过。裸跑失败属于环境调用差异，不能据此省略 Qt 测试。

## 能力边界

名称/说明来自真实课程且只读；文件名是当前单文件编辑器的语言名称。现有 facade 仅持久化最近一份草稿，历史检查点、项目复制/删除、元数据编辑未接入，相关入口禁用，不把 revision 当作可恢复快照。未替换已安装应用。

## 临时资源

本轮窗口进程和构建进程已退出，故障目录在重试前删除；QTemporaryDir 的隔离数据由程序退出时释放。

部署与中间报告保留在 `C:\Users\Admin\AppData\Local\Temp\CodeWeave-P1-1-9-20261107-a`；此前自动审批拒绝删除该部署目录，本轮未绕过重试清理。

本轮临时日志保留在 `C:\Users\Admin\AppData\Local\Temp`：`cw-p1-12-13-build.log`、`cw-p1-12-13-build2.log`、`cw-p1-12-13-build3.log`、`cw-p1-12-13-final-build.log`、`cw-p1-12-13-small-build.log`、`cw-p1-12-13-verified-build.log`。中间报告 `cw-p1-12-13-matrix.json`、`cw-p1-12-13-matrix2.json` 及目录中较早运行记录不作为最终通过证据。
