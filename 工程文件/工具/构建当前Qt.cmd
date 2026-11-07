@echo off
setlocal EnableExtensions
set "VSLANG=1033"
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
set "SRC=%ROOT%\.local\app\native"
set "QT_PHYSICAL=%ROOT%\.local\prep\qt\6.8.3\msvc2022_64"
set "OUT=%ROOT%\.local\qt\current"
if not exist "%QT_PHYSICAL%\bin\qmake.exe" exit /b 89
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  set "RESULT=90"
  goto cleanup
)

rem Ninja's Windows file enumeration cannot handle the physical SDK path's non-ASCII segments.
rem Use an unused subst drive for this invocation and leave existing mappings untouched.
set "QT_DRIVE="
set "QT_MAPPED=0"
for %%D in (Q R S T U V W X Y Z) do if not defined QT_DRIVE if not exist %%D:\nul (
  subst %%D: >nul 2>&1
  if errorlevel 1 (
    subst %%D: "%QT_PHYSICAL%" >nul 2>&1
    if not errorlevel 1 (
      set "QT_DRIVE=%%D"
      set "QT_MAPPED=1"
    )
  ) else (
    subst %%D: /d >nul 2>&1
  )
)
if not defined QT_DRIVE (
  set "RESULT=94"
  goto cleanup
)
set "QT_PREFIX=%QT_DRIVE%:/"

cmake -S "%SRC%" -B "%OUT%" -G Ninja -DCMAKE_BUILD_TYPE=Release -DQEWEAVE_BUILD_UI_QT=ON -DCMAKE_PREFIX_PATH=%QT_PREFIX% -DQt6_DIR=%QT_PREFIX%lib/cmake/Qt6
if errorlevel 1 (
  set "RESULT=91"
  goto cleanup
)
cmake --build "%OUT%" --parallel 8
if errorlevel 1 (
  set "RESULT=92"
  goto cleanup
)
ctest --test-dir "%OUT%" --output-on-failure
if errorlevel 1 (
  set "RESULT=93"
  goto cleanup
)
set "RESULT=0"

:cleanup
if "%QT_MAPPED%"=="1" subst %QT_DRIVE%: /d >nul 2>&1
if not defined RESULT set "RESULT=1"
exit /b %RESULT%
