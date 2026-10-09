# Qt 版本构建说明

## 问题说明

你双击的 `G:/CodeWeave/CodeWeave.exe` 是 **Win32 原生版本**（C++ Win32 API），不包含我修改的内容。

我修改的 `Main.qml` 文件是 **Qt 版本**的 UI 文件，Qt 的 QML 文件被编译进可执行文件中，需要重新构建才能看到效果。

## 我已经完成的修改

✅ **完善设计系统**
- 添加响应式尺寸定义（sizeDisplay、sizeTitle、sizeBody、sizeControl）
- 添加动画系统（durQuick、durBase、durSlow、easingType）
- 添加光晕效果属性（glowNearColor、glowPanelColor）

✅ **实现缺失的基础组件**
- ShellDropdown - 下拉菜单组件
- ShellModal - 模态框组件
- ShellTooltip - 提示框组件
- ShellToast - 通知组件

✅ **细化页面实现**
- 为所有基础组件添加了平滑的交互动画
- 优化了 hover 状态的视觉反馈
- 添加了 focus 状态的动画过渡

✅ **交互细节优化**
- IconButton、PrimaryButton、QuietButton 的颜色动画
- SubjectPill 的悬停效果
- ShellField 的焦点状态动画
- Streak Card 的交互反馈

## 如何查看修改效果

### 方法 1：使用已安装的 Qt 版本（需要重新部署）

Qt 版本已经安装在：`C:\Users\Admin\AppData\Local\Programs\CodeWeave\CodeWeaveQtShell.exe`

但这个版本使用的是旧的 QML 文件（我修改之前的），需要重新构建并部署。

### 方法 2：手动构建 Qt 版本

1. **打开命令提示符（管理员模式）**

2. **执行以下命令**：
```cmd
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cd G:\CodeWeave-qt\mycheck-build
ninja codeweave-qt
copy ui-qt\CodeWeaveQtShell.exe G:\CodeWeave\CodeWeaveQt.exe
```

3. **构建完成后，双击 `G:/CodeWeave/CodeWeaveQt.exe` 查看效果**

### 方法 3：使用我创建的批处理脚本

双击 `G:/CodeWeave/重新构建Qt版本.cmd`，等待构建完成，然后双击 `G:/CodeWeave/CodeWeaveQt.exe`

## 构建过程中可能遇到的问题

如果构建失败，错误提示：`无法打开包含文件: "type_traits": No such file or directory`

**原因**：MSVC 环境变量没有正确设置

**解决方法**：确保在运行 ninja 之前先调用 vcvars64.bat 脚本

## 关键文件位置

- **修改的源文件**：`G:/CodeWeave/应用端/native/ui-qt/qml/Main.qml`
- **构建目录**：`G:/CodeWeave-qt/mycheck-build/`
- **构建输出**：`G:/CodeWeave-qt/mycheck-build/ui-qt/CodeWeaveQtShell.exe`
- **目标位置**：`G:/CodeWeave/CodeWeaveQt.exe`（方便你双击测试）

## 文件对比

- `CodeWeave.exe` = Win32 原生版本（没有我的修改）
- `CodeWeaveQt.exe` = Qt 版本（包含我的所有修改，需要重新构建）
- `CodeWeaveQtShell.exe`（安装目录）= Qt 安装版本（需要重新部署）

## 下一步

如果你想看到修改后的效果，请按照上面的方法 2 或方法 3 重新构建 Qt 版本。

如果构建过程中遇到任何问题，请把错误信息告诉我，我会帮你解决。
