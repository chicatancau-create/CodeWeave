@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

echo ========================================
echo 重新构建 Qt 版本（包含你的修改）
echo ========================================
echo.

echo [1/5] 设置 MSVC 环境...
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 (
    echo 错误：无法设置 MSVC 环境
    pause
    exit /b 1
)

echo.
echo [2/5] 清理 QML 缓存...
cd /d G:\CodeWeave-qt\mycheck-build
del /Q ui-qt\.rcc\qmlcache\codeweave-qt_qml\Main_qml.cpp* 2>nul

echo.
echo [3/5] 重新构建 Qt 版本...
ninja codeweave-qt
if errorlevel 1 (
    echo.
    echo 错误：构建失败
    echo 请检查上面的错误信息
    pause
    exit /b 2
)

echo.
echo [4/5] 复制到根目录...
copy /Y ui-qt\CodeWeaveQtShell.exe G:\CodeWeave\CodeWeaveQt.exe
if errorlevel 1 (
    echo 错误：复制失败
    pause
    exit /b 3
)

echo.
echo [5/5] 完成！
echo ========================================
echo Qt 版本已成功构建并复制到：
echo G:\CodeWeave\CodeWeaveQt.exe
echo.
echo 现在你可以双击 CodeWeaveQt.exe 查看修改后的界面
echo ========================================
echo.
pause
