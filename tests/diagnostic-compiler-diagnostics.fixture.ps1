# Native PowerShell fixture-only test. Fixed in-memory objects, no compiler or process APIs.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/diagnostic-compiler-diagnostics.ps1')
$passed = New-Object 'System.Collections.Generic.List[string]'
$failed = New-Object 'System.Collections.Generic.List[object]'
function Assert-Fixture {
    param([bool]$Condition, [string]$Name)
    if (-not $Condition) { throw [Exception]::new($Name) }
}
function Invoke-Fixture {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; $passed.Add($Name) }
    catch {
        # Preserve a bounded failure reason without source, stack, or invocation metadata.
        $exception = $_.Exception
        $type = $exception.GetType().FullName
        if ($type.Length -gt 160) { $type = $type.Substring(0, 160) }
        $message = [string]$exception.Message
        $prefix = $message.Substring(0, [Math]::Min(4096, $message.Length))
        $first = [regex]::Match($prefix, '(?m)^[ \t]*(?<line>\S[^\r\n]*)')
        $text = $(if ($first.Success) { ConvertTo-SafeCompilerText $first.Groups['line'].Value } else { '[empty fixture failure]' })
        $failed.Add([ordered]@{ fixture = $Name; exceptionType = $type; message = $text })
    }
}
Invoke-Fixture 'nested-collections-and-structured-compiler-error' {
    $compiler = [System.CodeDom.Compiler.CompilerError]::new('C:\private\temporary.cs', 42, 17, 'CS1503', "Cannot convert argument`r`nSOURCE_EXCERPT_SENTINEL")
    $record = [Management.Automation.ErrorRecord]::new([Exception]::new('Compiler wrapper'), 'fixture.compiler', [Management.Automation.ErrorCategory]::InvalidData, $compiler)
    $compilerCollection = [System.CodeDom.Compiler.CompilerErrorCollection]::new()
    [void]$compilerCollection.Add($compiler)
    $items = [Collections.ArrayList]::new()
    [void]$items.Add([object[]]@($record, $compilerCollection))
    $result = Get-BoundedCompilerDiagnostics -Records $items
    $matched = @($result.diagnostics | Where-Object { $_.errorNumber -eq 'CS1503' })
    Assert-Fixture ($matched.Count -ge 1) 'structured diagnostic not found'
    Assert-Fixture ($matched[0].sourceLine -eq 42 -and $matched[0].column -eq 17) 'positions changed'
    Assert-Fixture ($result.observedClrTypes -contains 'System.Collections.ArrayList') 'collection type missing'
    Assert-Fixture (($result | ConvertTo-Json -Depth 8 -Compress) -notmatch 'private|SOURCE_EXCERPT_SENTINEL') 'source or filename leaked'
}
Invoke-Fixture 'plain-exception-first-line-and-inner-chain' {
    $inner = [Exception]::new('error CS0006: Metadata file could not be found')
    $outer = [Exception]::new("Provider unavailable`r`nSOURCE_EXCERPT_SENTINEL", $inner)
    $outer.Data['sentinel'] = 'DATA_SENTINEL'
    $result = Get-BoundedCompilerDiagnostics -Records ([object[]]@($outer))
    Assert-Fixture (@($result.diagnostics | Where-Object { $_.errorText -eq 'Provider unavailable' -and $null -eq $_.errorNumber }).Count -eq 1) 'unformatted first line lost'
    Assert-Fixture (@($result.diagnostics | Where-Object { $_.errorNumber -eq 'CS0006' }).Count -eq 1) 'inner compiler error lost'
    Assert-Fixture (($result | ConvertTo-Json -Depth 8 -Compress) -notmatch 'DATA_SENTINEL|SOURCE_EXCERPT_SENTINEL') 'unapproved content leaked'
}
Invoke-Fixture 'error-details-formatted-text-and-error-id' {
    $record = [Management.Automation.ErrorRecord]::new([Exception]::new('Wrapper message'), 'fixture.details', [Management.Automation.ErrorCategory]::InvalidData, $null)
    $record.ErrorDetails = [Management.Automation.ErrorDetails]::new("C:\temp\a.cs(12,3): warning CS0649: Field is not assigned`r`nSOURCE_EXCERPT_SENTINEL")
    $result = Get-BoundedCompilerDiagnostics -Records $record
    $matched = @($result.diagnostics | Where-Object { $_.errorNumber -eq 'CS0649' })
    Assert-Fixture ($matched.Count -eq 1) 'ErrorDetails diagnostic absent'
    Assert-Fixture ($matched[0].sourceLine -eq 12 -and $matched[0].column -eq 3 -and $matched[0].isWarning) 'ErrorDetails fields wrong'
    Assert-Fixture ($matched[0].fullyQualifiedErrorId -eq 'fixture.details') 'error id absent'
}
Invoke-Fixture 'location-prefix-without-compiler-code-retains-reason' {
    $message = "C:\private temp\sample.cs(42) : The type or namespace name could not be found`r`nSOURCE_EXCERPT_SENTINEL"
    $result = Get-BoundedCompilerDiagnostics -Records ([Exception]::new($message))
    $diagnostic = $result.diagnostics[0]
    Assert-Fixture ($diagnostic.errorText -eq 'The type or namespace name could not be found') 'location-only reason erased'
    Assert-Fixture ($diagnostic.sourceLine -eq 42 -and $null -eq $diagnostic.column -and $null -eq $diagnostic.errorNumber) 'location-only coordinates invented or lost'
    $columnResult = Get-BoundedCompilerDiagnostics -Records ([Exception]::new('\\server\private share\sample.cs(9,4): Unformatted compiler reason'))
    Assert-Fixture ($columnResult.diagnostics[0].column -eq 4 -and $columnResult.diagnostics[0].errorText -eq 'Unformatted compiler reason') 'UNC location-only reason lost'
    Assert-Fixture (($result | ConvertTo-Json -Depth 8 -Compress) -notmatch 'private temp|sample.cs|SOURCE_EXCERPT_SENTINEL') 'location or source excerpt leaked'
}
Invoke-Fixture 'unformatted-details-null-positions' {
    $record = [Management.Automation.ErrorRecord]::new([Exception]::new('Wrapper'), 'fixture.unknown', [Management.Automation.ErrorCategory]::InvalidData, $null)
    $record.ErrorDetails = [Management.Automation.ErrorDetails]::new("Unformatted compiler diagnostic`nSOURCE_EXCERPT_SENTINEL")
    $result = Get-BoundedCompilerDiagnostics -Records $record
    $matched = @($result.diagnostics | Where-Object { $_.messageSource -eq 'ErrorDetails.Message' })
    Assert-Fixture ($matched.Count -eq 1 -and $matched[0].errorText -eq 'Unformatted compiler diagnostic') 'unformatted details lost'
    Assert-Fixture ($null -eq $matched[0].errorNumber -and $null -eq $matched[0].sourceLine -and $null -eq $matched[0].column) 'unknown positions invented'
}
Invoke-Fixture 'unknown-shape-has-type-without-object-inspection' {
    $unknown = [pscustomobject]@{ Message = 'UNKNOWN_MESSAGE_SENTINEL'; Data = 'UNKNOWN_DATA_SENTINEL' }
    $result = Get-BoundedCompilerDiagnostics -Records $unknown
    Assert-Fixture ($result.diagnostics -is [object[]]) 'singleton diagnostics must retain array shape'
    Assert-Fixture ($result.diagnostics.Count -eq 1 -and $result.diagnostics[0].format -eq 'unknown-shape') 'unknown shape discarded'
    Assert-Fixture ($result.unknownClrTypes.Count -eq 1 -and $result.diagnostics[0].clrType -eq $unknown.GetType().FullName) 'actual CLR type absent'
    Assert-Fixture (($result | ConvertTo-Json -Depth 8 -Compress) -notmatch 'UNKNOWN_.*SENTINEL') 'unknown object inspected'
    $record = [Management.Automation.ErrorRecord]::new([Exception]::new('Safe wrapper'), 'fixture.target', [Management.Automation.ErrorCategory]::InvalidData, $unknown)
    $targetResult = Get-BoundedCompilerDiagnostics -Records $record
    Assert-Fixture ($targetResult.targetClrTypes -contains $unknown.GetType().FullName) 'uninspected target type missing'
    Assert-Fixture (($targetResult | ConvertTo-Json -Depth 8 -Compress) -notmatch 'UNKNOWN_.*SENTINEL') 'target contents inspected'
}
Invoke-Fixture 'fixed-source-line-is-not-a-diagnostic' {
    $record = [Management.Automation.ErrorRecord]::new([Exception]::new('Wrapper'), 'fixture.source', [Management.Automation.ErrorCategory]::InvalidData, $null)
    $record.ErrorDetails = [Management.Automation.ErrorDetails]::new("using System;`nSOURCE_EXCERPT_SENTINEL")
    $result = Get-BoundedCompilerDiagnostics -Records $record -KnownSourceLines @('using System;', 'public static class Example')
    $matched = @($result.diagnostics | Where-Object { $_.messageSource -eq 'ErrorDetails.Message' })
    Assert-Fixture ($matched.Count -eq 1 -and $matched[0].format -eq 'source-excerpt-omitted') 'fixed source line not excluded'
    Assert-Fixture (($result | ConvertTo-Json -Depth 8 -Compress) -notmatch 'using System;|SOURCE_EXCERPT_SENTINEL') 'fixed source text leaked'
}
Invoke-Fixture 'redaction-length-and-control-characters' {
    $message = "Metadata file 'C:\private user\secret.dll' or '\\host\private share\secret.dll' is unavailable" + [char]1 + ('x' * 700)
    $result = Get-BoundedCompilerDiagnostics -Records ([Exception]::new($message))
    $text = $result.diagnostics[0].errorText
    Assert-Fixture ($text.Length -le 512 -and $text -notmatch 'private|secret|host') 'path or length boundary failed'
    Assert-Fixture ($text -notmatch '[\x00-\x1f\x7f]' -and $result.truncation.text) 'control or truncation boundary failed'
}
Invoke-Fixture 'node-and-diagnostic-caps' {
    $many = [Collections.ArrayList]::new()
    foreach ($index in 1..64) { [void]$many.Add([Exception]::new('unique fixture ' + $index)) }
    $result = Get-BoundedCompilerDiagnostics -Records $many
    Assert-Fixture ($result.nodesVisited -le 32 -and $result.diagnostics.Count -le 8) 'caps exceeded'
    Assert-Fixture ($result.truncation.nodes -and $result.truncation.records -and $result.truncated) 'truncation not reported'
}
Invoke-Fixture 'depth-cap-and-reference-cycle' {
    $deep = [Exception]::new('DEEP_SENTINEL')
    foreach ($index in 1..6) { $wrapper = [Collections.ArrayList]::new(); [void]$wrapper.Add($deep); $deep = $wrapper }
    $result = Get-BoundedCompilerDiagnostics -Records $deep
    Assert-Fixture ($result.truncation.depth -and $result.diagnostics.Count -ge 1) 'depth boundary not informative'
    $cycle = [Collections.ArrayList]::new(); [void]$cycle.Add($cycle); [void]$cycle.Add([Exception]::new('cycle fixture'))
    $cycled = Get-BoundedCompilerDiagnostics -Records $cycle
    Assert-Fixture ($cycled.nodesVisited -le 3 -and $cycled.diagnostics.Count -eq 1) 'reference cycle not bounded'
}
Invoke-Fixture 'runtime-exception-approved-wrapper' {
    $runtime = [Management.Automation.RuntimeException]::new('Runtime wrapper', [Exception]::new('error CS1002: Semicolon expected'))
    $result = Get-BoundedCompilerDiagnostics -Records $runtime
    Assert-Fixture ($result.observedClrTypes -contains 'System.Management.Automation.RuntimeException') 'runtime type absent'
    Assert-Fixture (@($result.diagnostics | Where-Object { $_.errorNumber -eq 'CS1002' }).Count -ge 1) 'runtime inner diagnostic lost'
    Assert-Fixture ($result.nodesVisited -le 32) 'runtime wrapper cycle not bounded'
}
$summary = [ordered]@{
    type = 'compiler-diagnostics-fixtures'; success = $failed.Count -eq 0
    fixtureOnly = $true; compilerInvoked = $false; brokerInvoked = $false; targetLaunched = $false; jobCreated = $false
    powershellVersion = $PSVersionTable.PSVersion.ToString(); clrVersion = [Environment]::Version.ToString()
    passed = @($passed.ToArray()); failed = @($failed.ToArray())
}
Write-Output -InputObject ($summary | ConvertTo-Json -Depth 4 -Compress)
if ($failed.Count -gt 0) { exit 1 }
exit 0
