@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Instrop One-Click Setup ^& App Builder
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Installing Node.js LTS via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo Please close this window and double-click build-instrop.bat again after Node.js finishes installing.
  pause
  exit /b 1
)

set "FOUND_JAVA=0"
if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" set "FOUND_JAVA=1"
where java >nul 2>nul
if not errorlevel 1 set "FOUND_JAVA=1"

if "%FOUND_JAVA%"=="0" (
  echo Java JDK 21 not found. Installing Microsoft OpenJDK 21 via winget...
  winget install -e --id Microsoft.OpenJDK.21 --accept-source-agreements --accept-package-agreements
)

node scripts\build-apps.mjs %*
if errorlevel 1 (
  echo.
  echo Build stopped with an error. See details above.
  pause
  exit /b 1
)

echo.
echo Finished! Opening release folder...
if exist "release" explorer "release"
pause
