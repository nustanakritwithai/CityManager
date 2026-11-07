# Diagnostic Windows process ownership broker

`scripts/diagnostic-owned-process.ps1` is new diagnostic-only scaffolding. It does not modify the ordinary browser launch, smoke tests, timing thresholds, or browser sandbox flags. The first authorized Windows calibration (run `42380138115`) stopped in `Add-Type` before broker startup, with exit 2. Its old catch discarded the compiler diagnostics. A later compile-only observation (run `42382512313`) identified overload ambiguity at the two `Task.Factory.StartNew(ReadBoundedLine)` calls. No Job Object/browser behavior was exercised. Source contracts are not proof of native API behavior. The local follow-up adds compiler observability and compile-only mode. The evidence-backed correction now selects `StartNew<string>` explicitly at those two call sites; no ABI or process-ownership behavior is changed.

## Invocation and protocol

Use **64-bit Windows PowerShell 5.1** (`powershell.exe`, not `pwsh`) with redirected stdin/stdout. Node should use `spawn` with an argument array and `shell: false`:

```js
const child = spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-File', helperPath,
  '-Executable', absoluteExecutable,
  '-ArgumentsJson', JSON.stringify(browserArguments),
  '-LifetimeSeconds', '180', '-TeardownSeconds', '10',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
```

Optional `-WorkingDirectory` must be an existing absolute directory. The broker adds **no browser flags**, breakaway flags, security changes, or alternate launch fallback. It preserves argument boundaries using Windows argument quoting. Only the NUL standard-I/O handle is inherited by the target; target output cannot corrupt the NDJSON protocol. The private, unnamed job handle is explicitly non-inheritable and excluded from that allowlist.

Wait for `ready` before connecting to the browser. Every stdout line is a JSON record with `type`, increasing `sequence`, and monotonic `elapsedMs` measured by the broker. Do not conflate that host clock with browser trace clocks. Record types are:

- `job_created`: verified kill-on-close, disabled breakaway, non-inheritable handle.
- `created_suspended`: original root identity, before it has executed user code.
- `job_assigned`: verified root membership, before resume.
- `root_resumed`.
- `ready`: `root`, `jobVerified`, `processes`, `activeProcessCount`, `totalProcesses`, `totalTerminatedProcesses`, `ownershipVerified`, `ownedChildSelfTest`, `lifetimeSeconds`.
- `inventory`: the inventory fields plus the caller's `requestId`.
- `root_exit`: root identity fields and `exitCode`. If identity acquisition failed during launch, an emergency root exit record instead has `rootIdentityVerified: false` and `exitCode`; no `ready` is emitted.
- `terminate_requested`, optional `unassigned_root_termination`, `stdin_closed`, `error`, and final `terminated`.

Commands must be complete newline-terminated JSON objects with **exactly** two fields. `requestId` is a nonempty string of at most 128 characters:

```json
{"command":"inspect","requestId":"before-close"}
{"command":"terminate","requestId":"cleanup"}
```

A successful `terminated` includes `requestId`, `reason`, `activeProcessCount: 0`, `rootExited: true`, `rootExitCode`, `cleanupVerified: true`, `ownershipVerified: true`, `errors: []`, and `observedProcesses`. Exit code 0 is necessary but not sufficient: consumers must also require a parsed, matching `terminated` record with verified cleanup, zero active processes, and no earlier errors. Exit 1 means uncertainty/failure. Exit 2 is platform, argument validation, or compilation failure before any target launch. A normal-mode compile failure now writes a bounded JSON `compilation` record to stderr. Successful normal-mode compilation stays silent so broker stdout sequence numbers still begin at 1. Stderr never intentionally contains executable arguments, environment variables, or process command lines.

EOF triggers job teardown. Malformed input, truncated lines, oversized input, stdout loss, and the lifetime deadline produce sticky failure and bounded teardown, never a successful cleanup claim. There are at most 256 commands, 4,096 characters per input line, 4,096 active/observed identities, a 5–300 second broker lifetime, and a separately bounded 1–30 second teardown. The default bounds are 180 and 10 seconds. Startup compilation precedes the broker stopwatch, so the Node caller must also bound startup and wait for helper exit. A missing terminal record or killed helper is **unverified**, even though Windows kill-on-close is a final safeguard.

## Ownership and cleanup guarantees

The broker creates the root with `CREATE_SUSPENDED`, retains the original process and primary thread handles, obtains PID and creation time, assigns the process to its private job, verifies assignment, then calls `ResumeThread`. This ordering eliminates the pre-assignment child-spawn race. Assignment/nested-job failure is a hard error. It never retries with breakaway or a disabled browser sandbox.

All descendants inherit the job subject to Windows job semantics; neither breakaway limit is enabled. `TerminateJobObject` targets that kernel job, never a browser name or PID. If initial assignment fails, the suspended root is terminated through its **original CreateProcess handle** and waited for. No PID-based kill fallback exists. An identity-query failure is sticky but does not skip safe job/original-handle termination. The sole job handle remains open until zero-active verification has been attempted; closing it afterward is only a final safeguard, not evidence of success.

