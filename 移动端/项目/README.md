# CodeWeave 移动端

Android/Kotlin UI 位于 `mobile-app/`，独立 C++ 核心位于 `mobile-core/`。外层唯一入口 `../启动移动端.lnk`，工程说明统一在 `../工程文件/`。

当前提供 Gradle 8.9 Wrapper（匹配 AGP 8.7.3，分发包固定 SHA-256），Compose 页面使用系统明暗主题和安全区。页面仅显示项目名与“工程骨架已就绪”，不是业务功能已完成。入口打开 Android 工程，环境不足时明确提示；不会自动安装软件到连接的手机。

只读入口检查：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-mobile.ps1 -Check`。

结构检查：`node scripts/boundary-check.mjs`。Wrapper 来自 Gradle v8.9.0 官方脚本/JAR；Windows 上已用临时 JRE 17 执行 `gradlew.bat --version`，输出 Gradle 8.9。项目编译仍需 JDK 17 和 Android SDK 35；本机仅有全局 JDK 25，未检测到 Android SDK，**未编译验证 APK**。

Android 环境就绪后在本目录执行（APK/设备路径尚未实测）：

```powershell
.\gradlew.bat --version
.\gradlew.bat :mobile-app:assembleDebug :mobile-app:testDebugUnitTest :mobile-app:lintDebug
```

请将 `JAVA_HOME` 指向 JDK 17，将 Android SDK 写入本机 `local.properties` 的 `sdk.dir` 或 `ANDROID_HOME`；不要提交本机路径。Unix 使用 `./gradlew`。首次运行需要网络，下载包按 Wrapper properties 中的 SHA-256 校验。不要用 JDK 25 启动 Gradle 8.9。

本机 MSVC 核心验证命令（需启用共享库符号导出）：

```powershell
cmake -S mobile-core -B .gradle/layout-native-check -G "Visual Studio 17 2022" -A x64 -DCMAKE_WINDOWS_EXPORT_ALL_SYMBOLS=ON
cmake --build .gradle/layout-native-check --config Release
ctest --test-dir .gradle/layout-native-check -C Release --output-on-failure
```

固定规则见仓库根 `AGENTS.md`。有效内容并入当前版本，必要源码备份到 Git，本地不留重复旧版本。
