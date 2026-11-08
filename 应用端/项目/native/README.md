# CodeWeave 原生核心

这是应用端的 C++23/Win32 产品实现。`native/src/main.cpp` 提供窗口与用户流程，核心库提供账户、内容、草稿、执行、轨迹、学习证据、进度、迁移和备份服务。

在仓库根目录调用当前 Qt 构建入口（需要本机 Qt 6.8.3、VS2022 和现有 `.local` junction）：

```powershell
cmd /c 工程文件\工具\构建当前Qt.cmd
ctest --test-dir .local/qt/current --output-on-failure
```

发布构建使用 `BUILD_TESTING=OFF`，再由 `scripts/package-native.mjs` 将 EXE、`native/content`、配置标记、许可证和 manifest 放入独立目录。启动应用不需要 Node、网页端或服务器；运行学习代码需要对应语言工具。用户选择的语言工具必须通过绝对路径白名单或“选择语言工具”设置。

Python、JavaScript 普通脚本/ES module、Java 和 GNU C++/GDB 支持运行中的源码行/受限变量采样及结束后回看。JavaScript 模块快照使用 Node 的 `Module.registerHooks`；不可用时在学习代码执行前回退原始入口，此路径没有模块快照。Java 需要同一完整 JDK 的 `java.exe`、`javac.exe` 与 `jdk.jdi`，当前实测 JDK 25.0.2；JDI 使用默认本机调试连接器，不配置外网地址。C++ 需要同目录 GDB，非当前工具组合及中文 TEMP 仍有兼容边界。快照不写入 TraceStore，事件按轮询观察顺序发布，现有进程控制不等于源码单步。边界与复验见[实时事件验收](../../工程文件/验收证据/Phase4-P2-2-6-live-20261108/README.md)、[模块快照验收](../../工程文件/验收证据/Phase4-P2-2-6-js-module-20261108/README.md)和 [C++ 快照验收](../../工程文件/验收证据/Phase4-P2-2-6-cpp-20261108/README.md)。

内容仓库拒绝符号链接、非法 UTF-8、哈希不匹配、重复 ID 和未知文件。迁移只接受显式选择的旧 JSON，写入不存在的新目录；备份恢复校验清单、排除活动锁并拒绝覆盖现有目录。账户学习数据位于账户专属目录，未登录不能访问。
