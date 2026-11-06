@echo off
setlocal
rem CodeWeave web client entry. The web project is self-contained.
rem The service receives this project's built renderer artifact explicitly.
set "WEB_ROOT=%~dp0..\"
set "PROJECT_ROOT=%WEB_ROOT%server"
set "STATIC_DIR=%WEB_ROOT%dist"
if not exist "%STATIC_DIR%\index.html" (
  echo [CodeWeave Web] dist\index.html not found. Run: corepack pnpm build
  pause
  exit /b 1
)
set "NODE_EXE="
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE (
  echo [CodeWeave Web] Node.js 22.13+ or 24+ not found. Install it or fix PATH.
  pause
  exit /b 1
)
set "CODEWEAVE_PROJECT_ROOT=%PROJECT_ROOT%"
set "CODEWEAVE_STATIC_DIR=%STATIC_DIR%"
if not defined CODE_CANVAS_NO_OPEN set "CODE_CANVAS_NO_OPEN=0"
"%NODE_EXE%" "%PROJECT_ROOT%\service\server.mjs" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
