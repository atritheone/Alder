# Bootstrap uses Windows PowerShell 5.1 or newer and the Windows tar utility.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$setupArguments = @($args)
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'ALDER_TARGET: Windows x64 is required.' }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ALDER_ROOT: Run setup in a normal, non-administrator terminal.' }
$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$stateRoot = if ($env:ALDER_SETUP_HOME) { $env:ALDER_SETUP_HOME } else { Join-Path $env:LOCALAPPDATA 'AlderSetup' }
for ($index = 0; $index -lt $setupArguments.Count; $index++) {
    if ($setupArguments[$index] -eq '--state-dir') { $stateRoot = $setupArguments[$index + 1] }
}
if (-not [IO.Path]::IsPathRooted($stateRoot)) { throw 'ALDER_PATH: --state-dir must be absolute.' }
$stateRoot = [IO.Path]::GetFullPath($stateRoot).TrimEnd('\')
if ($stateRoot.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $stateRoot -eq $sourceRoot -or $stateRoot -eq [IO.Path]::GetPathRoot($stateRoot).TrimEnd('\')) { throw 'ALDER_PATH: Setup state must be outside the repository and not a drive root.' }
$env:ALDER_SETUP_HOME = $stateRoot
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONNOUSERSITE = '1'
foreach ($name in @('PYTHONHOME','PYTHONPATH','VIRTUAL_ENV','CONDA_PREFIX')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
$record = (Get-Content -LiteralPath (Join-Path $sourceRoot 'resources/manifests/bootstrap.tsv') | Where-Object { $_.StartsWith("win32-x64`t") }).Split("`t")
if ($record.Count -ne 3) { throw 'ALDER_METADATA: Missing Windows bootstrap record.' }
$bootstrapRoot = Join-Path $stateRoot 'bootstrap'
$base = Join-Path $bootstrapRoot ('win32-x64-' + $record[2])
if (($setupArguments -contains 'repair') -or -not (Test-Path -LiteralPath (Join-Path $base '.complete'))) {
    New-Item -ItemType Directory -Force $bootstrapRoot | Out-Null
    $lockPath = Join-Path $bootstrapRoot '.lock'
    $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    try {
        $archive = Join-Path $bootstrapRoot ($record[2] + '.tar.gz')
        if (-not (Test-Path -LiteralPath $archive)) {
            if ($setupArguments -contains '--offline') { throw 'ALDER_OFFLINE: Bootstrap archive is not cached.' }
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $record[1] -OutFile ($archive + '.partial') -UseBasicParsing
            Move-Item -LiteralPath ($archive + '.partial') -Destination $archive
        }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record[2]) { throw "ALDER_HASH: Bootstrap checksum mismatch: $archive" }
        $stage = Join-Path $bootstrapRoot ('stage-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory $stage | Out-Null
        & tar.exe -xzf $archive -C $stage --strip-components=1
        if ($LASTEXITCODE -ne 0) { throw 'ALDER_EXTRACT: Bootstrap extraction failed.' }
        & (Join-Path $stage 'python.exe') -I -c 'import ssl,sys; assert sys.version_info[:2] == (3,11)'
        if ($LASTEXITCODE -ne 0) { throw 'ALDER_BOOTSTRAP: Python did not start.' }
        [IO.File]::WriteAllText((Join-Path $stage '.complete'), $record[2])
        if (Test-Path -LiteralPath $base) { Move-Item -LiteralPath $base -Destination ($base + '.incomplete-' + [Guid]::NewGuid().ToString('N')) }
        Move-Item -LiteralPath $stage -Destination $base
    } finally { $lock.Dispose() }
}
& (Join-Path $base 'python.exe') -B (Join-Path $sourceRoot 'scripts/setup/cli.py') @setupArguments
exit $LASTEXITCODE
