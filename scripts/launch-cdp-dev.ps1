$ErrorActionPreference = 'Continue'

# Kill any existing archivist processes
Get-Process -Name 'archivist*' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# Set CDP env var
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'

# Use the build output directly
$exePath = "C:\Users\anon\GitHub\archivist-desktop\src-tauri\target\release\archivist-desktop.exe"
if (-not (Test-Path $exePath)) {
    Write-Host "ERROR: $exePath not found. Run 'pnpm tauri build' first." -ForegroundColor Red
    exit 1
}

Write-Host "Launching: $exePath" -ForegroundColor Cyan
Write-Host "CDP env var: $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exePath
$psi.UseShellExecute = $false
$psi.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9222'
$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "Started PID: $($proc.Id)"

# Wait for CDP port
Write-Host "Waiting for CDP port 9222..."
$timeout = 60
$start = Get-Date

while (((Get-Date) - $start).TotalSeconds -lt $timeout) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", 9222)
        $tcp.Close()
        Write-Host "CDP port 9222 is ready!" -ForegroundColor Green

        # Show processes
        Get-Process -Name 'archivist*' -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "  $($_.ProcessName) (PID $($_.Id), $([Math]::Round($_.WorkingSet64 / 1MB, 1)) MB)"
        }
        exit 0
    } catch {
        Start-Sleep -Seconds 1
    }
}

Write-Host "CDP port 9222 not available after $timeout seconds" -ForegroundColor Red
Get-Process -Name 'archivist*' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  $($_.ProcessName) (PID $($_.Id), $([Math]::Round($_.WorkingSet64 / 1MB, 1)) MB)"
}
exit 1
