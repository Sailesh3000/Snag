@echo off
setlocal EnableDelayedExpansion
title Snag Setup

rem Always operate relative to THIS script's folder, never the caller's
rem current directory (double-clicking from Explorer, a shortcut, or a
rem different working directory must all behave the same way).
cd /d "%~dp0.."
set "ROOT=%CD%"
set "PY_VENV=%ROOT%\runtime\venv"
set "MARKER=%ROOT%\runtime\.installed"

echo ============================================
echo   Snag - Starting
echo ============================================
echo.

rem --- Already running? Check the actual port, not a fragile process guess. ---
netstat -ano | findstr ":8765 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo Snag is already running.
    goto :next_steps
)

rem --- Prerequisite: Python 3.12+ ---
set "PYEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py -3"
if not defined PYEXE (
    where python >nul 2>nul
    if not errorlevel 1 set "PYEXE=python"
)
if not defined PYEXE (
    echo [ERROR] Python was not found on this computer.
    echo.
    echo Snag needs Python 3.12 or newer. Install it from:
    echo   https://www.python.org/downloads/
    echo IMPORTANT: during install, tick "Add python.exe to PATH".
    echo Then double-click Start-Snag.bat again.
    echo.
    pause
    exit /b 1
)

rem --- One-time setup: virtual environment + dependencies ---
if not exist "%MARKER%" (
    echo First-time setup - this can take a few minutes, please wait...
    if not exist "%PY_VENV%" (
        %PYEXE% -m venv "%PY_VENV%"
        if errorlevel 1 (
            echo [ERROR] Could not create a Python environment.
            pause
            exit /b 1
        )
    )
    "%PY_VENV%\Scripts\python.exe" -m pip install --upgrade pip -q
    "%PY_VENV%\Scripts\python.exe" -m pip install -r "%ROOT%\backend\requirements.txt" -q
    if errorlevel 1 (
        echo.
        echo [ERROR] Setup failed while installing dependencies.
        echo Please contact whoever gave you this pilot build, with the message above.
        pause
        exit /b 1
    )
    echo done > "%MARKER%"
    echo Setup complete.
    echo.
)

rem --- Start the backend in its own window (so it survives this one closing) ---
echo Starting Snag backend...
start "Snag Backend" /D "%ROOT%" "%PY_VENV%\Scripts\python.exe" -m backend.app

rem --- Wait for it to actually come up before declaring success ---
set "READY=0"
for /L %%i in (1,1,30) do (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://127.0.0.1:8765/health -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 (
        set "READY=1"
        goto :ready_check_done
    )
    rem Not "timeout /t 1" - it's unreliable here for two real reasons:
    rem (1) some machines (anyone with Git for Windows on PATH) have a
    rem     different "timeout" binary shadowing the Windows one, with
    rem     incompatible syntax; (2) Windows' own timeout.exe refuses to
    rem     run at all when input is redirected. Pinging localhost with a
    rem     2-count is the classic, dependency-free way to sleep ~1s.
    ping -n 2 127.0.0.1 >nul
)
:ready_check_done

if "!READY!"=="0" (
    echo.
    echo [ERROR] Snag backend did not start within 30 seconds.
    echo Check the "Snag Backend" window for an error message and share it
    echo with whoever gave you this pilot build.
    pause
    exit /b 1
)

echo.
echo Snag backend started successfully.

:next_steps
echo.
echo ============================================
echo   Next steps
echo ============================================
echo 1. Open Chrome and go to:  chrome://extensions
echo 2. Turn on "Developer mode" (top-right toggle)
echo 3. Click "Load unpacked" and select the "extension" folder
echo    inside this Snag folder  (only needed the first time)
echo 4. Click the Snag icon in Chrome's toolbar, then right-click it -^> Options
echo 5. Copy your auth token below and paste it into "Backend Auth Token", then Save
echo.
if exist "%ROOT%\data\auth_token.txt" (
    echo Your auth token:
    type "%ROOT%\data\auth_token.txt"
    echo.
) else (
    echo Your auth token will appear in the "Snag Backend" window above.
)
echo 6. Open a job application page and start applying!
echo.
echo (You can close THIS window - Snag keeps running in the "Snag Backend" window.
echo  To stop Snag later, double-click Stop-Snag.bat.)
echo.
pause
