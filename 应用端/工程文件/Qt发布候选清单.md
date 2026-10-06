# Qt 发布候选清单

当前状态：Qt 内部预览可构建、安装和启动；U3 仅页面骨架，原版视觉与完整功能等价尚未验收，不标记 U1–U4/B0–B3 全部完成。正式公开发布仍需干净 Windows、DPI/IME/UIA、同机性能和 Qt 许可材料复核。

## 当前已验证

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
