> 2026-11-06 目录规则：本端外层只留一个启动链接；源码在 `项目/`，工程说明在 `工程文件/`。当前入口和命令以仓库根 `AGENTS.md`、`工程文件/项目结构索引.md` 为准。下文旧根 EXE、旧构建树、旧备份目录及其历史测试记录不再作为当前操作指令，不得据此重建旧布局。

# 原生桌面 EXE 交付验证

当前根入口 `CodeWeave.exe` 为 C++23/Win32 GUI，随包携带 `content/`、配置示例、许可证和 manifest。它不依赖 Electron、Node、浏览器、命名管道、HTTP 或 TCP 端口。

## 交付目录

`应用端/项目/dist/native-final-20261005-r4/` 只包含发布 EXE、版本化内容、配置示例、许可证、README 和 SHA-256 manifest。根目录 EXE 与该目录 EXE 由同一发布构建同步。

## 验证

构建顺序：MSVC Release → CTest 7/7 → 原生发布边界审计 → `package-native.mjs` → `native-product-smoke.py`。smoke 使用隔离临时数据和临时账户，监视进程树确认没有 Electron 子进程和 TCP 连接，不访问真实账户。

## 数据与回滚

程序数据默认在 `%LOCALAPPDATA%/CodeWeave`，按账户隔离。移动 EXE 不会移动数据；旧入口和旧构建只在 `备份区/native-integration-20261005/` 中保留。恢复时使用已校验工程归档或上一份便携目录，不使用 Git reset/clean 覆盖工作区。
