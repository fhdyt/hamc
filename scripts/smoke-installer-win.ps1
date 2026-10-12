# Installs the NSIS installer silently into a temporary folder, runs the first-run Playwright suite against the installed
# app, and uninstalls it again. Run "npm run dist:win" first. Usage: powershell -File scripts/smoke-installer-win.ps1
param([string]$Installer = '')

$ErrorActionPreference = 'Stop'
if (-not $Installer) {
  $Installer = (Get-ChildItem -Path 'dist' -Filter 'hermes-mission-control-*-win-x64.exe' | Where-Object { $_.Name -notmatch 'uninstaller' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not $Installer -or -not (Test-Path $Installer)) { throw 'No installer found in dist/. Run "npm run dist:win" first.' }

$dir = Join-Path $env:TEMP ('mc-installed-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$exe = Join-Path $dir 'Hermes Agent Mission Control.exe'
$uninstaller = Join-Path $dir 'Uninstall Hermes Agent Mission Control.exe'
Write-Host "Installing $Installer into $dir"
# /D must be the last argument and must not be quoted (NSIS rule).
Start-Process -FilePath $Installer -ArgumentList '/S', "/D=$dir" -Wait
if (-not (Test-Path $exe)) { throw "The installer did not create $exe" }
if (-not (Test-Path (Join-Path $dir 'resources\mc_collector.py'))) { throw 'The installed app has no resources\mc_collector.py' }

$code = 1
try {
  $env:MC_PACKAGED_EXE = $exe
  node scripts/e2e-packaged.mjs app.spec.ts
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:MC_PACKAGED_EXE -ErrorAction SilentlyContinue
  if (Test-Path $uninstaller) {
    Write-Host 'Uninstalling'
    Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
    # The NSIS uninstaller copies itself and returns at once; wait until the app is gone.
    for ($i = 0; $i -lt 60 -and (Test-Path $exe); $i++) { Start-Sleep -Milliseconds 500 }
  }
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}
if (Test-Path $exe) { throw 'The uninstaller left the app behind' }
exit $code
