[CmdletBinding()]
param(
    [string]$ResourcesDirectory = (Join-Path $PSScriptRoot '..\work\bundle-resources'),
    [string]$CacheDirectory = (Join-Path $PSScriptRoot '..\work\tool-downloads')
)

# Build-time provisioning only. Alder launches these private resources directly;
# the finished application neither runs installers nor downloads dependencies.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$resourceRoot = [IO.Path]::GetFullPath($ResourcesDirectory)
$cacheRoot = [IO.Path]::GetFullPath($CacheDirectory)
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stagingRoot = Join-Path $workspaceRoot 'work\tool-build'
$toolRoot = Join-Path $resourceRoot 'tools'
$sourceRoot = Join-Path $resourceRoot 'sources'
New-Item -ItemType Directory -Force $resourceRoot,$cacheRoot,$stagingRoot,$toolRoot,$sourceRoot | Out-Null

$resources = @(
    [ordered]@{ id='temurin-jre'; version='21.0.12.1+1'; name='OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip';
        url='https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip';
        sha256='d35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636';
        license='GPL-2.0 WITH Classpath-exception-2.0 and component notices';
        licensePath='tools/java/legal'; sourceUrl='https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz';
        documentation='https://adoptium.net/docs/faq'; checksumSource='https://api.adoptium.net/v3/assets/version/21.0.12.1%2B1?architecture=x64&image_type=jre&os=windows' },
    [ordered]@{ id='temurin-source'; version='21.0.12.1+1'; name='OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz';
        url='https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz';
        sha256='573057d03584ae793fb7ec9a14c76d826d9187a53efeefd99da47403a5308234';
        license='GPL-2.0 WITH Classpath-exception-2.0 and component notices'; licensePath='tools/java/legal';
        sourceUrl='https://github.com/adoptium/jdk21u/tree/jdk-21.0.12.1%2B1_adopt' },
    [ordered]@{ id='calibre-portable'; version='9.14.0'; name='calibre-portable-installer-9.14.0.exe';
        url='https://download.calibre-ebook.com/9.14.0/calibre-portable-installer-9.14.0.exe';
        sha256='f784391870cbad568d49b19e13429632ba71dd7f77c427c9e899f5397730dfa8';
        license='GPL-3.0 and bundled component notices'; licensePath='tools/calibre/LICENSE';
        sourceUrl='https://github.com/kovidgoyal/calibre/releases/download/v9.14.0/calibre-9.14.0.tar.xz';
        documentation='https://calibre-ebook.com/download_portable'; checksumSource='https://api.github.com/repos/kovidgoyal/calibre/releases/tags/v9.14.0' },
    [ordered]@{ id='calibre-source'; version='9.14.0'; name='calibre-9.14.0.tar.xz';
        url='https://download.calibre-ebook.com/9.14.0/calibre-9.14.0.tar.xz';
        sha256='d1bc24024b0942429c627e9c5d0b25d51df9c1af1e1d8dca3e572f03b194c561';
        license='GPL-3.0 and component notices'; licensePath='tools/calibre/LICENSE';
        sourceUrl='https://github.com/kovidgoyal/calibre/tree/v9.14.0'; buildSourceUrl='https://github.com/kovidgoyal/bypy' },
    [ordered]@{ id='epubcheck'; version='5.3.0'; name='epubcheck-5.3.0.zip';
        url='https://github.com/w3c/epubcheck/releases/download/v5.3.0/epubcheck-5.3.0.zip';
        sha256='6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5';
        license='BSD-3-Clause and bundled library licenses'; licensePath='tools/epubcheck/epubcheck-5.3.0/LICENSE.txt';
        sourceUrl='https://github.com/w3c/epubcheck/tree/v5.3.0';
        documentation='https://www.w3.org/publishing/epubcheck/'; checksumSource='https://api.github.com/repos/w3c/epubcheck/releases/tags/v5.3.0' },
    [ordered]@{ id='liberation-fonts'; version='2.1.5'; name='liberation-fonts-ttf-2.1.5.tar.gz';
        url='https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz';
        sha256='7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0';
        license='SIL Open Font License 1.1'; licensePath='fonts/LICENSE';
        sourceUrl='https://github.com/liberationfonts/liberation-fonts/tree/2.1.5';
        documentation='https://github.com/liberationfonts/liberation-fonts' }
)

