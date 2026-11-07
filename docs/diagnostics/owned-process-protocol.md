# Diagnostic Windows process ownership broker

`scripts/diagnostic-owned-process.ps1` is new diagnostic-only scaffolding. It does not modify the ordinary browser launch, smoke tests, timing thresholds, or browser sandbox flags. It has **not been executed on Windows** as part of the local implementation. Source contracts are not proof of native API behavior; independent review and the separately authorized Windows calibration remain required.

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

A successful `terminated` includes `requestId`, `reason`, `activeProcessCount: 0`, `rootExited: true`, `rootExitCode`, `cleanupVerified: true`, `ownershipVerified: true`, `errors: []`, and `observedProcesses`. Exit code 0 is necessary but not sufficient: consumers must also require a parsed, matching `terminated` record with verified cleanup, zero active processes, and no earlier errors. Exit 1 means uncertainty/failure. Exit 2 is platform, argument validation, or compilation failure before any target launch. Stderr never intentionally contains executable arguments, environment variables, or process command lines.

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
