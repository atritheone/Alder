param([Parameter(Mandatory=$true)][string]$FixtureDirectory, [switch]$OpenProbe, [switch]$RenderPdf, [switch]$RoundTrip, [switch]$Worker, [ValidateRange(5,120)][int]$TimeoutSeconds=30)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($FixtureDirectory)
$taskExports = Get-Content -LiteralPath (Join-Path $taskRoot 'fixture-exports.json') -Raw | ConvertFrom-Json
if (-not $Worker) {
    $taskStarted = Get-Date
    $taskBefore = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $taskArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-FixtureDirectory', ('"' + $taskRoot + '"'), '-Worker')
    if ($OpenProbe) { $taskArguments += '-OpenProbe' }
    if ($RenderPdf) { $taskArguments += '-RenderPdf' }
    if ($RoundTrip) { $taskArguments += '-RoundTrip' }
    $taskProcessRecord = Join-Path $taskRoot 'word-process.json'
    Remove-Item -LiteralPath $taskProcessRecord -Force -ErrorAction SilentlyContinue
    $taskProcess = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $taskArguments -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $taskRoot 'word-stderr.txt') -RedirectStandardOutput (Join-Path $taskRoot 'word-stdout.txt')
    # Cache the process handle before it exits (Windows PowerShell otherwise
    # sometimes loses ExitCode on a short-lived Start-Process instance).
    $taskProcessHandle = $taskProcess.Handle
    if (-not $taskProcess.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-Process -Id $taskProcess.Id
        $taskLast = Get-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Raw | ConvertFrom-Json
        @{ status='failed'; stage=$taskLast.stage; error="Word automation exceeded $TimeoutSeconds seconds." } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    }
    # COM processes are launched outside the worker's process tree. Only clean
    # the PID obtained from this worker's Word window, never another instance.
    if (Test-Path -LiteralPath $taskProcessRecord) {
        $taskOwnedPid = (Get-Content -LiteralPath $taskProcessRecord -Raw | ConvertFrom-Json).processId
        Get-CimInstance Win32_Process -Filter "ProcessId=$taskOwnedPid" | Where-Object { $_.Name -eq 'WINWORD.EXE' -and $_.ProcessId -notin $taskBefore -and $_.CreationDate -ge $taskStarted -and $_.CommandLine -match '/Automation -Embedding' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
    }
    $taskProcess.Refresh()
    $taskResult = Get-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Raw | ConvertFrom-Json
    if ($taskProcess.ExitCode -ne 0 -and $taskResult.status -eq 'passed') {
        @{status='failed'; error='Word worker failed during cleanup. See word-stderr.txt.'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    }
    if ($taskProcess.ExitCode -ne 0 -or $taskResult.status -ne 'passed') { exit 1 }
    exit 0
}
$taskWord = $null
$taskDocument = $null
$taskOwned = $false
@{ status='pending'; stage='Starting Word automation' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
try {
    $taskWord = New-Object -ComObject Word.Application
    if ($taskWord.Documents.Count -ne 0) { throw 'Word did not provide an empty isolated automation instance.' }
    $taskOwned = $true
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class AlderWordProcess { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid); }'
    $taskWord.Visible = $false
    $taskWord.DisplayAlerts = 0
    $taskWord.AutomationSecurity = 3
    @{ status='pending'; stage='Opening fixture' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    $taskDocument = $taskWord.Documents.Open($taskExports.docx.path, $false, $true, $false)
    [uint32]$taskWordPid = 0
    [void][AlderWordProcess]::GetWindowThreadProcessId([IntPtr]$taskDocument.ActiveWindow.Hwnd, [ref]$taskWordPid)
    @{processId=$taskWordPid} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-process.json') -Encoding utf8
    if ($OpenProbe) {
        @{ status='passed'; stage='Basic DOCX opened'; wordVersion=$taskWord.Version } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
        return
    }
    @{ status='pending'; stage='Repaginating' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    $taskDocument.Repaginate()
    $taskText = $taskDocument.Content.Text
    foreach ($taskExpected in @('Structured editing', 'First numbered item', 'Nested bullet', 'Second numbered item', 'Tall', 'Upper', 'Lower', 'Wide', 'final paragraph')) {
        if (-not $taskText.Contains($taskExpected)) { throw "Word lost expected wording: $taskExpected" }
    }
    @{ status='pending'; stage='Checking list numbers' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    $taskNumbers = @()
    foreach ($taskParagraph in $taskDocument.Paragraphs) {
        if ($taskParagraph.Range.Text -match '^(First|Second) numbered item') { $taskNumbers += $taskParagraph.Range.ListFormat.ListString }
    }
    if (($taskNumbers -join ',') -ne '4.,5.') { throw "Unexpected Word list numbering: $($taskNumbers -join ',')" }
    if ($RenderPdf) {
        @{ status='pending'; stage='Rendering PDF' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
        [string]$taskPdfPath = Join-Path $taskRoot 'word-rendered.pdf'
        $taskDocument.ExportAsFixedFormat($taskPdfPath, 17)
    }
    if ($RoundTrip) {
        @{ status='pending'; stage='Saving DOCX' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
        [string]$taskSavedPath = Join-Path $taskRoot 'word-resaved.docx'
        $taskDocxFormat = 16
        $taskDocument.SaveAs2([ref]$taskSavedPath, [ref]$taskDocxFormat)
    }
    @{ status='passed'; wordVersion=$taskWord.Version; pages=$taskDocument.ComputeStatistics(2); listNumbers=$taskNumbers; tables=$taskDocument.Tables.Count; renderedPdf=[bool]$RenderPdf; resavedDocx=[bool]$RoundTrip } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
} catch {
    @{ status='failed'; error=$_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    throw
} finally {
    $taskDoNotSave = 0
    if ($null -ne $taskDocument) { $taskDocument.Close([ref]$taskDoNotSave); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDocument) }
    if ($taskOwned) { $taskWord.Quit([ref]$taskDoNotSave) }
    if ($null -ne $taskWord) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord) }
}
