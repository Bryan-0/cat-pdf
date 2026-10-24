# Cat PDF - creates "Cat PDF" shortcuts on the Desktop and in the Start menu.
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'assets\icon.ico'
if (-not (Test-Path $electron)) { throw "Electron is not installed yet. Run scripts\setup.ps1 first." }

$shell = New-Object -ComObject WScript.Shell
$targets = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
foreach ($dir in $targets) {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'Cat PDF.lnk'))
    $lnk.TargetPath = $electron
    $lnk.Arguments = '"' + $root + '"'
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = $icon
    $lnk.Description = 'Cat PDF - local PDF manager'
    $lnk.Save()
    Write-Host "Created $($lnk.FullName)"
}
Write-Host "=^.^=  Double-click 'Cat PDF' on your Desktop to launch." -ForegroundColor DarkYellow
