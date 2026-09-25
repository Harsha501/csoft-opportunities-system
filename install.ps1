# C-Soft Opportunities Scanner - one-shot installer for a Windows machine.
#
# What this does, step by step:
#   1. Installs Node.js if it isn't already present (via winget)
#   2. Downloads the scraper code from GitHub (no git required)
#   3. Installs its dependencies (including a headless Chromium for Playwright)
#   4. Asks for the admin token once and saves it locally
#   5. Creates a Windows Scheduled Task that runs the scan daily at 07:00,
#      catching up automatically if the PC was off/asleep at that time
#
# Usage: right-click this file -> "Run with PowerShell". If Windows blocks it
# as an unsigned script, right-click -> Properties -> check "Unblock" -> OK,
# then try again.

$ErrorActionPreference = "Stop"
$InstallDir = "$env:LOCALAPPDATA\CSoftOpportunities"
$RepoZipUrl = "https://github.com/Harsha501/csoft-opportunities-system/archive/refs/heads/main.zip"
$TaskName = "CSoft Opportunities Scan"

Write-Host "`n=== C-Soft Opportunities Scanner - Setup ===`n" -ForegroundColor Cyan

# 1. Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found - installing (this may take a minute)..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    Write-Host "Node.js installed. Please close this window, re-open PowerShell, and run this script again so it picks up the new install." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "Node.js found: $(node --version)" -ForegroundColor Green
}

# 2. Download the code
Write-Host "`nDownloading scraper code..." -ForegroundColor Cyan
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$zipPath = "$env:TEMP\csoft-opportunities.zip"
Invoke-WebRequest -Uri $RepoZipUrl -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
Remove-Item $zipPath
# GitHub's zip extracts into a subfolder like "csoft-opportunities-system-main" - flatten it
$extracted = Get-ChildItem $InstallDir | Select-Object -First 1
Get-ChildItem $extracted.FullName | Move-Item -Destination $InstallDir
Remove-Item $extracted.FullName -Recurse -Force
Write-Host "Code downloaded to $InstallDir" -ForegroundColor Green

# 3. Install dependencies
Write-Host "`nInstalling dependencies (this can take a few minutes the first time)..." -ForegroundColor Cyan
Push-Location $InstallDir
npm install
npx playwright install --with-deps chromium
Pop-Location
Write-Host "Dependencies installed." -ForegroundColor Green

# 4. Admin token
Write-Host "`nOne-time setup: paste the admin token (same one used to log into the dashboard)." -ForegroundColor Cyan
$token = Read-Host "Admin token"
$config = @{
    "_comment" = "Never share this file or commit it anywhere public."
    "apiBase"  = "https://csoft-analytics-api.hydromech-engineers.workers.dev"
    "adminToken" = $token
} | ConvertTo-Json
Set-Content -Path "$InstallDir\config.json" -Value $config -Encoding utf8
Write-Host "Saved." -ForegroundColor Green

# 5. Scheduled task
Write-Host "`nSetting up the daily schedule (07:00 every day)..." -ForegroundColor Cyan
$batPath = "$InstallDir\run-daily.bat"
@"
@echo off
cd /d "$InstallDir"
node run-all.js ap_eprocurement aprera >> "$InstallDir\run-log.txt" 2>&1
"@ | Set-Content -Path $batPath -Encoding ascii

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $batPath
$trigger = New-ScheduledTaskTrigger -Daily -At 7:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Scheduled task created - it will run automatically every day at 07:00, and catch up if the PC was off/asleep at that time." -ForegroundColor Green

Write-Host "`n=== Setup complete ===" -ForegroundColor Cyan
Write-Host "Want to test it right now instead of waiting until tomorrow? Run:" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`"" -ForegroundColor White
Write-Host "Then check $InstallDir\run-log.txt for the result.`n" -ForegroundColor Yellow
