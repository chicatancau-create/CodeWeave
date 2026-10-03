@echo off
setlocal
rem CodeWeave desktop source launcher. It starts this project's Electron shell
rem with explicit local release artifacts; it never looks outside this workspace.
rem
rem Three rules below are load-bearing for this entry point:
rem   1. Save with CRLF endings. On LF-only files cmd.exe resyncs mid-line and
rem      silently drops characters, so the set lines below never ran and
rem      electron was launched with an empty app path (Electron usage banner +
rem      the stock "Electron" welcome window).
rem   2. Keep this file 7-bit ASCII. cmd.exe reads .cmd in the OEM codepage, so
rem      UTF-8 Chinese folder names turn into mojibake paths. The sibling
rem      project dirs are resolved from the filesystem at runtime instead.
set "APP_ROOT=%~dp0"
for %%P in ("%APP_ROOT%..") do set "WORKSPACE_ROOT=%%~fP"
set "RUNTIME=%APP_ROOT%artifacts\backend-runtime"

set "RENDERER="
for /d %%D in ("%WORKSPACE_ROOT%\*") do if exist "%%D\dist\index.html" if not defined RENDERER set "RENDERER=%%D\dist"

set "DESKTOP_WORKSPACE="
for /d %%D in ("%WORKSPACE_ROOT%\*") do if exist "%%D\config\codeweave.config.example.json" if not defined DESKTOP_WORKSPACE set "DESKTOP_WORKSPACE=%%D"

if not exist "%RUNTIME%\backend\server.mjs" (
  echo [CodeWeave Desktop] Backend runtime artifact not found: %RUNTIME%
  echo Recreate it from the backend publish step before starting the app.
  pause
  exit /b 1
)
if not exist "%RENDERER%\index.html" (
  echo [CodeWeave Desktop] Web renderer artifact not found: no sibling dir with dist\index.html under %WORKSPACE_ROOT%
  echo Run the web build before starting the app.
  pause
  exit /b 1
)
if not defined DESKTOP_WORKSPACE (
  echo [CodeWeave Desktop] Workspace dir not found under %WORKSPACE_ROOT%, the app will ask for it manually.
)

set "CODEWEAVE_DESKTOP_RUNTIME=%RUNTIME%"
set "CODEWEAVE_DESKTOP_RENDERER=%RENDERER%"
set "CODEWEAVE_DESKTOP_WORKSPACE=%DESKTOP_WORKSPACE%"
rem %APP_ROOT% ends with a backslash. A backslash right before a quote escapes
rem it, so electron must receive the app dir with that trailing separator removed.
set "APP_DIR=%APP_ROOT:~0,-1%"
call corepack pnpm exec electron "%APP_DIR%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
