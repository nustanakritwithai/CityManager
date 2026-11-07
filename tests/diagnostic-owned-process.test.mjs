import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const helperPath = fileURLToPath(new URL('../scripts/diagnostic-owned-process.ps1', import.meta.url));
const source = readFileSync(helperPath, 'utf8');
const extractor = readFileSync(new URL('../scripts/diagnostic-compiler-diagnostics.ps1', import.meta.url), 'utf8');
const nativeFixtures = readFileSync(new URL('./diagnostic-compiler-diagnostics.fixture.ps1', import.meta.url), 'utf8');

// These are source contracts, deliberately not claims that native Windows calls ran.
test('source contract: root cannot execute before assignment and identity verification', () => {
  const launch = source.slice(source.indexOf('        void Launch('), source.indexOf('        static string ReadBoundedLine'));
  const create = launch.indexOf('Check(CreateProcess(');
  const retain = launch.indexOf('unverifiedRootHandle = process.hProcess');
  const identity = launch.indexOf('root = ReadIdentity(');
  const assign = launch.indexOf('Check(AssignProcessToJobObject(');
  const verify = launch.indexOf('Check(IsProcessInJob(root.Handle');
  const resume = launch.indexOf('uint previous = ResumeThread(thread)');
  assert.ok(create >= 0 && create < retain && retain < identity && identity < assign && assign < verify && verify < resume);
  assert.match(launch, /CREATE_SUSPENDED \| CREATE_NO_WINDOW \| EXTENDED_STARTUPINFO_PRESENT/);
  assert.match(launch, /VerifyIdentity\(root\); ownershipVerified = true/);
  assert.match(launch, /if \(previous != 1\) throw/);
});

