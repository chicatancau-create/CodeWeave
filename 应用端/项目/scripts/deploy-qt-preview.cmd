@echo off
rem Deploy the freshly built Qt shell into the installed CodeWeave app.
rem Copies the freshly built executable when the installed preview is closed.
rem This helper never kills processes by image name; close only the preview
rem instance you started before rerunning it.
setlocal
set "SRC=%~dp0..\..\..\..\.local\qt\current\ui-qt\CodeWeaveQtShell.exe"
set "DST=%LOCALAPPDATA%\Programs\CodeWeave\CodeWeaveQtShell.exe"

if not exist "%SRC%" (
  echo [x] build not found: %SRC%
  exit /b 1
)

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
echo   launcher:  use the single application shortcut in the application folder
endlocal
