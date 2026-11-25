# 2026-11-15 修缮终验

范围为原始附件阶段 0–7 的 37 个编号任务。当前全部落地并按环境允许的方式验收；Android 按任务 6.1 的静态基线条款交付，未编译 APK。逐项记录见 `../../修缮逐项核对-20261108.md`，完整交付见 `../../修缮终验报告-20261111.md`。

## 最终结果

- [通过] Web `corepack pnpm verify`：88 文件、1323 项，覆盖率 89.83/83.07/87.49/92.83，类型、Lint、边界、契约、构建、服务语法均通过。原始本机日志为 `网页端/工程文件/验收证据/修缮收口-20261115-web-verify.log`，日志受忽略规则排除。
- [通过] Qt 标准构建/CTest：11/11，124.78 秒；本机日志 `qt-build-state-transition.log`。旧 VS 路径失效后新增 vswhere 发现逻辑，清除过期 CMake 工具链缓存后完成重建。
- [先失败，修复后通过] 最终 Windows 窗口矩阵 226/226、60 张 PNG、退出 0。使用 `windows` 平台插件、`software` 渲染；不是 GPU 验收。报告在应用端同名证据目录 `qt-matrix-windows-visible/`。
- [通过] Web 四档 375/768/1280/1440 布局、12 项键盘检查及 reduced-motion；隔离 HTTP 检查和 1440×900 四页截图，浏览器错误为空。
- [通过] `historical-validation.json`：历史 SHA 65/65、两报告各 8 项、七页业务状态一致、像素指标复算一致。结合 `应用端/工程文件/验收证据/修缮当前验收-20261112/split-audit.md` 的资源/补丁/源码核验，关闭原始 4.1 的受控结构验收。每通道最大差 1/255；不宣称逐像素相同。
- [通过] 应用端边界、77 文件 release audit、Node 4/4；移动端边界、只读入口检查；布局和 diff 检查。

`validation-summary.json` 汇总所有矩阵尝试、最终截图尺寸与 SHA-256。`verify-evidence.mjs` 实际检查最终矩阵、PNG、浏览器报告和历史复核摘要；质量门禁数量为本次日志记录，不冒充重新执行测试。

## 失败证据

所有此前矩阵目录均保留，不计入最终通过：原始真实窗口报告暴露复习 Repeater 查找、取消终态同步和窗口激活问题；`qt-matrix-software-sdk` 卡于新增等待步骤的错误自增，现明确跳到步骤 64。`qt-matrix-verified` 是 offscreen/software，225/226，仅 Windows 字体解析断言失败；`qt-matrix-windows-final` 是隐藏启动的 Windows 窗口，截图为空及相关几何失败。最终直接启动正常窗口后原断言全部通过。具体失败名称见汇总中的 `attempts`。

未生成 report 的目录只表示初始化/中断尝试，不表示通过。部分目录名含 final/verified 是尝试名称，只有 `qt-matrix-windows-visible` 是最终通过证据。报告自动字段 `mode=qt-real-window-input-matrix` 不足以区分后端，须结合 `execution.json`。

## 复现

仓库根：`cmd /d /c 工程文件\工具\构建当前Qt.cmd`；部署按 `应用端/项目/native/ui-qt/deploy-qt.ps1`，只使用隔离临时目录。可见矩阵使用部署 EXE 的 `--u3-matrix-json <新报告目录>/report.json`，直接启动并等待退出，不用隐藏启动。必要环境：Qt 6.8.3、VS2022 C++、Windows 桌面会话；本次额外设置 `QT_QPA_PLATFORM=windows`、`QT_QUICK_BACKEND=software`、SDK 的插件/QML 路径。

证据复核：`node 工程文件/验收证据/修缮收口-20261115/verify-evidence.mjs`。
历史 PNG 复算：`node 工程文件/验收证据/修缮收口-20261115/verify-historical.mjs <已安装的 sharp 模块绝对路径>`。未新增产品依赖。

## 清理与边界

真实 `工作区/`、账户数据、正式安装版本和远端均未操作。Web 验收启动的 Vite 进程链已由包装脚本停止。当前临时部署无运行进程、无 ReparsePoint，删除命令被自动审批拒绝（`blocked by policy`），因此保留，详见 `cleanup.json` 和 `resources.json`。未尝试其他删除机制。

`D:/Codex/Engineering-Knowledge` 必要文件当前不存在；本次查阅本机手册 MSVC 脚本记录，没有写知识库或记忆。QML warnings 检查限 QQmlEngine 创建/加载期；侧栏窄窗另有几何断言，不能推导全局动态绑定零警告。整页视觉差异、正式数据联调和 Android APK 为披露边界，不能由单元测试或历史截图替代。
