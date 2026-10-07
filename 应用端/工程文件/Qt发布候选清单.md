# Qt 发布候选清单

当前状态（2026-10-07 合并主线后补测）：最新 Qt/QML 页面代码已合入本地 `main`（`cfe0918`），Qt 已接通账户、学习、执行、复习和数据操作；七页真实窗口 smoke 通过。原版视觉与完整功能等价尚未验收，工作集/窗口出现仍超预算，不标记 U1–U4/B0–B3 全部完成。用户确认暂无独立 Windows 测试系统，先完成本机验证；这不豁免干净系统门禁。

### 2026-10-07 U3 真实窗口功能矩阵

- [通过] 新增 `--u3-matrix-json` 隔离验收模式：运行在真实 `QQuickView` 窗口中，使用 `QTemporaryDir` 的工作区、账户和数据根，不读取或写入用户的 `%LOCALAPPDATA%\CodeWeave`。
- [通过] 真实窗口矩阵覆盖课程目录/正文/starter、编辑器草稿保存、账户注册/退出/重新登录、Python/Java/JavaScript/C++ 四语言执行、复习进度、挑战页、草稿页和分析页；16 项检查全部通过。
- [通过] 本轮证据：`evidence/qt-u3-matrix-20261007-r2.json`；窗口截图为 `evidence/u3-learning.png`、`u3-course.png`、`u3-editor.png`、`u3-review.png`、`u3-challenge.png`、`u3-drafts.png`、`u3-analysis.png`。
- [未执行] 真实窗口的暂停/继续/单步/取消/超时按钮逐项取证、原生文件选择器、中文 IME、剪贴板/撤销重做、DPI/UIA、干净 Windows 和 DWM 实际呈现；这些仍不能由本轮矩阵代替。

### 2026-10-07 主线合并与页面懒加载补测

- [通过] 本地 `main` 已快进合入 `feat/qt-main-qml-complete`，当前 HEAD 为 `cfe0918`；未推送远端。根目录 `CodeWeave.exe` 仍保留 Win32 回滚版本，Qt 预览 EXE 仍使用独立部署目录。
- [通过] 合并主线 Qt ON Release 构建、CTest 8/8、Node 4/4 和边界审计。
- [通过] 七页真实窗口 smoke：学习路径、实战挑战、代码草稿、编辑器、运行记录、复习中心、学习分析均生成截图并退出 0。截图目录：`G:/CodeWeave-qt/merged-main-smoke-r2`。
- [通过] 页面懒加载：`StackLayout` 改为当前页加载、访问后保留实例，避免启动时实例化全部七个页面。当前主线证据：`evidence/qt-window-gates-20261007-main-lazy-pages.json`。
- [通过] 合并后交互代理指标：主线程 P95 `0.6780 ms`，frameSwapped P95 `17.3337 ms`，编辑 P95 `17.2007 ms`，取消 P95 `71.4517 ms`；这些不是 DWM 实际呈现证据。
- [失败] 资源门禁仍失败：Win32/Qt 同机 15 次对照中，Win32 工作集冷/热中位数约 `27.78/27.77 MiB`、窗口出现约 `211.08/113.14 ms`；Qt 懒加载后约 `180.75/147.55 MiB`、窗口出现约 `542.41/568.64 ms`。证据：`evidence/qt-ui-benchmark-20261007-main-lazy-pages.json`。不能宣称 Qt 相对 Win32 性能达标。
- [未执行] 干净 Windows、DPI/IME/UIA、真实 DWM 呈现、Qt LGPL 正式材料和根 EXE 替换。

## 最新候选与门禁（本节覆盖后文历史记录）

- 本机内部候选：`G:/CodeWeave-qt/CodeWeaveQt-0.1.1-internal-r6-setup.exe`，31,201,345 字节（29.76 MiB）；展开包 `G:/CodeWeave-qt/gates-final-package-r6`，65.99 MiB。
- 安装器 SHA-256：`C6DB532DE960853248BD890095B41FE1CA39F268801E865634A6FA09C1244739`；应用 EXE：`A48DF64E2EE4672DF2277A05EC9FFD13058931383EEA6238765949829C355CA8`。本候选未签名；历史自签结果不适用于新 hash。
- 根 Win32 EXE、已有用户安装和真实数据均保留。新候选只在隔离目录安装验证，未更新用户正在使用的入口。

