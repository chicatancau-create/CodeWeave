@echo off
setlocal
echo ========================================
echo 重新构建 Qt 版本
echo ========================================

echo [1/4] 设置 MSVC 环境...
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
if errorlevel 1 (
    echo 错误：无法设置 MSVC 环境
    pause
    exit /b 1
)

echo [2/4] 重新构建 Qt 版本...
cd /d G:\CodeWeave-qt\mycheck-build
ninja codeweave-qt
if errorlevel 1 (
    echo 错误：构建失败
    pause
    exit /b 2
)

echo [3/4] 复制到根目录...
copy /Y ui-qt\CodeWeaveQtShell.exe G:\CodeWeave\CodeWeaveQt.exe
if errorlevel 1 (
    echo 错误：复制失败
    pause
    exit /b 3
)

echo [4/4] 完成！
echo ========================================
echo Qt 版本已构建并复制到：
echo G:\CodeWeave\CodeWeaveQt.exe
echo.
echo 双击 CodeWeaveQt.exe 即可查看效果
echo ========================================
pause
