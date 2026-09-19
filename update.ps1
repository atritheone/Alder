# Update an existing Alder installation using this repository's version.
# All options are forwarded to setup; --check previews the update without building.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'setup.ps1') update @args
exit $LASTEXITCODE