| 门禁 | 本机证据 | 判定 |
| --- | --- | --- |
| 安装包 ≤50 MiB | 29.76 MiB，保留 Qt 图形回退和 MSVC app-local CRT | [通过] |
| 工作集相对增长 ≤20% | Qt 98.812 / Win32 28.461 MiB，中位数，+247.2% | [失败]，未获取舍接受 |
| 启动相对增长 ≤20% | 窗口出现 Qt 320.509 / Win32 144.629 ms，+121.6%；不等于完整可交互启动 | [失败]，完整同负载就绪对照未执行 |
| 主线程事件 P95 ≤16.7 ms | 0.4984 ms；最大 234.9582 ms | [通过]，存在长事件，不能宣称无卡顿 |
| 连续活动帧 P95 ≤20 ms | Qt frameSwapped 16.5893 ms | [通过]提交帧代理指标；DWM 实际呈现未通过验收 |
| 编辑 P95 ≤50 ms | 按键发出到下一次 frameSwapped 16.5630 ms | [通过]代理指标；真实屏幕呈现未测 |
| 取消 P95 ≤100 ms | 72.7103 ms，Python 循环任务，30 次 | [通过]本机合成负载 |
| 安装/跨版本升级/卸载 | 0.1.0-preview → 0.1.1-internal-r6，EXE hash 改变；数据哨兵、窗口 smoke、临时载荷清理 | [先失败，修复后通过]开发机隔离验证 |
| 安装失败恢复 | 损坏/额外/重复/越界清单拒绝；未知已安装文件保留；目录切换后失败恢复旧版；显式降版保留数据 | [通过]合成事务测试 |
| U3 完整行为/视觉等价 | `evidence/qt-u3-matrix-20261007-r2.json` 的 16 项真实窗口矩阵通过；控制器与编辑器专项仍缺 | [部分通过] |
| U4 干净 Windows、DPI/IME/UIA | 用户暂无测试系统；未启用系统组件、未提升权限 | [未执行] |

测量原始文件：`evidence/qt-resource-gates-20261006-final.json`、`evidence/qt-window-gates-20261006-release.json`、`evidence/qt-install-transaction-20261006.json`。资源样本双方各 15 次，交替顺序；新配置不等于 OS 冷缓存。资源脚本的 `status=passed` 只代表采样完成，不代表资源预算通过。工作集含共享页，采样中存在系统回收波动。窗口证据为 `evidence/qt-gates-window-20261006.png`。PresentMon/ETW 尝试因 access denied 失败；不得把 frameSwapped 当成显示器呈现。

## 行为映射及证据边界

Win32 `main.cpp` 中的控件 ID 并非 38 个独立页面。Qt 将操作合并为五页与原生对话框，页面数量不能单独证明功能相等。

| 原生能力 | Qt 接入 | 当前证据 |
| --- | --- | --- |
| 注册/登录/退出/改密 | 账户页、密码对话框，后台 AccountService | 隔离 facade 回归，含错误旧密码 |
| 目录/正文/starter/提示 | 学习页、异步内容服务 | CTest、真实窗口截图；提示降低独立完成判定 |
| 草稿保存/恢复/账户隔离 | 编辑器，revision 与 dirty 保护 | 空草稿、坏文件、失败写入、重启恢复回归 |
| 四语言自由编程与执行工具 | 编辑器、Windows 原生选择器、工具配置 | facade 四语言执行与自由草稿回归；选择器人工验收未执行 |
| 运行/取消/暂停/继续/单步/超时 | 编辑器命令、运行记录页 | 核心/facade 测试；真实窗口取消测量；全套按钮操作尚未逐项取证 |
| 挑战/独立完成/进度/复习 | 复习与进度页，唯一执行/证据 ID | 独立通过、提示降级、账户隔离回归 |
| 外部实践证据 | 表单 → Pending 证据服务 | Pending 不自动计入完成的回归 |
| 备份/恢复/旧账户与学习导入/数据目录 | 账户页 → 原生选择器 → 后台核心服务 | 备份/恢复和坏导入回归；恢复/导入写新目录，不自动激活或覆盖真实数据 |