function Get-VerifiedResource([System.Collections.IDictionary]$item) {
    $destination = Join-Path $cacheRoot $item.name
    if (-not (Test-Path -LiteralPath $destination)) {
        Write-Host ('Downloading ' + $item.id + ' ' + $item.version)
        Invoke-WebRequest -Uri $item.url -OutFile ($destination + '.partial') -UseBasicParsing -TimeoutSec 180
        $actual = (Get-FileHash -LiteralPath ($destination + '.partial') -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $item.sha256) { throw ('Checksum mismatch for ' + $item.name) }
        Move-Item -LiteralPath ($destination + '.partial') -Destination $destination
    }
    $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $item.sha256) { throw ('Cached resource checksum mismatch for ' + $item.name) }
    return $destination
}

function Expand-VerifiedZip([string]$archive, [string]$destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $allowedRoot = [IO.Path]::GetFullPath($destination).TrimEnd('\') + '\'
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            $resolved = [IO.Path]::GetFullPath((Join-Path $destination $entry.FullName))
            if (-not $resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Archive contains a path outside its destination.'
            }
        }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
}

$downloads = @{}
foreach ($item in $resources) { $downloads[$item.id] = Get-VerifiedResource $item }

Write-Host 'Preparing private Java runtime'
$javaStage = Join-Path $stagingRoot 'temurin'
Expand-VerifiedZip $downloads['temurin-jre'] $javaStage
$javaBinary = Get-ChildItem -LiteralPath $javaStage -Filter java.exe -File -Recurse | Select-Object -First 1
if (-not $javaBinary) { throw 'Temurin archive did not contain java.exe.' }
$javaSource = $javaBinary.Directory.Parent.FullName
$javaDestination = Join-Path $toolRoot 'java'
New-Item -ItemType Directory -Force $javaDestination | Out-Null
Get-ChildItem -LiteralPath $javaSource -Force | Copy-Item -Destination $javaDestination -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $javaDestination 'legal'))) { throw 'Temurin legal notices are missing.' }

Write-Host 'Preparing private Calibre distribution'
$calibreStage = Join-Path $stagingRoot 'calibre-portable'
New-Item -ItemType Directory -Force $calibreStage | Out-Null
if (-not (Get-ChildItem -LiteralPath $calibreStage -Filter ebook-convert.exe -File -Recurse | Select-Object -First 1)) {
    # Upstream's extractor enforces a 58-character destination. A temporary
    # drive mapping keeps extraction inside the workspace even on long paths.
    $subst = Join-Path $env:SystemRoot 'System32\subst.exe'
    $drive = @('Z:','Y:','X:','W:','V:','U:','T:','S:','R:') | Where-Object { -not (Test-Path ($_ + '\')) } | Select-Object -First 1
    if (-not $drive) { throw 'No unused build drive letter is available for Calibre extraction.' }
    & $subst $drive $calibreStage
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create a temporary Calibre extraction drive.' }
    try {
        $process = Start-Process -FilePath $downloads['calibre-portable'] -ArgumentList ('"' + $drive + '\payload"') -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw ('Calibre portable extraction failed: ' + $process.ExitCode) }
    } finally {
        & $subst $drive /D
    }
}
$calibreBinary = Get-ChildItem -LiteralPath $calibreStage -Filter ebook-convert.exe -File -Recurse | Select-Object -First 1
if (-not $calibreBinary) { throw 'Calibre portable archive did not contain ebook-convert.exe.' }
$calibreDestination = Join-Path $toolRoot 'calibre'
New-Item -ItemType Directory -Force $calibreDestination | Out-Null
Get-ChildItem -LiteralPath $calibreBinary.Directory.FullName -Force | Copy-Item -Destination $calibreDestination -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $calibreDestination 'LICENSE'))) { throw 'Calibre license is missing.' }

