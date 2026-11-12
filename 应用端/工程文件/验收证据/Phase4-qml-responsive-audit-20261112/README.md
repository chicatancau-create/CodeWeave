# Phase 4 窄窗侧栏与 QML 警告判据复核（2026-11-12）

## 范围与结论

本次复核独立审查发现的 A1/A2。A1 已将窄窗侧栏间距从未声明的 ds.s84 改为已声明令牌组合 ds.topbarH + ds.s16。A2 按审查提出的第二种关闭方式处理：明确 qmlWarnings 的采集边界，并在 1100×720 的真实 Windows 窗口中单独断言 A1 的实际几何。

QQmlEngine::warnings 当前覆盖 QML 加载/组件创建阶段，不能单独证明 resize 后所有绑定无警告。本次没有安装 qInstallMessageHandler。因此 qmlWarnings=[] 只记录现有加载期采集结果；A1 的布局结论来自独立的 sidebarGeometry 断言，不来自警告数组为空。这个几何断言只关闭 A1 对应的窄窗问题，不证明所有动态布局问题都已覆盖。

## 验证结果

- [通过] 修复后的 1100×720 真实窗口报告 diagnostic=passed，sidebarVisible=true，contentY=84，expectedTopMargin=84，passed=true；最终报告为 post-colors-retry/report.json。
- [通过] 最终真实窗口 smoke 生成 11 张截图，qmlWarnings 为空；normal/report.json 也有 11 张截图并通过同一侧栏几何断言。
- [先失败，修复后通过] post-colors/report.json 保留第一次复跑失败：帮助 Dialog 关闭按钮的方框边框或悬停态断言失败，报告生成 9 张截图。未改代码，使用同一窗口流程重跑后 post-colors-retry/report.json 通过并生成 11 张截图。首次失败保留，不计作最终通过。
- [事实边界] 修复前原始报告已归档为 `pre-fix-diagnostic/report-instrumented-before-fix.json`：1100×720 下 `contentY=0`、`expectedTopMargin=84`、`passed=false`、`qmlWarnings=[]`。报告中的 8 张 PNG 路径记录为生成时临时目录；同名图片已复制到该归档目录并逐张校验 SHA-256 与原件一致。该证据说明 warnings 为空不是布局正确性的充分判据。

## 复现命令

在 G:\CodeWeave、Qt 6.8.3 和可见 Windows 桌面会话下，先构建当前 Qt 目标：

    cmd /d /c 工程文件\工具\构建当前Qt.cmd

真实窗口 smoke 不设置 QT_QPA_PLATFORM=offscreen。报告目录需预先存在；本目录已包含输出目录。核心启动方式：

    $root = 'G:\CodeWeave'
    $exe = Join-Path $root '.local\qt\current\ui-qt\CodeWeaveQtShell.exe'
    $report = Join-Path $root '应用端\工程文件\验收证据\Phase4-qml-responsive-audit-20261112\post-colors-retry\report.json'
    $arguments = @('--qml-load-smoke', $report, '--topbar-reference-content', 'G:/CodeWeave/应用端/项目/native/content')
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -Wait -NoNewWindow
    if ($process.ExitCode -ne 0) { throw "Qt visible-window smoke failed: $($process.ExitCode)" }

运行期间将窗口缩至 1100×720；报告内的 sidebarGeometry 断言验证实际窗口尺寸、侧栏可见性和内容顶部坐标。隔离运行数据由 smoke 使用临时目录保存，不读取或修改 工作区/。

## 保留证据

- normal/：正常基线 smoke 的 JSON 与 11 张截图。
- post-colors/：关闭按钮断言首次失败的 JSON 与当次截图。
- post-colors-retry/：不改代码重跑后的通过 JSON 与 11 张截图。