本次安装修复：原生启动 Windows PowerShell 时 `Get-FileHash` 无法加载，改用 .NET SHA-256；旧包长路径删除失败，改用经固定路径约束的扩展长度路径删除。安装脚本拒绝未列入清单的文件、重复/越界路径和 reparse point，阶段目录切换失败恢复旧程序。源码不更改账户格式或密码成本。Qt 后台 worker 自等待死锁已补回归。

复现（仓库根目录）：

```powershell
G:\CodeWeave-qt\verify3.cmd
& ./应用端/scripts/verify-qt-install-transaction.ps1
& ./应用端/scripts/verify-qt-install-lifecycle.ps1 -Installer G:/CodeWeave-qt/CodeWeaveQt-0.1.1-internal-r6-setup.exe -IncludeUpgrade -PreviousInstaller G:/CodeWeave-qt/CodeWeaveQt-0.1.0-preview-setup.exe
python 应用端/scripts/qt-window-performance.py --exe G:/CodeWeave-qt/gates-final-package-r6/CodeWeaveQtShell.exe --output <新的证据文件>
G:/CodeWeave-qt/mycheck-build/qt-deploy-u3-r3/CodeWeaveQtShell.exe --u3-matrix-json G:/CodeWeave/应用端/evidence/qt-u3-matrix-20261007-r2.json
```

后续优先定位主线程长事件并降低 Qt 资源开销；用户未接受取舍之前，不切换根入口。干净系统、旧 UI 视觉、完整 IME/UIA/DPI 与 Qt 许可材料仍是发布前独立门禁。

### 2026-10-06 主线程长事件修复

- [通过] 诊断探针记录了慢事件的接收者、嵌套深度和工作阶段。约 200–287 ms 的长事件稳定出现在首次进入编辑器（stage 4）的 `QQuickWindowIncubationController`，不是执行、账户哈希或端口服务。
- [通过] 对照实验确认原 `TextArea` 的中文 `placeholderText` 与等宽字体初始化共同触发同步 QML incubation；改为保持原 `TextArea`/滚动/输入契约，只将中文提示移到独立的轻量 `Text`，避免占位文本走编辑器等宽布局初始化。
- [通过] 修复后窗口探针 3 次合并样本：主线程事件 P95 0.5563 ms、最大 13.9541 ms（预算 16.7 ms）；frameSwapped P95 16.4319 ms（预算 20 ms）；编辑 P95 16.6996 ms（预算 50 ms）；取消 P95 72.5888 ms（预算 100 ms）。证据：`evidence/qt-window-gates-20261006-editor-hint.json`。
- [通过] 诊断字段保留在 `performance_probe.hpp`，仅 `--benchmark-json` 启用；不会改变正式运行逻辑。frameSwapped 仍是提交帧代理，不是 DWM 实际呈现。
- [失败] Qt 相对 Win32 的工作集和窗口出现时间门禁仍失败（此前中位数约 +247% / +121.6%），本轮没有放宽预算，也没有替换根目录 Win32 EXE。

### 本轮临时产物处置

测试自建的 `cw-install-transaction-*`、`codeweave-lifecycle-*`、窗口探针临时数据由各脚本正常清理；最终部署、包、安装器和仓库 evidence 保留用于复现。以下均已核验位于 `G:/CodeWeave-qt` 的直接子路径且非 reparse point，但自动审批拒绝批量删除，仅返回 `blocked by policy`，因此保留：

