$ErrorActionPreference = 'Continue'

# Set up PATH
$env:Path = "C:\Program Files\nodejs;" + $env:Path
$npmPrefix = & "C:\Program Files\nodejs\npm.cmd" prefix -g 2>$null
$env:Path = "$npmPrefix;" + $env:Path

Set-Location "C:\Users\anon\GitHub\archivist-desktop\e2e"

Write-Host "=== Installing e2e dependencies ===" -ForegroundColor Cyan
& "C:\Program Files\nodejs\npm.cmd" install 2>&1 | Out-Host

Write-Host ""
Write-Host "=== Installing Playwright browsers ===" -ForegroundColor Cyan
& npx playwright install chromium 2>&1 | Out-Host

Write-Host ""
Write-Host "=== Running Playwright tests ===" -ForegroundColor Cyan
& npx playwright test 2>&1 | Out-Host

Write-Host ""
Write-Host "=== Test run complete ===" -ForegroundColor Cyan
