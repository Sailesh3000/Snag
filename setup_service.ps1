# Setup SnagBackend as a Windows service using NSSM.
# Run from an elevated (Administrator) PowerShell:  .\setup_service.ps1
# Also supports:  .\setup_service.ps1 -Uninstall   (removes the service)

param(
    [switch]$Uninstall,
    [switch]$ForceInstallNssm
)

$ErrorActionPreference = "Stop"

$ServiceName = "SnagBackend"
$ServiceDisplayName = "Snag Backend"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $RepoRoot "logs"

# --- 0. Admin check ----------------------------------------------------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "WARNING: Not running as Administrator." -ForegroundColor Yellow
    Write-Host "  NSSM service installation requires elevated privileges." -ForegroundColor Yellow
    Write-Host "  Restart this script from an elevated PowerShell prompt." -ForegroundColor Yellow
    Write-Host "  Continuing anyway may fail with 'Access is denied'." -ForegroundColor Yellow
}

# --- 1. NSSM availability ----------------------------------------------------
$nssm = Get-Command nssm.exe -ErrorAction SilentlyContinue

if (-not $nssm) {
    # Not on PATH (e.g. winget just installed it and the shell hasn't restarted).
    # Search common install locations.
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\NSSM*\*\win64\nssm.exe"),
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\NSSM*\*\win32\nssm.exe"),
        (Join-Path ${env:ProgramFiles} "NSSM\*\win64\nssm.exe"),
        (Join-Path ${env:ProgramFiles} "NSSM\*\win32\nssm.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "NSSM\*\win64\nssm.exe")
    )
    foreach ($pattern in $candidates) {
        $match = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($match) {
            $nssm = New-Object PSObject -Property @{ Source = $match.FullName }
            break
        }
    }
}

if (-not $nssm) {
    if ($ForceInstallNssm) {
        Write-Host "Installing NSSM via winget..." -ForegroundColor Cyan
        winget install --id NSSM.NSSM -e --accept-source-agreements --accept-package-agreements | Out-Host
        $nssm = Get-Command nssm.exe -ErrorAction SilentlyContinue
        if (-not $nssm) {
            $match = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\NSSM*\*\win64\nssm.exe") -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($match) { $nssm = New-Object PSObject -Property @{ Source = $match.FullName } }
        }
    }
}

if (-not $nssm) {
    Write-Host "ERROR: NSSM was not found." -ForegroundColor Red
    Write-Host "  Install it with:  winget install --id NSSM.NSSM -e" -ForegroundColor Yellow
    Write-Host "  or re-run this script with:  .\setup_service.ps1 -ForceInstallNssm" -ForegroundColor Yellow
    exit 1
}

Write-Host "NSSM found: $($nssm.Source)" -ForegroundColor Green

# --- 2. Locate Python --------------------------------------------------------
$python = $null
foreach ($candidate in @(
    (Join-Path $RepoRoot ".venv\Scripts\python.exe"),
    (Join-Path $RepoRoot "venv\Scripts\python.exe")
)) {
    if (Test-Path $candidate) { $python = $candidate; break }
}
if (-not $python) {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { $python = $cmd.Source }
}
if (-not $python) {
    Write-Host "ERROR: Could not find a Python executable." -ForegroundColor Red
    exit 1
}
Write-Host "Using Python: $python" -ForegroundColor Green

# --- 3. Create log dir -------------------------------------------------------
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# --- Uninstall ----------------------------------------------------------------
if ($Uninstall) {
    Write-Host "Stopping and removing service '$ServiceName'..." -ForegroundColor Cyan
    & $nssm.Source stop $ServiceName 2>$null | Out-Null
    & $nssm.Source remove $ServiceName confirm 2>$null | Out-Null
    Write-Host "Service removed." -ForegroundColor Green
    exit 0
}

# --- 4. Install service ------------------------------------------------------
Write-Host "Installing service '$ServiceName'..." -ForegroundColor Cyan
& $nssm.Source install $ServiceName $python "-m" "backend.app" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: nssm install failed." -ForegroundColor Red; exit 1 }

& $nssm.Source set $ServiceName AppDirectory $RepoRoot | Out-Null
& $nssm.Source set $ServiceName DisplayName $ServiceDisplayName | Out-Null
& $nssm.Source set $ServiceName Description "Snag AI job-application copilot backend (FastAPI on 127.0.0.1:8765)" | Out-Null

# --- 5. Logging --------------------------------------------------------------
& $nssm.Source set $ServiceName AppStdout (Join-Path $LogDir "service_stdout.log") | Out-Null
& $nssm.Source set $ServiceName AppStderr (Join-Path $LogDir "service_stderr.log") | Out-Null

# --- 6. Restart behavior -----------------------------------------------------
& $nssm.Source set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $nssm.Source set $ServiceName AppExit Default Restart | Out-Null
& $nssm.Source set $ServiceName AppRestartDelay 5000 | Out-Null

Write-Host ""
Write-Host "Service '$ServiceName' installed." -ForegroundColor Green
Write-Host "  Command:   $python -m backend.app" -ForegroundColor Gray
Write-Host "  Working:   $RepoRoot" -ForegroundColor Gray
Write-Host "  Logs:      $LogDir\service_stdout.log / service_stderr.log" -ForegroundColor Gray
Write-Host ""
Write-Host "Starting service..." -ForegroundColor Cyan
& $nssm.Source start $ServiceName | Out-Null

Write-Host ""
Write-Host "Done. Manage it with:  services.msc  (look for '$ServiceDisplayName')" -ForegroundColor Green
Write-Host "Or from CLI:" -ForegroundColor Green
Write-Host "  sc query $ServiceName" -ForegroundColor Gray
Write-Host "  nssm restart $ServiceName" -ForegroundColor Gray
Write-Host "  .\setup_service.ps1 -Uninstall" -ForegroundColor Gray
