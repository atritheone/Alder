param([string]$InstallerDirectory = 'release/Alder-0.11.0-Windows-x64')
$ErrorActionPreference = 'Stop'
$workspacePath = (Get-Location).Path
$validationRoot = Join-Path $workspacePath ('work/installer-validation-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$targetPath = [IO.Path]::GetFullPath((Join-Path $validationRoot 'Alder'))
$workRoot = [IO.Path]::GetFullPath((Join-Path $workspacePath 'work')) + [IO.Path]::DirectorySeparatorChar
if (-not $targetPath.StartsWith($workRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test installation must remain in work/' }
$installerPath = (Get-ChildItem -LiteralPath $InstallerDirectory -Filter '*-Setup.exe').FullName
if (-not $installerPath -or $installerPath -is [array]) { throw 'Choose one installer build' }
New-Item -ItemType Directory -Path $validationRoot -Force | Out-Null
$missingPayloadDir = Join-Path $validationRoot 'missing-payload'
New-Item -ItemType Directory -Path $missingPayloadDir | Out-Null
$missingInstaller = Join-Path $missingPayloadDir 'Setup.exe'
Copy-Item -LiteralPath $installerPath -Destination $missingInstaller
$missing = Start-Process -FilePath $missingInstaller -ArgumentList "/S /TEST /D=$targetPath" -WindowStyle Hidden -PassThru -Wait
if ($missing.ExitCode -ne 2) { throw "Missing payload was not rejected: $($missing.ExitCode)" }
$install = Start-Process -FilePath $installerPath -ArgumentList "/S /TEST /D=$targetPath" -WindowStyle Hidden -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "Installation failed: $($install.ExitCode)" }
$marker = Get-Content -LiteralPath (Join-Path $targetPath '.alder-install.ini') -Raw
if ($marker -notmatch 'TestMode=1') { throw 'Test mode was not used' }
$env:ALDER_DATA_DIR = Join-Path $validationRoot 'data'
$env:ALDER_SMOKE_OUTPUT = Join-Path $validationRoot 'smoke.json'
$env:PYTHONNOUSERSITE = '1'
Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
Remove-Item Env:ALDER_RESOURCES_DIR -ErrorAction SilentlyContinue
$env:PATH = Join-Path $env:SystemRoot 'System32'
$launch = Start-Process -FilePath (Join-Path $targetPath 'Alder.exe') -ArgumentList @('--smoke-test', ('--user-data-dir="' + (Join-Path $validationRoot 'chromium') + '"')) -WindowStyle Hidden -PassThru -Wait
if ($launch.ExitCode -ne 0) { throw "Installed app failed: $($launch.ExitCode)" }
$smoke = Get-Content -LiteralPath $env:ALDER_SMOKE_OUTPUT -Raw | ConvertFrom-Json
if (-not $smoke.ok) { throw 'Installed app smoke check failed' }
# An unrelated file in the install folder must survive uninstall.
$preserved = Join-Path $targetPath 'user-file.txt'
Set-Content -LiteralPath $preserved -Value 'Preserve this user file.'
$uninstall = Start-Process -FilePath (Join-Path $targetPath 'Uninstall Alder.exe') -ArgumentList "/S _?=$targetPath" -WindowStyle Hidden -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "Uninstall failed: $($uninstall.ExitCode)" }
if (Test-Path -LiteralPath (Join-Path $targetPath 'Alder.exe')) { throw 'Uninstall left the app executable' }
if (Test-Path -LiteralPath (Join-Path $targetPath 'resources')) {
  $remainingFiles = @(Get-ChildItem -LiteralPath (Join-Path $targetPath 'resources') -Recurse -File)
  if ($remainingFiles.Count -gt 0) { throw "Uninstall left $($remainingFiles.Count) shipped resource files" }
}
if (-not (Test-Path -LiteralPath $preserved)) { throw 'Uninstall deleted an unrelated file' }
if (-not (Test-Path -LiteralPath $env:ALDER_DATA_DIR)) { throw 'Uninstall removed user data' }
$result = [pscustomobject]@{status='passed';missingPayloadRejected=$true;installed=$true;launched=$smoke.ok;uninstalled=$true;userFilePreserved=$true;userDataPreserved=$true;validationRoot=$validationRoot}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $validationRoot 'result.json')
$result | ConvertTo-Json