- `gates-final-package-r2`、`gates-final-package-r3`、`gates-final-package-r4`、`gates-final-package-r5`。
- `CodeWeaveQt-0.1.1-internal-r2-setup.exe`、`CodeWeaveQt-0.1.1-internal-r3-setup.exe`、`CodeWeaveQt-0.1.1-internal-r4-setup.exe`、`CodeWeaveQt-0.1.1-internal-r5-setup.exe`。
- `bootstrap-diagnostic-r3`、`bootstrap-diagnostic-r4`、`bootstrap-upgrade-diagnostic`、`install-diagnostic-r3`、`empty-delete`。

这些是本轮生成的中间包或合成数据，不能作为当前安装入口。安全清理仅限上述逐项绝对路径，禁止使用目录通配符或触及 `gates-final-package-r6`、用户目录、历史构建及回滚材料。

## 历史候选验证（不是当前候选的签名或验收）

- Qt 6.8.3 + MSVC x64 Release 构建：`G:\CodeWeave-qt\verify3.cmd`，CTest 8/8。
- Qt OFF 原生回归：`G:\CodeWeave-qt\build-off`，CTest 7/7。
- Node 应用端门禁：`corepack pnpm test` 4/4；`corepack pnpm run check` 通过。
- Windows 平台真实窗口 smoke：部署 EXE 退出码 0，生成 `应用端/evidence/qt-u3-window.png`。
- Qt 部署目录含动态 Qt DLL、QML imports、`platforms/qwindows.dll`、内容和配置示例；不使用 Node、浏览器或端口。
- 自解压当前用户安装器：`G:\CodeWeave-qt\CodeWeaveQt-0.1.0-preview-setup.exe`；安装目录 `%LOCALAPPDATA%\Programs\CodeWeave`，不提权、不写系统目录、不监听端口。
- 最终安装器 SHA-256（2026-10-06 实测）：`3AEB94D769C1C5D5DD218400B1320D8A61CD55AACB90B5A69306208EBD2B0205`；签名 Qt EXE SHA-256：`3C6335DA206E5BF86934AD8AAE4229320C0CD8DA90084B4C30BDF33B129CC7CE`。
- B2 隔离生命周期演练通过：安装、启动 smoke、卸载、用户数据哨兵保留均通过。
- B2 升级覆盖演练通过：隔离安装器验证输出 `UPGRADE=PASS`，升级前后 EXE hash 一致且用户数据哨兵保留。
- B3 内部签名通过指纹校验：证书指纹 `FB397F9E499283A02C358E548099AAD2D46FA25A`；系统信任验证为 `UnknownError`，因为证书是自签且未导入受信任根。

## U4 发布门禁

1. 在无 Qt/无开发 PATH 的干净 Windows 上启动部署目录，记录冷启动、空闲内存、课程载入和编辑响应；与 Win32 基线同机同负载对照。
2. 验证 100/150/200% DPI、中文 IME、键盘焦点、撤销/重做、长文本、emoji 和 UIA 无障碍树。
3. 补齐 Qt LGPL 通知、许可证文本、对应源码获取方式和替换/重链接说明；动态链接 Qt，不引入 GPL-only 模块。
4. 运行 `scripts/package-qt-release.ps1` 生成独立便携候选，检查 `manifest.json` 的每项 SHA-256；包内不含测试夹具、开发工具、Node、旧启动器或端口服务。
5. 保留当前 Win32 回滚包和数据根 `%LOCALAPPDATA%\CodeWeave`；升级和回滚不得删除账户、草稿、证据或学习记录。

## B1-B3 安装发布门禁

- 当前使用自解压 EXE 安装器，脚本为 `scripts/build-qt-selfextract.ps1`，启动器为 `scripts/qt-installer-bootstrap.cpp`；不默认采用 MSIX，避免卸载时重定向数据丢失。
- 安装、升级覆盖、卸载、回滚均在隔离测试账户执行；安装器不能启动服务、监听端口或写系统信任库。
- 免费自签证书只用于内部身份和文件完整性，不能宣称消除 SmartScreen 警告；不安装到系统信任根，不公开上传项目。
- 正式发布前必须由负责人确认安装包、版本号、证书策略和 Qt LGPL 材料。
- 性能证据：`evidence/qt-ui-benchmark-20261006.json`。最终签名候选已完成 15 次 Qt 与 15 次 Win32 同机样本；Qt 窗口时间中位数 443.855 ms、工作集 150.773 MiB，Win32 分别为 98.772 ms、28.496 MiB。Qt 预览相对现有 Win32 基线启动和工作集更重；该文件是取舍记录，不是“性能提升”证明。OS 冷启动、课程载入、编辑延迟、取消延迟和呈现帧间隔仍未测。

