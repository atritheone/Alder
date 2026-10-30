param([Parameter(Mandatory=$true)][string]$FixtureDirectory, [switch]$OpenProbe, [switch]$RenderPdf, [switch]$RoundTrip, [switch]$OpenDocumentRoundTrip, [switch]$RtfRoundTrip, [switch]$UpdateFields, [switch]$Worker, [ValidateRange(5,120)][int]$TimeoutSeconds=30)
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
    if ($OpenDocumentRoundTrip) { $taskArguments += '-OpenDocumentRoundTrip' }
    if ($RtfRoundTrip) { $taskArguments += '-RtfRoundTrip' }
    if ($UpdateFields) { $taskArguments += '-UpdateFields' }
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
    if ($taskExports.watermarkProbe) {
        $taskShape = $taskDocument.Sections.Item(1).Headers.Item(1).Shapes.AddTextEffect(0, 'DRAFT', 'Cambria', 48, $false, $false, 0, 0)
        $taskShape.Name = 'PowerPlusWaterMarkObjectAlder'
        $taskShape.Rotation = 315
        $taskShape.Fill.ForeColor.RGB = 13684944
        $taskShape.Line.Visible = 0
        $taskShape.RelativeHorizontalPosition = 1
        $taskShape.RelativeVerticalPosition = 1
        $taskShape.Left = -999995
        $taskShape.Top = -999995
        $taskShape.WrapFormat.Type = 3
        $taskShape.ZOrder(5)
        @{width=$taskShape.Width;height=$taskShape.Height;fontSize=$taskShape.TextEffect.FontSize} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'watermark-shape.json') -Encoding utf8
    }
    if ($OpenProbe) {
        @{ status='passed'; stage='Basic DOCX opened'; wordVersion=$taskWord.Version } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
        return
    }
    @{ status='pending'; stage='Repaginating' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    $taskDocument.Repaginate()
    if ($taskExports.equationsExpected -and $taskDocument.OMaths.Count -ne $taskExports.equationsExpected) { throw 'Word did not retain every editable equation.' }
    if ($taskExports.formControlsExpected) {
        $taskControls = @()
        foreach ($taskControl in $taskDocument.ContentControls) {
            $taskControls += @{title=$taskControl.Title; tag=$taskControl.Tag; type=$taskControl.Type; lockContent=$taskControl.LockContents; lockDelete=$taskControl.LockContentControl; text=$taskControl.Range.Text}
        }
        $taskControls | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRoot 'word-form-fields.json') -Encoding utf8
        if ($taskControls.Count -ne $taskExports.formControlsExpected) { throw 'Word did not retain every native form control.' }
    }
    if ($UpdateFields) {
        # Only explicitly requested, trusted local fixtures use this path.
        if ($taskDocument.Fields.Update() -ne 0) {
            $taskFields = @()
            foreach ($taskField in $taskDocument.Fields) { $taskFields += @{code=$taskField.Code.Text; result=$taskField.Result.Text; type=$taskField.Type} }
            $taskFields | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRoot 'word-fields.json') -Encoding utf8
            throw 'Word could not update every fixture field.'
        }
        if ($taskExports.runningMatterExpected) {
            foreach ($taskSection in $taskDocument.Sections) {
                foreach ($taskStory in @($taskSection.Headers.Item(1),$taskSection.Headers.Item(2),$taskSection.Headers.Item(3),$taskSection.Footers.Item(1),$taskSection.Footers.Item(2),$taskSection.Footers.Item(3))) {
                    if ($taskStory.Exists -and $taskStory.Range.Fields.Update() -ne 0) { throw 'Word could not update a running-story field.' }
                }
            }
        }
        if ($taskExports.contentsExpected) {
            if ($taskDocument.TablesOfContents.Count -ne $taskExports.contentsExpected) { throw 'Word did not recognise the native contents field.' }
            foreach ($taskContents in $taskDocument.TablesOfContents) { $taskContents.Update() }
        }
        if ($taskExports.figuresExpected) {
            if ($taskDocument.TablesOfFigures.Count -ne $taskExports.figuresExpected) { throw 'Word did not recognise the native figure/table lists.' }
            foreach ($taskFigures in $taskDocument.TablesOfFigures) { $taskFigures.Update() }
        }
        if ($taskExports.indexesExpected) {
            if ($taskDocument.Indexes.Count -ne $taskExports.indexesExpected) { throw 'Word did not recognise the native index.' }
            foreach ($taskIndex in $taskDocument.Indexes) { $taskIndex.Update() }
            $taskFields = @()
            foreach ($taskField in $taskDocument.Fields) { $taskFields += @{code=$taskField.Code.Text; result=$taskField.Result.Text; type=$taskField.Type} }
            $taskFields | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRoot 'word-fields.json') -Encoding utf8
        }
    }
    $taskText = $taskDocument.Content.Text
    if ($taskExports.footnotesExpected -and $taskDocument.Footnotes.Count -ne $taskExports.footnotesExpected) { throw "Word did not recognise every footnote: expected $($taskExports.footnotesExpected), found $($taskDocument.Footnotes.Count); endnotes $($taskDocument.Endnotes.Count)." }
    if ($taskExports.endnotesExpected -and $taskDocument.Endnotes.Count -ne $taskExports.endnotesExpected) { throw 'Word did not recognise every endnote.' }
    $taskExpectedText = if ($taskExports.expectedText) { $taskExports.expectedText } else { @('Structured editing', 'First numbered item', 'Nested bullet', 'Second numbered item', 'Tall', 'Upper', 'Lower', 'Wide', 'final paragraph') }
    foreach ($taskExpected in $taskExpectedText) {
        if (-not $taskText.Contains($taskExpected)) { throw "Word lost expected wording: $taskExpected" }
    }
    @{ status='pending'; stage='Checking list numbers' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    $taskNumbers = @()
    foreach ($taskParagraph in $taskDocument.Paragraphs) {
        if ($taskParagraph.Range.Text -match '^(First|Second) numbered item') { $taskNumbers += $taskParagraph.Range.ListFormat.ListString }
    }
    if (-not $taskExports.skipListNumbers -and ($taskNumbers -join ',') -ne '4.,5.') { throw "Unexpected Word list numbering: $($taskNumbers -join ',')" }
    if ($taskExports.headingNumbersExpected) {
        $taskHeadingNumbers = @()
        foreach ($taskParagraph in $taskDocument.Paragraphs) {
            if ($taskParagraph.Range.Text -match '^HEADING_NUMBER_') { $taskHeadingNumbers += $taskParagraph.Range.ListFormat.ListString }
        }
        if (($taskHeadingNumbers -join ',') -ne ($taskExports.headingNumbersExpected -join ',')) { throw "Unexpected Word heading numbering: $($taskHeadingNumbers -join ',')" }
    }
    if ($taskExports.outlineNumbersExpected) {
        $taskOutlineNumbers = @()
        foreach ($taskParagraph in $taskDocument.Paragraphs) {
            if ($taskParagraph.Range.Text -match '^OUTLINE_') { $taskOutlineNumbers += $taskParagraph.Range.ListFormat.ListString }
        }
        if (($taskOutlineNumbers -join ',') -ne ($taskExports.outlineNumbersExpected -join ',')) { throw "Unexpected Word outline numbering: $($taskOutlineNumbers -join ',')" }
    }
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
    if ($OpenDocumentRoundTrip) {
        @{ status='pending'; stage='Saving ODT' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
        [string]$taskOdtPath = Join-Path $taskRoot 'word-resaved.odt'
        $taskOdtFormat = 23
        $taskDocument.SaveAs2([ref]$taskOdtPath, [ref]$taskOdtFormat)
    }
    if ($RtfRoundTrip) {
        @{ status='pending'; stage='Saving RTF' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
        [string]$taskRtfPath = Join-Path $taskRoot 'word-resaved.rtf'
        $taskRtfFormat = 6
        $taskDocument.SaveAs2([ref]$taskRtfPath, [ref]$taskRtfFormat)
    }
    @{ status='passed'; wordVersion=$taskWord.Version; pages=$taskDocument.ComputeStatistics(2); listNumbers=$taskNumbers; tables=$taskDocument.Tables.Count; renderedPdf=[bool]$RenderPdf; resavedDocx=[bool]$RoundTrip; resavedOdt=[bool]$OpenDocumentRoundTrip; resavedRtf=[bool]$RtfRoundTrip } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
} catch {
    @{ status='failed'; error=$_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'word-report.json') -Encoding utf8
    throw
} finally {
    $taskDoNotSave = 0
    if ($null -ne $taskDocument) { $taskDocument.Close([ref]$taskDoNotSave); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDocument) }
    if ($taskOwned) { $taskWord.Quit([ref]$taskDoNotSave) }
    if ($null -ne $taskWord) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord) }
}
