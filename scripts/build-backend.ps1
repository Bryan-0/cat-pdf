# Cat PDF - freezes the Python backend into build\backend-dist\catpdf-backend\catpdf-backend.exe
# (PyInstaller, one folder) so the installed app doesn't need Python.
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File scripts\build-backend.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Run scripts\setup.ps1 first (backend\.venv is missing)." }

& $python -m pip install --quiet "pyinstaller>=6.10"
if ($LASTEXITCODE -ne 0) { throw "Could not install PyInstaller." }

$build = Join-Path $root 'build'
Push-Location (Join-Path $root 'backend')
try {
    & $python -m PyInstaller run_backend.py `
        --name catpdf-backend --onedir --console --noconfirm --clean `
        --distpath (Join-Path $build 'backend-dist') `
        --workpath (Join-Path $build 'pyinstaller') `
        --specpath $build `
        --icon (Join-Path $root 'assets\icon.ico') `
        --collect-all pymupdf --collect-all pymupdf4llm `
        --collect-submodules uvicorn --collect-submodules mammoth `
        --hidden-import win32com.client --hidden-import pythoncom `
        --exclude-module pytest --exclude-module tkinter
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed." }
} finally {
    Pop-Location
}
Write-Host "Backend built: build\backend-dist\catpdf-backend\catpdf-backend.exe" -ForegroundColor Green
