@echo off
title Snag Reset
cd /d "%~dp0.."
set "ROOT=%CD%"

echo ============================================
echo   Snag - Reset Local Data
echo ============================================
echo.
echo This will permanently delete your local Snag profile, resumes,
echo learned answers, and auth token from this folder:
echo   %ROOT%\data
echo.
echo It will NOT affect Chrome, any resume files elsewhere on your
echo computer, or any other application.
echo.
set /p CONFIRM="Type YES to continue: "
if /I not "%CONFIRM%"=="YES" (
    echo Cancelled - nothing was deleted.
    pause
    exit /b 0
)

rem Kill by port ownership, not window title — see Stop-Snag.bat for why.
powershell -NoProfile -Command ^
  "$p = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess;" ^
  "if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }" >nul 2>nul

if exist "%ROOT%\data\snag.db" del /f /q "%ROOT%\data\snag.db"
if exist "%ROOT%\data\snag.db-shm" del /f /q "%ROOT%\data\snag.db-shm"
if exist "%ROOT%\data\snag.db-wal" del /f /q "%ROOT%\data\snag.db-wal"
if exist "%ROOT%\data\auth_token.txt" del /f /q "%ROOT%\data\auth_token.txt"
if exist "%ROOT%\data\resumes" rd /s /q "%ROOT%\data\resumes"

echo.
echo Done. Your Snag data has been reset.
echo A new auth token will be generated next time you run Start-Snag.bat
echo (you'll need to paste it into the extension's Options page again).
echo.
pause
