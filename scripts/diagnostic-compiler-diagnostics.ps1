# Pure, bounded extraction of diagnostics from compilation of the launcher's fixed C#.
# This file performs no compilation, broker invocation, native calls, or process launch.
Set-StrictMode -Version Latest

function ConvertTo-SafeCompilerText {
    param([string]$Text)
    # Be deliberately conservative: an unquoted path may consume the rest of its line.
    # Quoted paths stop at the closing quote. Never retain drive/UNC path fragments.
    $Text = [regex]::Replace($Text, '(?i)(?:[a-z]:[\\/]|\\\\)[^''"\r\n]*', '<path>')
    $Text = [regex]::Replace($Text, '[\x00-\x1f\x7f]', ' ')
    if ($Text.Length -gt 512) { $Text = $Text.Substring(0, 512) }
    return $Text
}

function Add-CompilerDiagnosticRecord {
    param([hashtable]$State, [System.Collections.IDictionary]$Record)
    $key = $Record | ConvertTo-Json -Depth 4 -Compress
    if (-not $State.seenDiagnostics.Add($key)) { return }
    if ($State.diagnostics.Count -ge 8) { $State.recordLimitReached = $true; return }
    $State.diagnostics.Add($Record)
}

function Add-CompilerDiagnosticNode {
    param([hashtable]$State, [object]$Value, [int]$Depth, [string]$Context, [string]$ErrorId)
    if ($null -eq $Value) { return }
    if ($Depth -gt 4) { $State.depthLimitReached = $true; return }
    if ($State.nodesQueued -ge 32) { $State.nodeLimitReached = $true; return }
    $State.queue.Enqueue([pscustomobject]@{ value = $Value; depth = $Depth; context = $Context; errorId = $ErrorId })
    $State.nodesQueued++
}

function Add-CompilerDiagnosticMessage {
    param([hashtable]$State, [string]$Message, [string]$ClrType, [string]$Context, [string]$ErrorId)
    # Read only the first nonempty line from a bounded prefix. Following source excerpts
    # are never parsed or retained. Arbitrary objects are never converted to strings.
    $scanTruncated = $Message.Length -gt 4096
    $prefix = $Message.Substring(0, [Math]::Min(4096, $Message.Length))
    $first = [regex]::Match($prefix, '(?m)^[ \t]*(?<line>\S[^\r\n]*)')
    $firstLine = $(if ($first.Success) { $first.Groups['line'].Value } else { '' })
    $code = $null; $line = $null; $column = $null; $warning = $null
    $diagnosticLine = $firstLine; $format = 'unparsed-first-line'
    # Add-Type can omit severity/code but keep filename(line[,column]):. Remove that
    # recognized location before path redaction, so the actual reason is not consumed.
    $location = [regex]::Match($firstLine, '(?i)^(?:(?:[a-z]:[\\/]|\\\\)[^\r\n]*?\.cs|[^\\/:\r\n]+\.cs)\((?<line>\d+)(?:,(?<column>\d+))?\)\s*:\s*(?<text>[^\r\n]*)$')
    if ($location.Success) {
        $diagnosticLine = $location.Groups['text'].Value; $format = 'location-prefixed-first-line'
        $number = 0
        if ([int]::TryParse($location.Groups['line'].Value, [ref]$number) -and $number -gt 0) { $line = $number }
        $number = 0
        if ([int]::TryParse($location.Groups['column'].Value, [ref]$number) -and $number -gt 0) { $column = $number }
    }
    $match = [regex]::Match($diagnosticLine, '(?i)^(?:[^\r\n]*?\((?<line>\d+)(?:,(?<column>\d+))?\)\s*:\s*)?\s*(?<severity>error|warning)\s+(?<code>CS\d{4,5})\s*:\s*(?<text>[^\r\n]*)')
    $text = $diagnosticLine
    if ($match.Success) {
        $format = 'compiler-formatted'; $code = $match.Groups['code'].Value
        $number = 0
        if ([int]::TryParse($match.Groups['line'].Value, [ref]$number) -and $number -gt 0) { $line = $number }
        $number = 0
        if ([int]::TryParse($match.Groups['column'].Value, [ref]$number) -and $number -gt 0) { $column = $number }
        $warning = $match.Groups['severity'].Value -ieq 'warning'
        $text = $match.Groups['text'].Value
    } elseif ($State.sourceLines.Contains($diagnosticLine.Trim())) {
        $text = '[fixed source line omitted]'; $format = 'source-excerpt-omitted'
    } elseif ($text -match '^\s*(?:[^\r\n]*?\(\d+(?:,\d+)?\)\s*:\s*)?>>>') {
        $text = '[source excerpt omitted]'; $format = 'source-excerpt-omitted'
    }
    if ([string]::IsNullOrWhiteSpace($text)) { $text = '[empty diagnostic message]' }
    $textTruncated = $scanTruncated -or $text.Length -gt 512
    if ($textTruncated) { $State.textLimitReached = $true }
    Add-CompilerDiagnosticRecord -State $State -Record ([ordered]@{
        clrType = $ClrType; messageSource = $Context; format = $format
        fullyQualifiedErrorId = $(if ($ErrorId) { $ErrorId } else { $null })
        errorNumber = $code; sourceLine = $line; column = $column; isWarning = $warning
        errorText = ConvertTo-SafeCompilerText $text
        textTruncated = $textTruncated
    })
}

