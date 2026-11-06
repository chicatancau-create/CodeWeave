@echo off
setlocal
set "VSLANG=1033"
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
set "SRC=%ROOT%\.local\app\native"
set "QT_PREFIX=%ROOT%\.local\prep\qt\6.8.3\msvc2022_64"
set "OUT=%ROOT%\.local\qt\current"
if not exist "%QT_PREFIX%\bin\qmake.exe" exit /b 89
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 90
cmake -S "%SRC%" -B "%OUT%" -G Ninja -DCMAKE_BUILD_TYPE=Release -DQEWEAVE_BUILD_UI_QT=ON -DCMAKE_PREFIX_PATH="%QT_PREFIX%"
if errorlevel 1 exit /b 91
cmake --build "%OUT%" --parallel 8
if errorlevel 1 exit /b 92
ctest --test-dir "%OUT%" --output-on-failure
if errorlevel 1 exit /b 93
exit /b 0
