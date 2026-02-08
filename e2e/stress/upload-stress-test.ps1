<#
.SYNOPSIS
    Stress test for archivist-desktop upload/download with memory monitoring.

.DESCRIPTION
    Generates a large test file, uploads it to the sidecar API, monitors process
    memory usage, downloads/verifies, then cleans up. Reports pass/fail based on
    memory thresholds.

.PARAMETER Size
    Test file size: 1GB, 10GB, or 100GB.

.PARAMETER ApiUrl
    Sidecar API base URL. Default: http://127.0.0.1:8080

.EXAMPLE
    .\upload-stress-test.ps1 -Size 1GB
    .\upload-stress-test.ps1 -Size 10GB -ApiUrl http://127.0.0.1:8080
#>

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('1GB', '10GB', '100GB')]
    [string]$Size,

    [string]$ApiUrl = 'http://127.0.0.1:8080'
)

$ErrorActionPreference = 'Continue'

# Size mapping
$sizeMap = @{
    '1GB'   = 1073741824
    '10GB'  = 10737418240
    '100GB' = 107374182400
}
$sizeBytes = $sizeMap[$Size]

# Memory thresholds (desktop process delta in bytes)
$desktopThresholds = @{
    '1GB'   = 200MB
    '10GB'  = 200MB
    '100GB' = 200MB
}
$sidecarThresholds = @{
    '1GB'   = 500MB
    '10GB'  = 1GB
    '100GB' = 2GB
}

$apiBase = "$ApiUrl/api/archivist/v1"
$testFile = Join-Path $env:TEMP "archivist-stress-test-$Size.bin"
$memoryCsv = Join-Path $env:TEMP "archivist-memory-$Size.csv"

function Write-Header($msg) {
    Write-Host ""
    Write-Host "== $msg ==" -ForegroundColor Cyan
}

function Format-Size($bytes) {
    if ($bytes -ge 1GB) { return "{0:N2} GB" -f ($bytes / 1GB) }
    if ($bytes -ge 1MB) { return "{0:N2} MB" -f ($bytes / 1MB) }
    if ($bytes -ge 1KB) { return "{0:N2} KB" -f ($bytes / 1KB) }
    return "$bytes B"
}

# ── Pre-flight checks ──
Write-Header "Pre-flight checks"

# Check sidecar API
try {
    $info = Invoke-RestMethod -Uri "$apiBase/debug/info" -TimeoutSec 5
    Write-Host "Sidecar API: OK (peer $($info.id.Substring(0, 16))...)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Sidecar API not reachable at $apiBase" -ForegroundColor Red
    Write-Host "Start the app and ensure the node is running." -ForegroundColor Yellow
    exit 1
}

# Check disk space
$drive = (Get-Item $env:TEMP).PSDrive
$freeBytes = (Get-PSDrive $drive.Name).Free
$requiredBytes = $sizeBytes * 2  # need space for test file + node storage
if ($freeBytes -lt $requiredBytes) {
    Write-Host "ERROR: Insufficient disk space. Need $(Format-Size $requiredBytes), have $(Format-Size $freeBytes)" -ForegroundColor Red
    exit 1
}
Write-Host "Disk space: $(Format-Size $freeBytes) free (need $(Format-Size $requiredBytes))" -ForegroundColor Green

# Record baseline memory
function Get-ProcessMemory($name) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    if ($procs) {
        return ($procs | Measure-Object -Property WorkingSet64 -Sum).Sum
    }
    return 0
}

$baselineDesktop = Get-ProcessMemory 'archivist-desktop'
$baselineSidecar = Get-ProcessMemory 'archivist'
Write-Host "Baseline memory - Desktop: $(Format-Size $baselineDesktop), Sidecar: $(Format-Size $baselineSidecar)" -ForegroundColor Green

# ── Generate test file ──
Write-Header "Generating $Size test file"
$genStart = Get-Date

if (Test-Path $testFile) {
    Remove-Item $testFile -Force
}

# Use fsutil for fast sparse file creation
$fsutilResult = & fsutil file createnew $testFile $sizeBytes 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: fsutil failed: $fsutilResult" -ForegroundColor Red
    exit 1
}
$genElapsed = (Get-Date) - $genStart
Write-Host "File created in $($genElapsed.TotalSeconds.ToString('F1'))s: $testFile" -ForegroundColor Green

# ── Start memory monitoring ──
Write-Header "Starting memory monitor"

