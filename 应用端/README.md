# CodeWeave 应用端

当前 Qt 预览入口：项目根目录 `CodeWeave Qt 预览.lnk`，指向 `%LOCALAPPDATA%/Programs/CodeWeave/CodeWeaveQtShell.exe`。2026-10-07 已将最新 Qt/QML 页面代码合入本地 `main`，并完成 Qt ON 构建、CTest 8/8 和七页真实窗口 smoke。根目录 `CodeWeave.exe` 仍是 Win32 回滚版本，双击它会显示旧界面；Qt 资源预算、编辑器专项、DPI/IME/UIA 和干净 Windows 仍未通过。详见 `工程文件/Qt发布候选清单.md`。

应用端现在由 C++23/Win32 原生程序提供。根目录 `G:/CodeWeave/CodeWeave.exe` 与 `应用端/dist/native-final-20261005-r4/CodeWeave.exe` 是同一份已签名便携交付；运行不启动 Node、浏览器、网页服务器或 TCP 端口。

交付目录必须保留 `CodeWeave.exe`、`content/` 和 `config/codeweave.config.example.json`。课程内容包包含 61 条课程、13 条挑战、13 个阶段、starter 代码、提示和运行策略。用户数据默认写入 `%LOCALAPPDATA%/CodeWeave`，按账户分目录保存；旧数据只能通过“数据”菜单主动导入或恢复到新目录。

应用窗口提供账户注册/登录/改密/退出、课程浏览、个人草稿、C++/Java/Python/JavaScript 受控运行、暂停/继续/步进/取消、执行轨迹、挑战判定、正式进度、复习汇总、外部实践证据、数据备份/恢复和旧数据导入。外部环境课程保存为待人工确认的证据，不会自动计入完成。

## 验证命令

```powershell
Set-Location G:\CodeWeave\应用端
corepack pnpm test
corepack pnpm run check
cmake --build native/build-g1-msvc-1 --config Release
ctest --test-dir native/build-g1-msvc-1 -C Release --output-on-failure
python scripts/native-product-smoke.py --exe ..\CodeWeave.exe --screenshot evidence/native-product-final-r3.png
```

当前验证结果为 Node 4/4、MSVC CTest 7/7、发布边界审计通过和真实 Win32 产品 smoke 通过。签名证书是 `CodeWeave Internal Test` 自签证书；它用于标识内部构建，不会自动获得 Windows SmartScreen 公共信任。

## 目录

- `native/src/`：应用服务、账户、内容、执行、学习记录、迁移、备份和 Win32 UI。
- `native/content/`：确定性导出的只读内容源。
- `scripts/package-native.mjs`：独立原生交付打包。
- `scripts/native-product-smoke.py`：真实窗口回归。
- `工程文件/`：本端总工程、后端工程、路线、审查和代码结构。
- `dist/native-final-20261005-r4/`：当前便携交付目录。

旧 Electron 启动器、旧构建树和历史工程记录已校验归档到 `G:/CodeWeave/备份区/native-integration-20261005/`，不随原生应用运行。
