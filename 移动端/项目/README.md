# CodeWeave 移动端

Android/Kotlin UI 位于 `mobile-app/`，独立 C++ 核心位于 `mobile-core/`。外层唯一入口 `../启动移动端.lnk`，工程说明统一在 `../工程文件/`。

当前机器可调用 ADB，但没有 Gradle Wrapper、可用 Gradle 命令、已构建 APK 或检测到的 Android Studio。入口打开 Android 工程，环境不足时明确提示；不会自动安装软件到连接的手机。

只读入口检查：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-mobile.ps1 -Check`。

结构检查：`node scripts/boundary-check.mjs`。C++ 核心可用 CMake 配置、构建和 CTest 验证。Android 编译与设备运行尚未验证，此处不提供不存在的 gradlew.bat 命令。

本机 MSVC 核心验证命令（需启用共享库符号导出）：

```powershell
cmake -S mobile-core -B .gradle/layout-native-check -G "Visual Studio 17 2022" -A x64 -DCMAKE_WINDOWS_EXPORT_ALL_SYMBOLS=ON
cmake --build .gradle/layout-native-check --config Release
ctest --test-dir .gradle/layout-native-check -C Release --output-on-failure
```

固定规则见仓库根 `AGENTS.md`。有效内容并入当前版本，必要源码备份到 Git，本地不留重复旧版本。
