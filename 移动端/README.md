# CodeWeave 移动端

移动端由 Android/Kotlin UI 与独立 C++ 核心组成。Android 工程使用 `mobile-app`，核心库使用 `mobile-core`。

当前环境未发现 Android SDK、Gradle Wrapper 或 ADB，因此 Android APK 尚未在本机编译；C++ 核心已用 CMake/CTest 验证。安装 Android SDK 与 Gradle 后运行 `gradlew.bat :mobile-app:assembleDebug`。

工程文件统一入口：[总工程与发展路线](工程文件/总工程/移动端总工程.md)。
