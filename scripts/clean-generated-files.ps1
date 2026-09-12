# Remove redundant build output and caches while keeping Alder runnable.
# Preview: powershell -File scripts/clean-generated-files.ps1 -WhatIf
[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$cleanupRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$cleanupPrefix = $cleanupRoot + '\'

# Start-Alder.cmd falls back to this development build after release is removed.
foreach ($required in @('node_modules\electron\dist\electron.exe', 'dist\index.html', 'dist-electron\main.cjs', 'work\bundle-resources\python\python.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot $required) -PathType Leaf)) {
        throw "Keep the release: the development build is incomplete ($required)."
    }
}

$cleanupTargets = @(
    'release',
    'work\tool-downloads',
    'work\tool-build',
    'work\core-downloads',
    'work\epubcheck-5.3.0.zip',
    'work\liberation-fonts-2.1.5.tar.gz',
    '.pytest_cache',
    'test-results',
    'work\pytest-final-cache',
    'work\pytest-source-ci-cache'
)
foreach ($source in @('backend', 'chatterbox')) {
    $cleanupTargets += @(Get-ChildItem -LiteralPath (Join-Path $cleanupRoot $source) -Directory -Force -Recurse |
        Where-Object Name -eq '__pycache__' |
        ForEach-Object { $_.FullName.Substring($cleanupPrefix.Length) })
}
$cleanupTracked = @(git -C $cleanupRoot ls-files)
if ($LASTEXITCODE -ne 0) { throw 'Cannot check tracked files; cleanup stopped.' }

# Validate the entire plan before deleting anything. OneDrive cloud attributes
# are allowed, but symbolic links and junctions are not traversed.
$cleanupPlan = @(foreach ($relative in $cleanupTargets) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $cleanupRoot $relative))
    if (-not $absolute.StartsWith($cleanupPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Target escapes workspace: $absolute"
    }
    if (-not (Test-Path -LiteralPath $absolute)) { continue }
    $ancestor = Get-Item -LiteralPath $absolute -Force
    while ($ancestor.FullName -ne $cleanupRoot) {
        if ($ancestor.LinkType) { throw "Linked target or ancestor: $($ancestor.FullName)" }
        $ancestor = Get-Item -LiteralPath (Split-Path -Parent $ancestor.FullName) -Force
    }
    $gitPath = $relative.Replace('\', '/')
    if (@($cleanupTracked | Where-Object { $_ -eq $gitPath -or $_.StartsWith($gitPath + '/') }).Count) {
        throw "Target contains tracked files: $relative"
    }
    $item = Get-Item -LiteralPath $absolute -Force
    $contents = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $absolute -Force -Recurse) } else { @($item) }
    if (@($contents | Where-Object LinkType).Count) { throw "Target contains links: $relative" }
    [pscustomobject]@{
        Path = $absolute
        Bytes = ($contents | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum
    }
})
foreach ($process in Get-CimInstance Win32_Process) {
    foreach ($target in $cleanupPlan) {
        if ($process.ExecutablePath -and $process.ExecutablePath.StartsWith($target.Path + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Close $($process.Name) (PID $($process.ProcessId)) before cleanup."
        }
    }
}

[long]$removedBytes = 0
foreach ($target in $cleanupPlan) {
    if ($PSCmdlet.ShouldProcess($target.Path, 'Delete generated files')) {
        Remove-Item -LiteralPath $target.Path -Recurse -Force
        $removedBytes += $target.Bytes
    }
}
Write-Output ('Removed {0:N2} GB of logical file content.' -f ($removedBytes / 1e9))
Write-Output 'Start-Alder.cmd uses the retained development build. npm run package recreates release/.'
