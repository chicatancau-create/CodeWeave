# Qt 修缮最终矩阵（2026-11-15）

唯一最终通过目录为 `qt-matrix-windows-visible/`：226/226、60 PNG、退出码 0；Windows 窗口后端与软件渲染，直接启动正常窗口。原始断言保留，新增等待仍受 500 tick 上限约束；复习行沿 QQuickItem 可视树查找；截图门禁补齐为 60 并要求悬停截图存在。

其余目录全部为失败或初始化/中断证据，名称中的 final/verified 不代表成功。offscreen/software 的 Windows 字体断言失败；隐藏 Windows 窗口无法截图；这些尝试均未计作通过。详见根 `工程文件/验收证据/修缮收口-20261115/validation-summary.json` 的 attempts。

标准构建/CTest 11/11（124.78 秒）；应用端 Node 4/4、边界与 release audit 通过。QML 无警告断言只覆盖 QQmlEngine 创建/加载采集，不覆盖全局运行期。截图中账户和记录来自矩阵临时夹具，未访问用户真实数据。

原始 4.1 历史七页拆分、4.2 同尺寸可比组件和 7.2 四页差异记录的证据边界，见根逐项核对、终验报告和总证据 README。未声称所有状态/窗口像素等价。
