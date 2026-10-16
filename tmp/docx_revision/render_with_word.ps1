$ErrorActionPreference = 'Stop'
$renderApp = $null
$renderDocument = $null
$ownedInstance = $false
try {
    $renderApp = New-Object -ComObject Word.Application
    $ownedInstance = $renderApp.Documents.Count -eq 0
    if ($ownedInstance) { $renderApp.Visible = $false }
    $renderApp.DisplayAlerts = 0
    $renderApp.AutomationSecurity = 3
    $sources = @(Get-ChildItem -LiteralPath 'D:\github\V0622\output\documents' -Filter '*0903_*.docx')
    if ($sources.Count -ne 1) { throw 'Expected one revised paper.' }
    $renderSource = $sources[0].FullName
    $renderDocument = $renderApp.Documents.Open($renderSource, $false, $true, $false)
    $renderDocument.Repaginate()
    $renderDocument.ExportAsFixedFormat('D:\github\V0622\tmp\docx_revision\render\revised.pdf', 17)
    Write-Output ('Rendered pages: ' + $renderDocument.ComputeStatistics(2))
} finally {
    $closeMode = 0
    if ($null -ne $renderDocument) { $renderDocument.Close([ref]$closeMode) }
    if ($null -ne $renderApp -and $ownedInstance) { $renderApp.Quit([ref]$closeMode) }
    if ($null -ne $renderDocument) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($renderDocument) }
    if ($null -ne $renderApp) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($renderApp) }
}
