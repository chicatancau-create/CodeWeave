@echo off
setlocal
rem CodeWeave desktop source launcher. It starts this project's Electron shell
rem with explicit local release artifacts; it never looks outside E:\CodeWeave.
set "APP_ROOT=%~dp0"
set "RUNTIME=%APP_ROOT%artifacts\backend-runtime"
set "RENDERER=%APP_ROOT%..\网页端\dist"
if not exist "%RUNTIME%\backend\server.mjs" (
  echo [CodeWeave Desktop] Backend runtime artifact not found: %RUNTIME%
  echo Recreate it from the backend publish step before starting the app.
  pause
  exit /b 1
)
if not exist "%RENDERER%\index.html" (
  echo [CodeWeave Desktop] Web renderer artifact not found: %RENDERER%
  echo Run the web build before starting the app.
  pause
  exit /b 1
)
set "CODEWEAVE_DESKTOP_RUNTIME=%RUNTIME%"
set "CODEWEAVE_DESKTOP_RENDERER=%RENDERER%"
set "CODEWEAVE_DESKTOP_WORKSPACE=%APP_ROOT%..\工作区"
call corepack pnpm exec electron "%APP_ROOT%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%