## 证据命令

```powershell
corepack pnpm test
corepack pnpm run check
G:\CodeWeave-qt\verify3.cmd
ctest --test-dir G:\CodeWeave-qt\build-off --output-on-failure
powershell -File 应用端/scripts/verify-qt-install-lifecycle.ps1 -Installer G:\CodeWeave-qt\CodeWeaveQt-0.1.0-preview-setup.exe
```

## IExpress 弹窗修复（2026-10-06）

- [先失败，修复后通过] 现场发现四个遗留 IExpress 进程，启动于 02:07–02:14，父进程已退出，命令行引用的临时 CodeWeaveQt.sed 已不存在。其中 df39cbfa427b4244a630a6c51816402d 与用户截图一致。核对可执行路径及命令行后仅关闭这四个进程。
- 当前构建脚本及安装器不调用 IExpress/MakeCAB；此次报错是旧打包任务残留，不能归因为用户双击当前安装包。旧流程为何提前清除临时输入未从现存源码复现。
- 安装器临时 ZIP 改为每次独立目录，成功后清理；失败删除大体积 ZIP 并提示诊断目录。路径按 PowerShell 字面量转义。该改动与旧 IExpress 弹窗是两个问题，不混淆根因。
- [通过] 更新后的 verify-qt-install-lifecycle.ps1 -IncludeUpgrade：安装、同包重复覆盖、窗口 smoke、卸载、数据哨兵保留及 INSTALLER_TEMP_CLEANUP=PASS。测试的 TEMP/TMP/APPDATA/LOCALAPPDATA 均隔离。
- [通过] 候选 manifest 1379 项校验，错误 0；上方安装器 SHA-256 已更新，Qt 应用 EXE hash 不变。自签证书仍不具备公共信任。
- [已清理] 核对后删除旧生成文件 G:/CodeWeave-qt/~CodeWeaveQt-0.1.0-preview-setup.DDF 与 %TEMP%/CodeWeaveQtPackage.zip（后者已逐字节确认属于旧安装器载荷）。未删除源码、真实数据或其他构建目录。
- [未执行] 干净 Windows、真正跨版本升级/回滚、完整旧 UI 复刻验收；此次安装问题修复不代表整个产品正式发布验收完成。

## 本机入口与版本化（2026-10-06）

- 现场运行进程确认为 `G:/CodeWeave/CodeWeave.exe`（Win32）；此前实际用户目录没有安装 Qt，只有隔离安装测试。
- 已安装本清单 hash 对应 Qt 安装包，创建 `G:/CodeWeave/CodeWeave Qt 预览.lnk` 指向 `%LOCALAPPDATA%/Programs/CodeWeave/CodeWeaveQtShell.exe`，开始菜单也提供入口。根 Win32 EXE 和正在使用的旧窗口保持不动，避免丢失未保存内容。
- [通过] 实际安装 EXE hash 与候选一致；真实窗口 smoke 退出 0，显示学习/编辑器/运行记录/账户页面骨架。没有执行真实账户登录或数据迁移。
- [通过] 提交前重新构建 Qt ON 并执行 CTest 8/8，Node 测试 4/4，应用端边界检查通过。测试通过不代表视觉复刻完成。
- 回滚入口为根目录 Win32 EXE；移除 Qt 程序可执行安装目录的 uninstall-qt.ps1，用户数据目录保留。源码回滚基线为提交前的 5e938b9；禁止用 reset --hard 覆盖后续修改。