function Get-BoundedCompilerDiagnostics {
    param([object]$Records, [string[]]$KnownSourceLines = @())
    $state = @{
        queue = New-Object 'System.Collections.Generic.Queue[object]'
        visited = New-Object 'System.Collections.Generic.List[object]'
        diagnostics = New-Object 'System.Collections.Generic.List[object]'
        seenDiagnostics = New-Object 'System.Collections.Generic.HashSet[string]'
        observedTypes = New-Object 'System.Collections.Generic.HashSet[string]'
        unknownTypes = New-Object 'System.Collections.Generic.HashSet[string]'
        targetTypes = New-Object 'System.Collections.Generic.HashSet[string]'
        sourceLines = New-Object 'System.Collections.Generic.HashSet[string]'
        nodesQueued = 0; nodesVisited = 0
        nodeLimitReached = $false; depthLimitReached = $false
        recordLimitReached = $false; textLimitReached = $false
    }
    # Only the launcher's fixed embedded source (or fixed fixture lines) is supplied here.
    for ($i = 0; $i -lt [Math]::Min(1024, $KnownSourceLines.Count); $i++) {
        $known = $KnownSourceLines[$i]
        if ($null -ne $known -and $known.Length -le 4096) { [void]$state.sourceLines.Add($known.Trim()) }
    }
    Add-CompilerDiagnosticNode -State $state -Value $Records -Depth 0 -Context 'input' -ErrorId ''
    while ($state.queue.Count -gt 0) {
        $frame = $state.queue.Dequeue(); $node = $frame.value
        $alreadyVisited = $false
        foreach ($previous in $state.visited) {
            if ([object]::ReferenceEquals($previous, $node)) { $alreadyVisited = $true; break }
        }
        if ($alreadyVisited) { continue }
        $state.visited.Add($node); $state.nodesVisited++
        $type = $node.GetType().FullName
        if ($type.Length -gt 160) { $type = $type.Substring(0, 160); $state.textLimitReached = $true }
        [void]$state.observedTypes.Add($type)
        $depth = $frame.depth + 1
        if ($node -is [object[]] -or $node -is [Collections.ArrayList] -or $node -is [System.CodeDom.Compiler.CompilerErrorCollection]) {
            for ($i = 0; $i -lt $node.Count; $i++) {
                if ($state.nodesQueued -ge 32) { $state.nodeLimitReached = $true; break }
                Add-CompilerDiagnosticNode -State $state -Value $node[$i] -Depth $depth -Context 'collection-item' -ErrorId $frame.errorId
                if ($depth -gt 4) { break }
            }
            continue
        }
        if ($node -is [System.CodeDom.Compiler.CompilerError]) {
            $code = [string]$node.ErrorNumber
            if ($code -notmatch '^CS\d{4,5}$') { $code = $null }
            $rawText = [string]$node.ErrorText
            # CompilerError.ErrorText is also restricted to its first nonempty line.
            $prefix = $rawText.Substring(0, [Math]::Min(4096, $rawText.Length))
            $first = [regex]::Match($prefix, '(?m)^[ \t]*(?<line>\S[^\r\n]*)')
            $text = $(if ($first.Success) { $first.Groups['line'].Value } else { '[empty compiler diagnostic]' })
            if ($state.sourceLines.Contains($text.Trim())) { $text = '[fixed source line omitted]' }
            $textTruncated = $rawText.Length -gt 4096 -or $text.Length -gt 512
            if ($textTruncated) { $state.textLimitReached = $true }
            Add-CompilerDiagnosticRecord -State $state -Record ([ordered]@{
                clrType = $type; messageSource = 'CompilerError.ErrorText'; format = 'compiler-structured'
                fullyQualifiedErrorId = $(if ($frame.errorId) { $frame.errorId } else { $null })
                errorNumber = $code
                sourceLine = $(if ($node.Line -gt 0) { [int]$node.Line } else { $null })
                column = $(if ($node.Column -gt 0) { [int]$node.Column } else { $null })
                isWarning = [bool]$node.IsWarning
                errorText = ConvertTo-SafeCompilerText $text; textTruncated = $textTruncated
            })
            continue
        }
        if ($node -is [Management.Automation.ErrorRecord]) {
            $safeId = ConvertTo-SafeCompilerText ([string]$node.FullyQualifiedErrorId)
            $id = [regex]::Replace($safeId, '[^A-Za-z0-9_.:, +\-]', '?')
            if ($id.Length -gt 160) { $id = $id.Substring(0, 160); $state.textLimitReached = $true }
            # An arbitrary target contributes its CLR type only, never its contents.
            if ($null -ne $node.TargetObject) {
                $targetType = $node.TargetObject.GetType().FullName
                if ($targetType.Length -gt 160) { $targetType = $targetType.Substring(0, 160); $state.textLimitReached = $true }
                [void]$state.targetTypes.Add($targetType)
            }
            # The only target whose diagnostic fields can be read is CompilerError.
            if ($node.TargetObject -is [System.CodeDom.Compiler.CompilerError]) {
                Add-CompilerDiagnosticNode -State $state -Value $node.TargetObject -Depth $depth -Context 'ErrorRecord.TargetObject' -ErrorId $id
            }
            Add-CompilerDiagnosticNode -State $state -Value $node.ErrorDetails -Depth $depth -Context 'ErrorRecord.ErrorDetails' -ErrorId $id
            Add-CompilerDiagnosticNode -State $state -Value $node.Exception -Depth $depth -Context 'ErrorRecord.Exception' -ErrorId $id
            continue
        }
        if ($node -is [Management.Automation.ErrorDetails]) {
            Add-CompilerDiagnosticMessage -State $state -Message $node.Message -ClrType $type -Context 'ErrorDetails.Message' -ErrorId $frame.errorId
            continue
        }
        if ($node -is [Exception]) {
            Add-CompilerDiagnosticMessage -State $state -Message $node.Message -ClrType $type -Context 'Exception.Message' -ErrorId $frame.errorId
            Add-CompilerDiagnosticNode -State $state -Value $node.InnerException -Depth $depth -Context 'Exception.InnerException' -ErrorId $frame.errorId
            # This typed PowerShell wrapper is the only approved extra exception property.
            if ($node -is [Management.Automation.RuntimeException]) {
                Add-CompilerDiagnosticNode -State $state -Value $node.ErrorRecord -Depth $depth -Context 'RuntimeException.ErrorRecord' -ErrorId $frame.errorId
            }
            continue
        }
        [void]$state.unknownTypes.Add($type)
        Add-CompilerDiagnosticRecord -State $state -Record ([ordered]@{
            clrType = $type; messageSource = $frame.context; format = 'unknown-shape'
            fullyQualifiedErrorId = $null; errorNumber = $null; sourceLine = $null; column = $null; isWarning = $null
            errorText = 'Unsupported diagnostic CLR shape; its value was not inspected.'; textTruncated = $false
        })
    }
    if ($state.diagnostics.Count -eq 0 -and ($state.nodeLimitReached -or $state.depthLimitReached)) {
        Add-CompilerDiagnosticRecord -State $state -Record ([ordered]@{
            clrType = $(if ($null -ne $Records) { $Records.GetType().FullName } else { $null })
            messageSource = 'input'; format = 'traversal-limit'
            fullyQualifiedErrorId = $null; errorNumber = $null; sourceLine = $null; column = $null; isWarning = $null
            errorText = 'No diagnostic message was reached within the traversal limits.'; textTruncated = $false
        })
    }
    return [pscustomobject]@{
        diagnostics = @($state.diagnostics.ToArray())
        observedClrTypes = @($state.observedTypes | Sort-Object)
        unknownClrTypes = @($state.unknownTypes | Sort-Object)
        targetClrTypes = @($state.targetTypes | Sort-Object)
        nodesVisited = $state.nodesVisited; nodeLimit = 32; depthLimit = 4
        diagnosticLimit = 8; diagnosticTextLimit = 512; messageScanLimit = 4096
        truncation = [ordered]@{
            nodes = $state.nodeLimitReached; depth = $state.depthLimitReached
            records = $state.recordLimitReached; text = $state.textLimitReached
        }
        truncated = $state.nodeLimitReached -or $state.depthLimitReached -or $state.recordLimitReached -or $state.textLimitReached
    }
}
