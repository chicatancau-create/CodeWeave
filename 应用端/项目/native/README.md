# CodeWeave 原生核心

这是应用端的 C++23/Win32 产品实现。`native/src/main.cpp` 提供窗口与用户流程，核心库提供账户、内容、草稿、执行、轨迹、学习证据、进度、迁移和备份服务。

MSVC 14.44.35207、Windows SDK 10.0.26100.0、CMake/Ninja 已验证。运行：

```powershell
cmake --build native/build-g1-msvc-1 --config Release
ctest --test-dir native/build-g1-msvc-1 -C Release --output-on-failure
```

发布构建使用 `BUILD_TESTING=OFF`，再由 `scripts/package-native.mjs` 将 EXE、`native/content`、配置标记、许可证和 manifest 放入独立目录。程序运行不需要 Node、网页端、服务器或端口。用户选择的语言工具必须通过绝对路径白名单或“选择语言工具”设置。

内容仓库拒绝符号链接、非法 UTF-8、哈希不匹配、重复 ID 和未知文件。迁移只接受显式选择的旧 JSON，写入不存在的新目录；备份恢复校验清单、排除活动锁并拒绝覆盖现有目录。账户学习数据位于账户专属目录，未登录不能访问。
