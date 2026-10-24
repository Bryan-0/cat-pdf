# Cat PDF - one-time setup: Python venv + backend deps + Electron.
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "=^.^=  Setting up Cat PDF in $root" -ForegroundColor DarkYellow

$venvPython = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Write-Host "Creating Python virtual environment..."
    $py = (Get-Command python -ErrorAction SilentlyContinue)
    if (-not $py) { throw "Python 3.10+ was not found on PATH. Install it from python.org first." }
    & python -m venv backend\.venv
}

Write-Host "Installing backend packages..."
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r backend\requirements.txt --quiet

Write-Host "Installing Electron..."
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Node.js / npm was not found. Install Node.js LTS first." }
npm install --no-audit --no-fund
# Newer npm versions can skip install scripts; Electron needs its postinstall to fetch the binary.
if (-not (Test-Path (Join-Path $root 'node_modules\electron\dist\electron.exe'))) {
    Write-Host "Downloading the Electron binary..."
    node (Join-Path $root 'node_modules\electron\install.js')
}

Write-Host ""
Write-Host "All set! Start the app with:  npm start" -ForegroundColor Green
Write-Host "Optional desktop shortcut:    powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1"
