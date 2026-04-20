# =============================================================================
# Archivist Desktop — App E2E Orchestrator (Windows)
#
# Drives the real installed app via Chrome DevTools Protocol (CDP) so Playwright
# can assert on UI state AND on sidecar log output.
#
# Flow:
#   1. Kill any running archivist-desktop / archivist processes
#   2. (Optional) Wipe the data dir for a fresh state
#   3. Launch the INSTALLED binary with WEBVIEW2 CDP debug port open
#   4. Wait for CDP to become reachable
#   5. Run `npx playwright test` against the new config
#   6. Kill the app
#
# Usage:
#   scripts/run-app-e2e.ps1                 # wipe data, launch, run all tests
#   scripts/run-app-e2e.ps1 -KeepData       # reuse the existing data dir
#   scripts/run-app-e2e.ps1 -Grep "Publish" # run only matching tests
# =============================================================================

param(
    [switch]$KeepData,
    [string]$Grep = "",
    [int]$CdpPort = 39333,  # Uncommon port — 9222 is taken by Microsoft 365 WebView2 on this machine
    [int]$ReadyTimeoutSec = 60
)

$ErrorActionPreference = 'Continue'   # let sub-invocations finish even on warnings
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$appExe = Join-Path $env:LOCALAPPDATA "Archivist\archivist-desktop.exe"
$dataDir = Join-Path $env:APPDATA "archivist"
$nodeLog = Join-Path $dataDir "node.log"

function Log-Section($msg) {
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

Log-Section "Pre-flight"

if (-not (Test-Path $appExe)) {
    Write-Host "ERROR: Installed app not found at $appExe" -ForegroundColor Red
    Write-Host "       Run 'pnpm test:release' first (or install the NSIS bundle)."
    exit 1
}
Write-Host "App binary: $appExe"
Write-Host "CDP port:   $CdpPort"
Write-Host "Data dir:   $dataDir"

# --- Step 1: kill any existing processes --------------------------------------
Log-Section "Killing existing archivist processes"
Get-Process -Name archivist-desktop, archivist -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  killing PID {0} ({1})" -f $_.Id, $_.ProcessName)
    $_ | Stop-Process -Force
}
Start-Sleep -Milliseconds 500

# --- Step 2: optionally wipe data dir ----------------------------------------
if ($KeepData) {
    Log-Section "Keeping existing data dir (--KeepData)"
} else {
    Log-Section "Wiping data dir for clean state"
    if (Test-Path $dataDir) {
        Remove-Item -Recurse -Force $dataDir
        Write-Host "  removed $dataDir"
    } else {
        Write-Host "  $dataDir did not exist"
    }
}

# --- Step 3: launch app with CDP ---------------------------------------------
Log-Section "Launching app with CDP on port $CdpPort"
# NOTE: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS must be set in the spawned
# process's environment. Setting $env: here affects this script's env which is
# inherited by Start-Process.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"
Start-Process -FilePath $appExe
Start-Sleep -Seconds 2

# --- Step 4: wait for CDP endpoint to expose the Archivist WebView -----------
# Not enough to just check TCP — other WebView2-based apps on this machine may
# already own a CDP port. We need to confirm the /json endpoint actually lists
# a page from tauri.localhost (the Archivist app).
Log-Section "Waiting for CDP endpoint to expose the Archivist WebView"
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
$cdpReady = $false
while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$CdpPort/json" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $pages = $resp.Content | ConvertFrom-Json
        $archivistPage = $pages | Where-Object { $_.url -match "tauri\.localhost|tauri://|localhost:1420" } | Select-Object -First 1
        if ($archivistPage) {
            $cdpReady = $true
            Write-Host "  CDP exposes Archivist WebView: $($archivistPage.url)"
            break
        }
    } catch {
        # endpoint not ready yet
    }
    Start-Sleep -Milliseconds 500
}
if (-not $cdpReady) {
    Write-Host "ERROR: Archivist WebView did not appear on CDP port $CdpPort within ${ReadyTimeoutSec}s" -ForegroundColor Red
    Write-Host "       Check whether another app is holding the port, or bump -CdpPort." -ForegroundColor Yellow
    Get-Process -Name archivist-desktop, archivist -ErrorAction SilentlyContinue | Stop-Process -Force
    exit 1
}

# --- Step 5: run playwright --------------------------------------------------
Log-Section "Running Playwright tests"
$playwrightArgs = @(
    "playwright", "test",
    "--config", "e2e/app-e2e/playwright.config.ts"
)
if ($Grep -ne "") {
    $playwrightArgs += @("--grep", $Grep)
}

Push-Location $repoRoot
try {
    $env:ARCHIVIST_CDP_URL = "http://127.0.0.1:$CdpPort"
    $env:ARCHIVIST_NODE_LOG = $nodeLog
    & pnpm exec @playwrightArgs
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
    Log-Section "Cleaning up"
    Get-Process -Name archivist-desktop, archivist -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ("  killing PID {0} ({1})" -f $_.Id, $_.ProcessName)
        $_ | Stop-Process -Force
    }
}

if ($exitCode -eq 0) {
    Write-Host "`n=== App E2E: PASS ===" -ForegroundColor Green
} else {
    Write-Host "`n=== App E2E: FAIL (exit $exitCode) ===" -ForegroundColor Red
}
exit $exitCode
