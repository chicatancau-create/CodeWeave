@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b %errorlevel%
set "TASK_BASE=C:/Users/Admin/AppData/Local/Temp/CodeWeave-Phase41-compare-20261111"
cmake -S "%TASK_BASE%/%1-app/native" -B "%TASK_BASE%/%1-build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DQEWEAVE_BUILD_UI_QT=ON -DBUILD_TESTING=OFF -DCMAKE_SUPPRESS_REGENERATION=ON -DCMAKE_CXX_COMPILER=cl -DCMAKE_PREFIX_PATH="%TASK_BASE%/qt-sdk" -DQt6_DIR="%TASK_BASE%/qt-sdk/lib/cmake/Qt6"
if errorlevel 1 exit /b %errorlevel%
cmake --build "%TASK_BASE%/%1-build" --target codeweave-qt --parallel 6
exit /b %errorlevel%
