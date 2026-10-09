@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

echo ========================================
echo 强制重新构建 Qt 版本
echo ========================================
echo.

echo [1/6] 设置 MSVC 环境...
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 (
    echo 错误：无法设置 MSVC 环境
    pause
    exit /b 1
)

echo.
echo [2/6] 清理所有 QML 缓存...
cd /d G:\CodeWeave-qt\mycheck-build
rd /S /Q ui-qt\.rcc 2>nul
rd /S /Q ui-qt\.qt 2>nul
del /Q ui-qt\CMakeFiles\codeweave-qt.dir\.rcc\qmlcache\codeweave-qt_qml\Main_qml.cpp* 2>nul

echo.
echo [3/6] 删除旧的可执行文件...
del /Q ui-qt\CodeWeaveQtShell.exe 2>nul

echo.
echo [4/6] 重新构建 Qt 版本...
ninja codeweave-qt
if errorlevel 1 (
    echo.
    echo 错误：构建失败
    echo 请检查上面的错误信息
    pause
    exit /b 2
)

echo.
echo [5/6] 复制到根目录...
copy /Y ui-qt\CodeWeaveQtShell.exe G:\CodeWeave\CodeWeaveQt.exe
if errorlevel 1 (
    echo 错误：复制失败
    pause
    exit /b 3
)

echo.
echo [6/6] 验证文件...
if exist G:\CodeWeave\CodeWeaveQt.exe (
    echo 成功！Qt 版本已构建完成
    dir G:\CodeWeave\CodeWeaveQt.exe
) else (
    echo 错误：文件不存在
    pause
    exit /b 4
)

echo.
echo ========================================
echo 构建完成！
echo.
echo 现在你可以双击以下文件查看修改后的界面：
echo G:\CodeWeave\CodeWeaveQt.exe
echo ========================================
echo.
pause
