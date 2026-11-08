@echo off
setlocal EnableExtensions
set "VSLANG=1033"
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
set "SRC=%ROOT%\.local\app\native"
set "QT_PHYSICAL=%ROOT%\.local\prep\qt\6.8.3\msvc2022_64"
set "OUT=%ROOT%\.local\qt\current"
if not exist "%QT_PHYSICAL%\bin\qmake.exe" exit /b 89
rem Keep MSVC /showIncludes output and CMake's prefix probe in the same encoding.
for /f "tokens=2 delims=:" %%C in ('chcp') do set "ORIGINAL_CP=%%C"
chcp 65001 >nul
set "CONFIGURE_ARGS="
if "%~1"=="--fresh" set "CONFIGURE_ARGS=--fresh"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  set "RESULT=90"
  goto cleanup
)

rem Ninja cannot enumerate a physical SDK path containing non-ASCII segments
rem (.local\prep is a junction into a folder whose real path has CJK names), so map a
rem short drive for this run.
rem Rules: (1) prefer a fixed letter (Q:) so generated paths stay stable;
rem         (2) adopt a leftover mapping that already points at our SDK (an interrupted
rem             build leaves one behind) and delete it in :cleanup as usual.
set "QT_DRIVE="
set "QT_MAPPED=0"
rem `subst <drive>:` (drive only, no path) is not a valid query here, and findstr
rem cannot match backslash paths reliably, so list every mapping and compare as strings.
set "QT_LIST=%TEMP%\qt-subst-list-%RANDOM%.txt"
subst > "%QT_LIST%" 2>nul
for /f "usebackq delims=" %%L in ("%QT_LIST%") do if not defined QT_DRIVE (
  for /f "tokens=1,* delims=>" %%A in ("%%L") do (
    for /f "tokens=* delims= " %%C in ("%%B") do if /I "%%C"=="%QT_PHYSICAL%" (
      for /f "tokens=1 delims=:" %%X in ("%%A") do set "QT_DRIVE=%%X"
      if defined QT_DRIVE (
        set "QT_MAPPED=1"
        echo [Qt] reusing leftover mapping "%%L"
      )
    )
  )
)
del "%QT_LIST%" >nul 2>&1
if not defined QT_DRIVE for %%D in (Q R S T U V W X Y Z) do if not defined QT_DRIVE if not exist %%D:\ (
  subst %%D: "%QT_PHYSICAL%" >nul 2>&1
  if not errorlevel 1 (
    set "QT_DRIVE=%%D"
    set "QT_MAPPED=1"
  )
)
if not defined QT_DRIVE (
  set "RESULT=94"
  goto cleanup
)
echo [Qt] using drive %QT_DRIVE%:
set "QT_PREFIX=%QT_DRIVE%:/"

cmake %CONFIGURE_ARGS% -S "%SRC%" -B "%OUT%" -G Ninja -DCMAKE_BUILD_TYPE=Release -DQEWEAVE_BUILD_UI_QT=ON -DCMAKE_PREFIX_PATH=%QT_PREFIX% -DQt6_DIR=%QT_PREFIX%lib/cmake/Qt6
if errorlevel 1 (
  set "RESULT=91"
  goto cleanup
)
if "%~1"=="--fresh" (
  cmake --build "%OUT%" --target clean
  if errorlevel 1 (
    set "RESULT=92"
    goto cleanup
  )
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
if defined ORIGINAL_CP chcp %ORIGINAL_CP% >nul
if not defined RESULT set "RESULT=1"
exit /b %RESULT%