Before claiming cleanup, the broker requires successful accounting with `ActiveProcesses == 0`, an empty job PID query, the original root handle signaled, and no uncertainty from any earlier operation. It rechecks creation times on retained observed handles and records final exit states. Query failures, PID/membership mismatch, missing identity, and teardown deadline all force `cleanupVerified: false` and nonzero exit. The caller must stop remaining fixed-plan slots rather than retry or substitute a case.

Inventories query **only the owned job's PIDs**. A newly opened process handle must pass `IsProcessInJob` before its creation time or executable basename is read. The retained root handle and each first-observed member handle remain open through teardown. Creation times are decimal Windows FILETIME strings, not lossy JavaScript numbers. Only `pid`, `creationTimeFileTime`, `executableBasename`, optional `parentPid`, and exit state are exposed. `parentIdentityVerified: false` explicitly means the parent PID is an informational hint, never ownership or a creation-time-verified edge. No system-wide process inventory, unrelated command line, profile, or environment is collected.

An inventory is not an atomic snapshot: children can start or exit between the job PID list and accounting. `inventoryIsAtomic: false` and `observedHistoryIsExhaustive: false` state that limitation. Current process records may differ in length from `activeProcessCount`. An observed member that races with exit before its handle/identity can be verified fails closed; the broker does not relabel it exited on a guess. Job accounting and membership restrictions, not a claimed exhaustive historical process list, establish containment and final zero.

## Harmless owned-child case

`-OwnedChildSelfTest` replaces `-Executable`/`-ArgumentsJson`; it is **not** an additional browser child. It launches a fixed PowerShell root inside the job. That root starts a child PowerShell process with `-NoNewWindow` (direct, non-shell launch), then exits after 1.5 seconds. The child only sleeps for 120 seconds. `ready` is emitted only after the root and inherited child are both observed in the job. After `root_exit`, `inspect` should still show the owned child. Terminating the job must then report zero active processes and the observed child exited. No browser or traffic benchmark runs in this case.

## Checks

Run source contracts anywhere:

```sh
node --test tests/diagnostic-owned-process.test.mjs
```

Windows runtime tests are explicitly opt-in and only launch harmless PowerShell processes:

```powershell
$env:DIAGNOSTIC_OWNED_PROCESS_WINDOWS_TEST = '1'
node --test tests/diagnostic-owned-process.test.mjs
```

Those tests cover normal root completion, a surviving inherited child, stdin EOF, deadline-triggered failure, protocol contamination prevention, bounded exit, verified zero-active teardown, and strict failure records. The opt-in runtime tests require review/authorization before execution. Passing source contracts on another OS does not imply these tests passed.


## Compile-only diagnosis

`-CompileOnly` is an exclusive parameter set and needs no executable or arguments:

```powershell
powershell.exe -NoProfile -NonInteractive -File scripts/diagnostic-owned-process.ps1 -CompileOnly
```

It compiles the fixed, literal embedded C# with the original `Add-Type` provider, references, default options, and strict warning behavior. It does not invoke `DiagnosticOwnedProcess.Run` or any embedded C# method and exits before broker startup on both success and failure. The system compiler may run as part of compilation; no broker Job Object, target root, owned child, or browser is created. A compile-only success is not a lifecycle/ownership/calibration pass.

Compile-only output is one NDJSON `compilation` string on the PowerShell success stream, so same-process `Tee-Object` capture works. When the helper runs as a subprocess, that string appears on stdout. It contains:

- `success`, `compileOnly`, `brokerInvoked: false`, `targetLaunched: false`, `jobCreated: false`.
- SHA-256 of the actual UTF-8 embedded source string, PowerShell/CLR version, provider description, explicit references, unchanged-default compiler-options description, and strict-warning policy. The source string hash may differ across line-ending conversions and describes exactly what this host compiled.
- At most eight unique diagnostics, each containing `errorNumber`, `sourceLine`, `column`, `isWarning`, and at most 512 characters of `errorText`. Source positions refer to the embedded C# string, not the PowerShell file. Missing positions are `null`, not inferred.
- Diagnostic limits, input ErrorRecord count, and a conservative `diagnosticsMayBeTruncated` flag.

Structured `CompilerError` targets are preferred. The pure PowerShell extractor traverses only object arrays, `ArrayList`, `CompilerErrorCollection`, `ErrorRecord`, `ErrorDetails`, `Exception`/`InnerException`, and the explicitly typed `RuntimeException.ErrorRecord` wrapper. Traversal is bounded to 32 queued nodes, depth 4, eight unique diagnostic records, a 4,096-character message scan, and 512 retained characters per text. Reference cycles are skipped. It records actual CLR type names, bounded sanitized error IDs, unknown types, and per-limit truncation flags.

