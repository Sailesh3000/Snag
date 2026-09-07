@echo off
title Snag Stop

echo Stopping Snag...

rem Kill by PORT OWNERSHIP, not by window title. Window-title matching
rem (tasklist/taskkill /FI "WINDOWTITLE eq ...") is unreliable here: on
rem Windows Terminal (the default terminal host on modern Windows 11), the
rem process actually holding that window title is WindowsTerminal.exe
rem itself, not python.exe/cmd.exe — so title-based filters silently miss
rem it. The port is the one thing that's always true regardless of which
rem terminal app is hosting the window.
set "RESULT_FILE=%TEMP%\snag_stop_result_%RANDOM%.txt"
powershell -NoProfile -Command ^
  "$p = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess;" ^
  "if (-not $p) { 'NOTRUNNING'; exit }" ^
  "Stop-Process -Id $p -Force -ErrorAction SilentlyContinue;" ^
  "Start-Sleep -Milliseconds 500;" ^
  "$still = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($still) { 'FAILED' } else { 'STOPPED' }" > "%RESULT_FILE%" 2>nul

findstr /C:"STOPPED" "%RESULT_FILE%" >nul 2>nul
if not errorlevel 1 (
    echo Snag backend stopped.
) else (
    findstr /C:"FAILED" "%RESULT_FILE%" >nul 2>nul
    if not errorlevel 1 (
        echo Couldn't stop Snag automatically - please close the "Snag Backend" window manually.
    ) else (
        echo Snag wasn't running.
    )
)
del /f /q "%RESULT_FILE%" >nul 2>nul
echo.
pause
