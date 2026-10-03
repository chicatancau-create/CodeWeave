# CodeWeave 原生 Windows 应用切片

这是应用端最终性能方向的最小 C++23/Win32 垂直切片。它不读取网页源码、后端源码、服务器或真实数据；后续功能按应用端本地数据契约逐步迁移。

## 构建

```powershell
cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --config Release
ctest --test-dir native/build --output-on-failure
```

正式发布门禁使用 MSVC + Windows SDK。没有该工具链时，MinGW 只能验证原型语法和链接，不代表正式 Windows 发布通过。