For approved Exception/ErrorDetails messages, only the first nonempty line is considered. If the compiler-code pattern does not match, that sanitized line is retained with nullable code/positions instead of being discarded. Unknown objects yield type-only evidence, never arbitrary string conversion or property enumeration. Uninspected ErrorRecord targets contribute only `GetType().FullName`. First-line text matching an exact line of the fixed embedded C# is replaced with an omission marker. Temporary filenames and drive/UNC paths are redacted; following source excerpts, invocation metadata, stack traces, exception data, arguments, and environment contents are excluded. No unknown shape is presented as a diagnosed cause. Exit 0 requires successful compilation and a returned compiled type. Any captured compiler error prevents invocation and exits 2; no `IgnoreWarnings` or compiler-policy relaxation is used.

The original missing-diagnostic failure alone did not establish a source cause. Run `42382512313` subsequently captured the exact compiler messages: embedded C# lines 274 and 294 were ambiguous between `TaskFactory.StartNew(Action)` and `TaskFactory.StartNew<string>(Func<string>)`, followed by wrong-return-type and `Task` to `Task<string>` conversion errors. The smallest correction is explicit `<string>` at those two calls. No warning-policy, reference, ABI, sandbox, or ownership change is justified by those diagnostics. The correction still requires its separately reviewed compile-only validation; it is not a calibration result.

Additional portable tests check compile-only/fixture-only exit ordering, retained compiler settings, the allowlist, and caps. The JavaScript regex fixtures still test patterns only. Native PowerShell fixture coverage is now supplied separately and must run before another compiler observation; those fixtures have not run in the Linux implementation environment.

The compiler-observability correction preserved the failing embedded source, whose LF-normalized UTF-8 SHA-256 was `92c9a8ea1af7078547545450def34c1c41c5d67f03994ab422a0a6bd7299773f`. The subsequent two-call generic-binding correction produces `0ede36a3cdf2bb167c97345199cd86e7a28bee7360d622fc69c74868776948ad`. A focused regression requires exactly two corrected calls and proves that reversing only those replacements restores the original hash. Explicit references remain `System.dll`, `System.Web.Extensions.dll`, and `System.Core.dll`; default compiler options and strict warnings are unchanged. These source contracts do not themselves establish successful native compilation.


## Native diagnostic-extractor fixtures

The second compiler observation (run `42381077653`) captured eight input error records but the initial extractor returned only `ADD_TYPE_FAILURE`. Its UTF-16 Tee log was readable; encoding was not the loss mechanism. That observation still did not identify the compile cause. The revised extractor retains approved first-line messages and observed CLR shapes rather than requiring every error to match a compiler-code regex.

Run the exclusive fixture-only mode on 64-bit Windows PowerShell 5.1:

```powershell
powershell.exe -NoProfile -NonInteractive -File scripts/diagnostic-owned-process.ps1 -DiagnosticsFixtureOnly
```

This mode executes `tests/diagnostic-compiler-diagnostics.fixture.ps1`, which loads the pure `scripts/diagnostic-compiler-diagnostics.ps1` functions. It constructs fixed in-memory diagnostic objects and exits before Add-Type compilation or any broker/native ownership code. It creates no Job Object, browser, or owned child. The invoking PowerShell process is the only test runner.

Eleven fixtures cover nested arrays/ArrayList/CompilerErrorCollection; structured compiler errors; plain and inner exceptions; formatted and unformatted ErrorDetails; filename/line prefixes without a compiler code; safe error IDs; unknown shapes and target CLR types without content inspection; fixed embedded source-line exclusion; path/control/length redaction; node/record/depth limits and cycles; and the typed PowerShell RuntimeException wrapper. The one-line JSON success-stream result reports passed/failed fixture names, runtime versions, and `compilerInvoked: false`, `brokerInvoked: false`, `targetLaunched: false`, `jobCreated: false`. Failure exits 1. The Node wrapper for these native fixtures requires its own explicit `DIAGNOSTIC_COMPILER_FIXTURE_WINDOWS_TEST=1` opt-in on Windows. The dedicated logged workflow fixture step runs them once; ordinary Node source-contract tests do not duplicate it. Failed fixture records retain only the fixture name, bounded CLR exception type, and sanitized first-line message, with no stack or invocation metadata.

The extractor and native fixtures were an observability correction only. In run `42382512313`, all eleven native fixtures passed and the compile-only step exposed the two overload errors. The subsequent local source correction changes only those two calls, preserving explicit assembly references, compiler options, strict warnings, and native process behavior. No native fixture, compiler, calibration, browser, or benchmark was run locally while implementing that source correction.

A recognized leading C# filename/line/column prefix is removed before generic path redaction, even when Add-Type omits `error CSnnnn`. Supplied positions are retained and missing codes remain null. This prevents path redaction from consuming an unformatted diagnostic reason. Run `42382512313` then used this location-prefixed format to retain the actual overload-resolution diagnostics.