Write-Host 'Preparing EPUBCheck and typography resources'
Expand-VerifiedZip $downloads['epubcheck'] (Join-Path $toolRoot 'epubcheck')
$fontDestination = Join-Path $resourceRoot 'fonts'
$fontStage = Join-Path $stagingRoot 'liberation-fonts'
New-Item -ItemType Directory -Force $fontDestination,$fontStage | Out-Null
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
& $tar -xzf $downloads['liberation-fonts'] -C $fontStage
if ($LASTEXITCODE -ne 0) { throw 'Font archive extraction failed.' }
Get-ChildItem -LiteralPath $fontStage -Recurse -File | Where-Object { $_.Name -like 'LiberationSerif-*.ttf' -or $_.Name -in @('LICENSE','AUTHORS') } | Copy-Item -Destination $fontDestination -Force
if (-not (Test-Path -LiteralPath (Join-Path $fontDestination 'LICENSE'))) { throw 'Font license is missing.' }

foreach ($id in @('calibre-source','temurin-source')) {
    Copy-Item -LiteralPath $downloads[$id] -Destination $sourceRoot -Force
}
$calibreNoticeStage = Join-Path $stagingRoot 'calibre-source-notices'
New-Item -ItemType Directory -Force $calibreNoticeStage | Out-Null
$bundledPython = Join-Path $resourceRoot 'python\python.exe'
if (-not (Test-Path -LiteralPath $bundledPython)) { throw 'Prepare the bundled core Python runtime before publishing tools.' }
$noticeScript = @'
import sys, tarfile
from pathlib import Path
archive, destination = sys.argv[1], Path(sys.argv[2])
names = ('calibre-9.14.0/COPYRIGHT', 'calibre-9.14.0/LICENSE.rtf', 'calibre-9.14.0/bypy/sources.json', 'calibre-9.14.0/bypy/README.rst')
with tarfile.open(archive, 'r:xz') as source:
    for name in names:
        output = destination / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(source.extractfile(name).read())
'@
& $bundledPython -s -c $noticeScript $downloads['calibre-source'] $calibreNoticeStage
if ($LASTEXITCODE -ne 0) { throw 'Cannot retain Calibre source notices and dependency source index.' }
Copy-Item -LiteralPath (Join-Path $calibreNoticeStage 'calibre-9.14.0/COPYRIGHT') -Destination (Join-Path $calibreDestination 'COPYRIGHT') -Force
Copy-Item -LiteralPath (Join-Path $calibreNoticeStage 'calibre-9.14.0/LICENSE.rtf') -Destination (Join-Path $calibreDestination 'LICENSE.rtf') -Force
Copy-Item -LiteralPath (Join-Path $calibreNoticeStage 'calibre-9.14.0/bypy/sources.json') -Destination (Join-Path $sourceRoot 'calibre-9.14.0-dependency-sources.json') -Force
Copy-Item -LiteralPath (Join-Path $calibreNoticeStage 'calibre-9.14.0/bypy/README.rst') -Destination (Join-Path $sourceRoot 'calibre-9.14.0-build-readme.rst') -Force
$manifest = [ordered]@{ schemaVersion=1; preparedAt=[DateTime]::UtcNow.ToString('o'); platform='windows-x64';
    purpose='Private runtime resources shipped with Alder; no end-user dependency installation.';
    resources=$resources; calibreDependencySources='sources/calibre-9.14.0-dependency-sources.json';
    sourcePolicy='Preserve included source archives, license files, legal trees and third-party notices in the release payload. Source URLs identify upstream build and dependency resources.' }
[IO.File]::WriteAllText((Join-Path $resourceRoot 'publishing-resource-manifest.json'), ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

Write-Host 'Verified publishing resources are ready.'
& (Join-Path $javaDestination 'bin\java.exe') -version
if ($LASTEXITCODE -ne 0) { throw 'Bundled Java smoke check failed.' }
& (Join-Path $calibreDestination 'ebook-convert.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Bundled Calibre smoke check failed.' }
