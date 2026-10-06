@echo off
rem Deploy the freshly built Qt shell into the installed CodeWeave app.
rem Closes the running preview window first (it locks the .exe), copies the
rem new build in, and confirms. Re-run any time after a rebuild.
setlocal
set SRC=G:\CodeWeave-qt\mycheck-build\ui-qt\CodeWeaveQtShell.exe
set DST=C:\Users\Admin\AppData\Local\Programs\CodeWeave\CodeWeaveQtShell.exe

if not exist "%SRC%" (
  echo [x] build not found: %SRC%
  exit /b 1
)

echo == closing running preview ==
taskkill /IM CodeWeaveQtShell.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo == backing up current install ==
if exist "%DST%" copy /y "%DST%" "%DST%.bak-prev" >nul

echo == installing new build ==
copy /y "%SRC%" "%DST%" >nul
if errorlevel 1 (
  echo [x] copy failed - is the app still open?
  exit /b 2
)

echo == done ==
for %%F in ("%DST%") do echo   installed: %%~zF bytes  %%~tF
echo   launcher:  G:\CodeWeave\CodeWeave Qt 预览.lnk
endlocal
