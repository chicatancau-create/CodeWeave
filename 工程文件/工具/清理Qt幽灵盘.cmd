@echo off
rem Remove any subst drive that maps to this repository's Qt SDK folder.
rem
rem Why: build-current-Qt.cmd maps a short drive for every build and removes it in
rem :cleanup. If that window is killed, cmd never runs the cleanup, the mapping
rem survives until logoff, and Explorer then shows a second drive with the same label
rem and size as the repo volume.
rem
rem Notes: `subst <drive>:` (drive only) is not a valid query here, and findstr cannot
rem match backslash paths reliably, so this lists every mapping and compares strings.
setlocal EnableExtensions

rem Guard: never delete a mapping while a build or test is using it.
set "BUSY="
for %%P in (cmake.exe ninja.exe ctest.exe CodeWeaveQtShell.exe codeweave-qt-facade-tests.exe codeweave-vault-writeback-tests.exe) do (
  tasklist /FI "IMAGENAME eq %%P" 2>nul | findstr /I /C:"%%P" >nul 2>&1
  if not errorlevel 1 set "BUSY=%%P"
)
if defined BUSY (
  echo [abort] a Qt build/test is running ^(%BUSY%^).
  echo         Removing the mapped drive now would break it. Close it and run again.
  echo.
  pause
  exit /b 3
)

for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
set "QT_PHYSICAL=%ROOT%\.local\prep\qt\6.8.3\msvc2022_64"
if not exist "%QT_PHYSICAL%\bin\qmake.exe" (
  echo [warn] SDK not found at "%QT_PHYSICAL%"
  echo.
  pause
  exit /b 2
)
echo Qt SDK: "%QT_PHYSICAL%"
set "LIST=%TEMP%\qt-subst-clean-%RANDOM%.txt"
subst > "%LIST%" 2>nul
set "FOUND=0"
for /f "usebackq delims=" %%L in ("%LIST%") do (
  for /f "tokens=1,* delims=>" %%A in ("%%L") do (
    for /f "tokens=* delims= " %%C in ("%%B") do if /I "%%C"=="%QT_PHYSICAL%" (
      echo [clean] "%%L"
      for /f "tokens=1 delims=:" %%X in ("%%A") do (
        subst %%X: /d >nul 2>&1
        if errorlevel 1 (echo         FAILED to remove) else (echo         removed)
      )
      set "FOUND=1"
    )
  )
)
del "%LIST%" >nul 2>&1
if "%FOUND%"=="0" echo Nothing to clean: no drive is mapped to that folder.
echo.
pause
