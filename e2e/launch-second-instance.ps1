# launch-second-instance.ps1
#
# Launches a second Archivist Desktop instance with non-conflicting ports
# for dual-instance P2P testing.
#
# Usage:
#   .\launch-second-instance.ps1
#   # Exports $global:SecondInstancePid for cleanup
#
# Cleanup:
#   Stop-Process -Id $global:SecondInstancePid -Force

$ErrorActionPreference = 'Continue'

# Ports for the second instance
$ApiPort     = 9080
$P2PPort     = 9070
$DiscPort    = 9090
$CdpPort     = 9223

# Separate data directory
$DataDir = "$env:LOCALAPPDATA\Archivist-E2E-Secondary"
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# Write a config file for the second instance
$ConfigDir = "$DataDir\config"
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

$ConfigContent = @"
[node]
api_port = $ApiPort
listen_port = $P2PPort
discovery_port = $DiscPort
data_dir = "$($DataDir -replace '\\', '\\')"
auto_start = true
"@

Set-Content -Path "$ConfigDir\config.toml" -Value $ConfigContent -Encoding UTF8

# Set CDP remote debugging port for WebView2
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"

# Set config directory override
$env:ARCHIVIST_CONFIG_DIR = $ConfigDir

# Find the installed executable
$ExePath = "$env:LOCALAPPDATA\Archivist\archivist-desktop.exe"
if (-not (Test-Path $ExePath)) {
    Write-Error "Archivist Desktop not found at: $ExePath"
    exit 1
}

Write-Host "Launching second instance..."
Write-Host "  CDP port:       $CdpPort"
Write-Host "  API port:       $ApiPort"
Write-Host "  P2P port:       $P2PPort"
Write-Host "  Discovery port: $DiscPort"
Write-Host "  Data dir:       $DataDir"

$process = Start-Process -FilePath $ExePath -PassThru
$global:SecondInstancePid = $process.Id

Write-Host "Second instance PID: $($process.Id)"
Write-Host "To stop: Stop-Process -Id $($process.Id) -Force"