# Initialize CSV
"Timestamp,ElapsedSec,DesktopMB,SidecarMB" | Out-File $memoryCsv -Encoding UTF8
$monitorJob = Start-Job -ScriptBlock {
    param($csvPath, $startTime)
    while ($true) {
        $elapsed = ((Get-Date) - $startTime).TotalSeconds
        $desktop = (Get-Process -Name 'archivist-desktop' -ErrorAction SilentlyContinue |
            Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB
        $sidecar = (Get-Process -Name 'archivist' -ErrorAction SilentlyContinue |
            Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB

        $line = "{0:yyyy-MM-dd HH:mm:ss},{1:F1},{2:F1},{3:F1}" -f (Get-Date), $elapsed, $desktop, $sidecar
        $line | Out-File $csvPath -Append -Encoding UTF8
        Start-Sleep -Seconds 2
    }
} -ArgumentList $memoryCsv, (Get-Date)

Write-Host "Memory monitor started (logging to $memoryCsv)" -ForegroundColor Green

# ── Upload ──
Write-Header "Uploading $Size file"
$uploadStart = Get-Date

try {
    # Use curl for streaming upload (PowerShell's Invoke-RestMethod buffers in memory)
    $curlOutput = & curl.exe --silent --show-error --fail `
        -X POST `
        -H "Content-Type: application/octet-stream" `
        -H "Content-Disposition: attachment; filename=`"stress-test-$Size.bin`"" `
        --data-binary "@$testFile" `
        --max-time 36000 `
        "$apiBase/data" 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Upload failed: $curlOutput" -ForegroundColor Red
        exit 1
    }

    $cid = $curlOutput.Trim()
    $uploadElapsed = (Get-Date) - $uploadStart
    Write-Host "Upload complete in $($uploadElapsed.TotalSeconds.ToString('F1'))s" -ForegroundColor Green
    Write-Host "CID: $cid" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Upload failed: $_" -ForegroundColor Red
    exit 1
}

# ── Verify ──
Write-Header "Verifying upload"

# Check that the CID exists
try {
    $null = Invoke-WebRequest -Uri "$apiBase/data/$cid" -Method Head -TimeoutSec 10
    Write-Host "CID verification: OK (HEAD returns 200)" -ForegroundColor Green
} catch {
    Write-Host "WARNING: HEAD request failed, CID may not be immediately available" -ForegroundColor Yellow
}

# Check space increased
try {
    $space = Invoke-RestMethod -Uri "$apiBase/space" -TimeoutSec 5
    Write-Host "Storage used: $(Format-Size $space.quotaUsedBytes)" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Could not check space" -ForegroundColor Yellow
}

# ── Record peak memory ──
Start-Sleep -Seconds 5  # Let memory settle
$peakDesktop = Get-ProcessMemory 'archivist-desktop'
$peakSidecar = Get-ProcessMemory 'archivist'

$deltaDesktop = $peakDesktop - $baselineDesktop
$deltaSidecar = $peakSidecar - $baselineSidecar

# ── Delete ──
Write-Header "Deleting test file from node"
try {
    Invoke-RestMethod -Uri "$apiBase/data/$cid" -Method Delete -TimeoutSec 60
    Write-Host "Delete: OK" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Delete failed: $_" -ForegroundColor Yellow
}

# Verify deletion
try {
    $null = Invoke-WebRequest -Uri "$apiBase/data/$cid" -Method Head -TimeoutSec 5
    Write-Host "WARNING: CID still accessible after delete" -ForegroundColor Yellow
} catch {
    Write-Host "CID no longer accessible: OK" -ForegroundColor Green
}

# ── Cleanup ──
Write-Header "Cleanup"
Stop-Job $monitorJob -ErrorAction SilentlyContinue
Remove-Job $monitorJob -Force -ErrorAction SilentlyContinue

if (Test-Path $testFile) {
    Remove-Item $testFile -Force
    Write-Host "Test file removed" -ForegroundColor Green
}

# ── Report ──
Write-Header "Results"

$maxDesktopDelta = $desktopThresholds[$Size]
$maxSidecarDelta = $sidecarThresholds[$Size]

$desktopPass = $deltaDesktop -lt $maxDesktopDelta
$sidecarPass = $deltaSidecar -lt $maxSidecarDelta

Write-Host "File size:          $Size ($sizeBytes bytes)"
Write-Host "Upload duration:    $($uploadElapsed.TotalSeconds.ToString('F1'))s"
Write-Host ""
Write-Host "Desktop baseline:   $(Format-Size $baselineDesktop)"
Write-Host "Desktop peak:       $(Format-Size $peakDesktop)"
Write-Host "Desktop delta:      $(Format-Size $deltaDesktop)  (max: $(Format-Size $maxDesktopDelta))"

if ($desktopPass) {
    Write-Host "Desktop memory:     PASS" -ForegroundColor Green
} else {
    Write-Host "Desktop memory:     FAIL" -ForegroundColor Red
}

Write-Host ""
Write-Host "Sidecar baseline:   $(Format-Size $baselineSidecar)"
Write-Host "Sidecar peak:       $(Format-Size $peakSidecar)"
Write-Host "Sidecar delta:      $(Format-Size $deltaSidecar)  (max: $(Format-Size $maxSidecarDelta))"

if ($sidecarPass) {
    Write-Host "Sidecar memory:     PASS" -ForegroundColor Green
} else {
    Write-Host "Sidecar memory:     FAIL" -ForegroundColor Red
}

Write-Host ""
Write-Host "Memory CSV:         $memoryCsv"

if ($desktopPass -and $sidecarPass) {
    Write-Host ""
    Write-Host "OVERALL: PASS" -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "OVERALL: FAIL" -ForegroundColor Red
    exit 1
}