test('source contract: private job cannot be inherited or allow breakaway', () => {
  assert.match(source, /SetHandleInformation\(job, HANDLE_FLAG_INHERIT, 0\)/);
  assert.match(source, /GetHandleInformation\(job, out flags\)/);
  assert.match(source, /limits\.BasicLimitInformation\.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(source, /actualFlags & \(JOB_OBJECT_LIMIT_BREAKAWAY_OK \| JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK\)\) != 0/);
  assert.match(source, /Marshal\.WriteIntPtr\(handleList, nul\)/);
  assert.match(source, /UpdateProcThreadAttribute\(attributes, 0, new IntPtr\(0x00020002\), handleList/);
  assert.doesNotMatch(source, /CREATE_BREAKAWAY_FROM_JOB|--no-sandbox|--disable-gpu-sandbox|taskkill|Get-CimInstance|Win32_Process|CreateToolhelp32Snapshot/i);
});

test('source contract: only job-verified handles may expose process metadata', () => {
  const inventory = source.slice(source.indexOf('        Dictionary<string, object> Inventory()'), source.indexOf('        bool Exited('));
  assert.match(inventory, /foreach \(uint pid in JobPids\(\)\)/);
  const open = inventory.indexOf('IntPtr handle = OpenProcess(');
  const member = inventory.indexOf('Check(IsProcessInJob(handle, job');
  const reject = inventory.indexOf('if (!member) throw');
  const read = inventory.indexOf('identity = ReadIdentity(pid, handle)');
  assert.ok(open < member && member < reject && reject < read);
  assert.match(source, /Path\.GetFileName\(basename\.ToString\(\)\)/);
  assert.match(source, /CreationTime\(identity.Handle\) != identity.Creation/);
  assert.match(inventory, /else if \(Exited\(identity.Handle\)\) \{/);
  assert.match(inventory, /throw new InvalidOperationException\("listed_pid_has_exited_retained_identity"\)/);
  assert.match(source, /if \(value == 0\) throw/);
  assert.match(source, /\{"creationTimeFileTime", Creation\}/);
  assert.match(source, /\{"observedHistoryIsExhaustive", false\}/);
});

test('source contract: zero accounting and empty membership precede successful cleanup and handle close', () => {
  const teardown = source.slice(source.indexOf('        void Teardown('), source.indexOf('        static string ErrorCode'));
  assert.match(teardown, /TerminateJobObject\(job, 137\)/);
  assert.match(teardown, /TerminateProcess\(unverifiedRootHandle, 137\)/);
  assert.doesNotMatch(teardown, /OpenProcess\(/);
  assert.match(teardown, /active == 0 && pids.Count == 0 && rootExited/);
  assert.match(teardown, /zero && ownershipVerified && errors.Count == 0/);
  assert.doesNotMatch(teardown, /CloseHandle\(job\)/);
  const verify = teardown.indexOf('try { if (root != null) VerifyIdentity(root); }');
  const record = teardown.indexOf('catch (Exception ex) { errors.Add(ErrorCode(ex)); }', verify);
  const kill = teardown.indexOf('try { if (job != IntPtr.Zero) Check(TerminateJobObject');
  assert.ok(verify >= 0 && verify < record && record < kill, 'identity failure must not bypass job termination');
});

test('source contract: uncertainty is sticky, protocol and lifetime are bounded', () => {
  assert.match(source, /MAX_PROCESSES = 4096, MAX_COMMANDS = 256, MAX_LINE = 4096/);
  assert.match(source, /clock.ElapsedMilliseconds >= lifetimeMs/);
  assert.match(source, /deadline.ElapsedMilliseconds < teardownMs/);
  assert.match(source, /if \(line.Length != 0\) throw new InvalidOperationException\("protocol_truncated_line"\)/);
  assert.match(source, /if \(!member\) throw new InvalidOperationException\("pid_not_in_owned_job"\)/);
  assert.match(source, /Check\(handle != IntPtr.Zero, "OpenOwnedProcess"\)/);
  assert.match(source, /return errors.Count == 0 && ownershipVerified \? 0 : 1/);
  assert.match(source, /-NoNewWindow -PassThru; Start-Sleep -Milliseconds 1500; exit 0/);
});

const runtimeEnabled = process.platform === 'win32' && process.env.DIAGNOSTIC_OWNED_PROCESS_WINDOWS_TEST === '1';
const runtimeOptions = { skip: runtimeEnabled ? false : 'Native Windows tests are explicit opt-in; not executed here.', timeout: 45_000 };

function startBroker(args) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helperPath, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true,
  });
  const records = [];
  let buffer = '', stderr = '', ended = false, parseError;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    buffer += data;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      try { records.push(JSON.parse(line)); } catch (error) { parseError = error; }
    }
  });
  child.stderr.on('data', (data) => { stderr += data; });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { ended = true; resolve({ code, signal }); });
  });
  async function waitFor(predicate, timeoutMs = 20_000) {
    const start = Date.now();
    for (;;) {
      if (parseError) throw parseError;
      const record = records.find(predicate);
      if (record) return record;
      if (ended) throw new Error(`Broker ended before record; stderr: ${stderr}; records: ${JSON.stringify(records)}`);
      if (Date.now() - start >= timeoutMs) throw new Error('Broker protocol deadline; cleanup is unverified.');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  function command(command, requestId) { child.stdin.write(`${JSON.stringify({ command, requestId })}\n`); }
  async function finish() {
    child.stdin.end();
    const result = await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Broker exit deadline; cleanup is unverified.')), 15_000).unref())]);
    assert.equal(buffer.trim(), '', 'No truncated NDJSON');
    assert.ifError(parseError);
    assert.equal(result.signal, null);
    for (let i = 0; i < records.length; i++) {
      assert.equal(records[i].sequence, i + 1);
      assert.ok(Number.isFinite(records[i].elapsedMs));
      if (i) assert.ok(records[i].elapsedMs >= records[i - 1].elapsedMs);
    }
    return result;
  }
  return { child, records, waitFor, command, finish };
}
function harmlessArgs(script = "Write-Output 'not-protocol-output'; Start-Sleep -Seconds 1") {
  const executable = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return ['-Executable', executable, '-ArgumentsJson', JSON.stringify(['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]), '-LifetimeSeconds', '25', '-TeardownSeconds', '10'];
}
function verifiedTermination(record) {
  assert.equal(record.cleanupVerified, true);
  assert.equal(record.ownershipVerified, true);
  assert.equal(record.activeProcessCount, 0);
  assert.equal(record.rootExited, true);
  assert.deepEqual(record.errors, []);
  assert.ok(record.observedProcesses.every((process) => process.exitState === 'exited'));
}

test('Windows runtime: normal root completion is distinct from final verified cleanup', runtimeOptions, async () => {
  const broker = startBroker(harmlessArgs());
  try {
    const ready = await broker.waitFor((r) => r.type === 'ready');
    assert.equal(ready.jobVerified, true);
    assert.match(ready.root.creationTimeFileTime, /^\d+$/);
    const exit = await broker.waitFor((r) => r.type === 'root_exit');
    assert.equal(exit.pid, ready.root.pid);
    assert.equal(exit.creationTimeFileTime, ready.root.creationTimeFileTime);
    broker.command('terminate', 'normal-cleanup');
    const terminated = await broker.waitFor((r) => r.type === 'terminated');
    assert.equal(terminated.requestId, 'normal-cleanup'); verifiedTermination(terminated);
    assert.equal((await broker.finish()).code, 0);
  } finally { broker.child.stdin.end(); }
});

test('Windows runtime: inherited child remains owned after its parent exits', runtimeOptions, async () => {
  const broker = startBroker(['-OwnedChildSelfTest', '-LifetimeSeconds', '25', '-TeardownSeconds', '10']);
  try {
    const ready = await broker.waitFor((r) => r.type === 'ready');
    assert.ok(ready.processes.length >= 2);
    await broker.waitFor((r) => r.type === 'root_exit');
    broker.command('inspect', 'after-root-exit');
    const inventory = await broker.waitFor((r) => r.type === 'inventory' && r.requestId === 'after-root-exit');
    assert.ok(inventory.activeProcessCount >= 1);
    assert.ok(inventory.processes.some((p) => p.pid !== ready.root.pid));
    broker.command('terminate', 'child-cleanup');
    const terminated = await broker.waitFor((r) => r.type === 'terminated');
    verifiedTermination(terminated);
    assert.ok(terminated.observedProcesses.length >= 2);
    assert.equal((await broker.finish()).code, 0);
  } finally { broker.child.stdin.end(); }
});

test('Windows runtime: EOF requests bounded verified teardown', runtimeOptions, async () => {
  const broker = startBroker(harmlessArgs('Start-Sleep -Seconds 120'));
  try {
    await broker.waitFor((r) => r.type === 'ready'); broker.child.stdin.end();
    const terminated = await broker.waitFor((r) => r.type === 'terminated');
    assert.equal(terminated.reason, 'stdin_closed'); verifiedTermination(terminated);
    assert.equal((await broker.finish()).code, 0);
  } finally { broker.child.stdin.end(); }
});

test('Windows runtime: lifetime expiry never claims a successful calibration', runtimeOptions, async () => {
  const args = harmlessArgs('Start-Sleep -Seconds 120'); args[args.indexOf('-LifetimeSeconds') + 1] = '5';
  const broker = startBroker(args);
  try {
    await broker.waitFor((r) => r.type === 'ready');
    const terminated = await broker.waitFor((r) => r.type === 'terminated');
    assert.equal(terminated.cleanupVerified, false);
    assert.equal(terminated.activeProcessCount, 0);
    assert.ok(terminated.errors.includes('lifetime_deadline'));
    assert.equal((await broker.finish()).code, 1);
  } finally { broker.child.stdin.end(); }
});

test('source contract: compile-only is exclusive and exits before any broker invocation', () => {
  assert.match(source, /ParameterSetName = 'CompileOnly'\)\]\s*\[switch\]\$CompileOnly/);
  assert.match(source, /if \(-not \$CompileOnly\) \{\s*try \{/);
  const wrapper = source.slice(source.indexOf("\n'@") + 4);
  const compile = wrapper.indexOf('Add-Type -TypeDefinition $source');
  const reject = wrapper.indexOf('if (-not $compileSucceeded) { exit 2 }');
  const stop = wrapper.indexOf('if ($CompileOnly) { exit 0 }');
  const run = wrapper.indexOf('[DiagnosticOwnedProcess]::Run(');
  assert.ok(compile >= 0 && compile < reject && reject < stop && stop < run);
  assert.equal((wrapper.match(/\[DiagnosticOwnedProcess\]::Run\(/g) ?? []).length, 1);
  assert.doesNotMatch(wrapper.slice(0, run), /::(?:CreateProcess|CreateJobObject|AssignProcessToJobObject|ResumeThread)\(/);
  assert.match(wrapper, /\$compileSucceeded = \$compilerErrors.Count -eq 0 -and \$compiledTypes.Count -gt 0/);
});

test('source contract: compiler observability preserves references and strict warnings', () => {
  const wrapper = source.slice(source.indexOf("\n'@") + 4);
  assert.match(wrapper, /\$compilerReferences = @\('System.dll', 'System.Web.Extensions.dll', 'System.Core.dll'\)/);
  assert.match(wrapper, /Add-Type -TypeDefinition \$source -ReferencedAssemblies \$compilerReferences -PassThru -ErrorAction SilentlyContinue -ErrorVariable \+compilerErrors/);
  assert.doesNotMatch(wrapper, /-IgnoreWarnings\b|TreatWarningsAsErrors\s*=\s*\$false|-CompilerOptions\b/);
  assert.match(extractor, /if \(\$State.diagnostics.Count -ge 8\)/);
  assert.match(extractor, /if \(\$Text.Length -gt 512\) \{ \$Text = \$Text.Substring\(0, 512\) \}/);
  assert.match(wrapper, /sourceSha256 = \$sourceHash/);
  assert.match(wrapper, /if \(\$CompileOnly\) \{[\s\S]*?Write-Output -InputObject \$serializedCompileRecord[\s\S]*?else \{\s*\[Console\]::Error.WriteLine\(\$serializedCompileRecord\)/);
  assert.doesNotMatch(wrapper, /\[Console\]::Out.WriteLine/);
  assert.match(extractor, /format = 'unknown-shape'/);
  assert.match(extractor, /errorNumber = \$null; sourceLine = \$null; column = \$null; isWarning = \$null/);
});

// Execute the exact, portable subset of the diagnostic regex using JavaScript.
// These cases validate extraction patterns only, NOT PowerShell/ErrorRecord runtime behavior.
function compilerDiagnosticPattern() {
  const marker = "[regex]::Match($diagnosticLine, '";
  const start = extractor.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const expression = extractor.slice(start, extractor.indexOf("')", start));
  assert.ok(expression.startsWith('(?i)'));
  return new RegExp(expression.slice(4), 'gim');
}
function diagnosticMatches(text) {
  return [...text.matchAll(compilerDiagnosticPattern())].map(({ groups }) => ({
    errorNumber: groups.code,
    sourceLine: groups.line ? Number(groups.line) : null,
    column: groups.column ? Number(groups.column) : null,
    isWarning: groups.severity.toLowerCase() === 'warning',
    errorText: groups.text,
  }));
}

test('diagnostic regex fixture: extracts code and coordinates without temporary path or source excerpt', () => {
  const result = diagnosticMatches('C:\\private-temp\\random.0.cs(42,17) : error CS1503: Argument 2 cannot convert\r\nC:\\private-temp\\random.0.cs(42) : >>> source text not retained\r\n');
  assert.deepEqual(result, [{ errorNumber: 'CS1503', sourceLine: 42, column: 17, isWarning: false, errorText: 'Argument 2 cannot convert' }]);
  assert.doesNotMatch(JSON.stringify(result), /private-temp|random\.0|source text/);
});

test('diagnostic regex fixture: warning code and absent coordinates remain explicit', () => {
  assert.deepEqual(diagnosticMatches('C:\\temp\\x.cs(10) : warning CS0649: Field is never assigned'), [
    { errorNumber: 'CS0649', sourceLine: 10, column: null, isWarning: true, errorText: 'Field is never assigned' },
  ]);
  assert.deepEqual(diagnosticMatches('error CS0006: Metadata file could not be found'), [
    { errorNumber: 'CS0006', sourceLine: null, column: null, isWarning: false, errorText: 'Metadata file could not be found' },
  ]);
  assert.deepEqual(diagnosticMatches('An unrecognized provider failure'), []);
});

test('diagnostic redaction regex fixture: removes drive and UNC paths without dropping error meaning', () => {
  const marker = "[regex]::Replace($Text, '";
  const start = extractor.indexOf(marker) + marker.length;
  const expression = extractor.slice(start, extractor.indexOf(", '<path>')", start) - 1).replaceAll("''", "'");
  assert.ok(expression.startsWith('(?i)'));
  const pattern = new RegExp(expression.slice(4), 'gi');
  const redacted = "Metadata file 'C:\\private\\file.dll' or '\\\\host\\secret\\file.dll' missing".replace(pattern, '<path>');
  assert.equal(redacted, "Metadata file '<path>' or '<path>' missing");
});


test('source contract: only two explicit StartNew<string> bindings change the failing C# source', () => {
  const normalized = source.replaceAll('\r\n', '\n');
  const literal = normalized.split("$source = @'\n")[1].split("\n'@")[0];
  const originalCall = 'Task.Factory.StartNew(ReadBoundedLine)';
  const correctedCall = 'Task.Factory.StartNew<string>(ReadBoundedLine)';
  assert.equal(literal.split(correctedCall).length - 1, 2);
  assert.equal(literal.includes(originalCall), false);
  assert.match(literal, /Task<string> pending = Task\.Factory\.StartNew<string>\(ReadBoundedLine\);/);
  assert.match(literal, /pending = Task\.Factory\.StartNew<string>\(ReadBoundedLine\);/);
  const restored = literal.replaceAll(correctedCall, originalCall);
  assert.equal(createHash('sha256').update(restored, 'utf8').digest('hex'), '92c9a8ea1af7078547545450def34c1c41c5d67f03994ab422a0a6bd7299773f');
  assert.equal(createHash('sha256').update(literal, 'utf8').digest('hex'), '0ede36a3cdf2bb167c97345199cd86e7a28bee7360d622fc69c74868776948ad');
});


test('source contract: fixture-only exits before compilation and exercises native approved object shapes', () => {
  const branch = source.indexOf('if ($DiagnosticsFixtureOnly) {');
  const fixtureCall = source.indexOf("'../tests/diagnostic-compiler-diagnostics.fixture.ps1'", branch);
  const exit = source.indexOf('exit $LASTEXITCODE', fixtureCall);
  const embedded = source.indexOf("$source = @'");
  const compile = source.indexOf('Add-Type -TypeDefinition $source');
  assert.ok(branch >= 0 && branch < fixtureCall && fixtureCall < exit && exit < embedded && embedded < compile);
  assert.match(source, /ParameterSetName = 'DiagnosticsFixtureOnly'\)\]\s*\[switch\]\$DiagnosticsFixtureOnly/);
  assert.doesNotMatch(nativeFixtures, /Add-Type|Start-Process|CreateProcess|CreateJobObject|DiagnosticOwnedProcess/);
  assert.match(nativeFixtures, /exceptionType = \$type; message = \$text/);
  assert.doesNotMatch(nativeFixtures, /\.(?:StackTrace|InvocationInfo)\b/);
  for (const name of ['nested-collections-and-structured-compiler-error', 'plain-exception-first-line-and-inner-chain', 'error-details-formatted-text-and-error-id', 'location-prefix-without-compiler-code-retains-reason', 'unformatted-details-null-positions', 'unknown-shape-has-type-without-object-inspection', 'fixed-source-line-is-not-a-diagnostic', 'redaction-length-and-control-characters', 'node-and-diagnostic-caps', 'depth-cap-and-reference-cycle', 'runtime-exception-approved-wrapper']) {
    assert.ok(nativeFixtures.includes(`Invoke-Fixture '${name}'`), name);
  }
});

test('source contract: traversal is allowlisted, bounded, and never serializes arbitrary objects', () => {
  for (const type of ['[object[]]', '[Collections.ArrayList]', '[System.CodeDom.Compiler.CompilerErrorCollection]', '[System.CodeDom.Compiler.CompilerError]', '[Management.Automation.ErrorRecord]', '[Management.Automation.ErrorDetails]', '[Exception]', '[Management.Automation.RuntimeException]']) {
    assert.ok(extractor.includes(`-is ${type}`), type);
  }
  assert.match(extractor, /\$Depth -gt 4/);
  assert.match(extractor, /\$State.nodesQueued -ge 32/);
  assert.match(extractor, /\$State.diagnostics.Count -ge 8/);
  assert.match(extractor, /\[object\]::ReferenceEquals/);
  assert.match(extractor, /messageScanLimit = 4096/);
  assert.doesNotMatch(extractor, /\.(?:InvocationInfo|StackTrace|Data|ToString|GetProperties|GetEnumerator)\b|IEnumerable/);
  assert.match(extractor, /\$node.TargetObject -is \[System.CodeDom.Compiler.CompilerError\]/);
  assert.match(extractor, /if \(\$node -is \[Management.Automation.RuntimeException\]\)/);
  assert.match(extractor, /format = 'unparsed-first-line'/);
  assert.match(extractor, /diagnostics = @\(\$state.diagnostics.ToArray\(\)\)/);
  assert.match(nativeFixtures, /\$result.diagnostics -is \[object\[\]\]/);
  assert.match(nativeFixtures, /passed = @\(\$passed.ToArray\(\)\); failed = @\(\$failed.ToArray\(\)\)/);
  assert.match(extractor, /observedClrTypes =/);
  assert.match(extractor, /unknownClrTypes =/);
  assert.match(extractor, /targetClrTypes =/);
  assert.match(extractor, /\$node.TargetObject.GetType\(\).FullName/);
  assert.match(extractor, /\$State.sourceLines.Contains\(\$diagnosticLine.Trim\(\)\)/);
  assert.match(source, /-KnownSourceLines \(\$source -split '\\r\?\\n'\)/);
});

test('Windows native PowerShell fixture-only extractor tests', { skip: process.platform !== 'win32' || process.env.DIAGNOSTIC_COMPILER_FIXTURE_WINDOWS_TEST !== '1', timeout: 30_000 }, async () => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helperPath, '-DiagnosticsFixtureOnly'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, stderr.slice(0, 512));
  const result = JSON.parse(stdout.trim());
  assert.equal(result.type, 'compiler-diagnostics-fixtures');
  assert.equal(result.success, true);
  assert.equal(result.compilerInvoked, false);
  assert.equal(result.brokerInvoked, false);
  assert.equal(result.targetLaunched, false);
  assert.equal(result.jobCreated, false);
  assert.equal(result.passed.length, 11);
  assert.deepEqual(result.failed, []);
});


test('diagnostic location regex fixture: no-code messages retain their reason and supplied positions', () => {
  const marker = "[regex]::Match($firstLine, '";
  const start = extractor.indexOf(marker) + marker.length;
  const expression = extractor.slice(start, extractor.indexOf("')", start));
  assert.ok(expression.startsWith('(?i)'));
  const pattern = new RegExp(expression.slice(4), 'i');
  const drive = pattern.exec('C:\\private temp\\sample.cs(42) : The type or namespace name could not be found');
  assert.deepEqual({ ...drive.groups }, { line: '42', column: undefined, text: 'The type or namespace name could not be found' });
  const unc = pattern.exec('\\\\server\\private share\\sample.cs(9,4): Unformatted compiler reason');
  assert.deepEqual({ ...unc.groups }, { line: '9', column: '4', text: 'Unformatted compiler reason' });
  assert.doesNotMatch(JSON.stringify(drive.groups), /private temp|sample.cs/);
  assert.equal(pattern.exec('Ordinary message (42): keep it intact'), null);
});
