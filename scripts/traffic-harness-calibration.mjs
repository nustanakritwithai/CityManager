// Standalone diagnostic only. No traffic, build, acceptance-gate changes or retries.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CASES = Object.freeze(['normal-clock', 'shutdown-before-flush', 'owned-child-cleanup']);
export const LIMITS = Object.freeze({drainMs: 10_000, commandMs: 5_000, launchMs: 20_000,
  teardownMs: 15_000, traceBytes: 8 * 1024 * 1024, telemetryRecords: 2000,
  busyCount: 5, yieldCount: 5, busyMs: 25, yieldMs: 80,
  performanceQuantumMs: 0.2, traceTimestampUs: 1, durationErrorMs: 0.002,
  bracketErrorMs: 0.202, minimumBusyCpuMs: 1, minimumYieldSeparationMs: 20});
export const PRIOR_RUNS = Object.freeze([
  {version: 1, run: 'https://github.com/nustanakritwithai/CityManager/actions/runs/42363992254', artifact: 13571680688},
  {version: 2, run: 'https://github.com/nustanakritwithai/CityManager/actions/runs/42366401765', artifact: 13572162138},
  {version: 3, run: 'https://github.com/nustanakritwithai/CityManager/actions/runs/42368070109', artifact: 13573141234},
]);
const PREFIX = 'citymanager.calibration.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const saveJSON = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
const errorText = error => String(error?.message ?? error);
export function plannedCases() {
  return CASES.map((name, index) => ({slot: index + 1, name, outcome: 'not-run', reason: 'Preparation has not completed'}));
}
export async function executeCases(results, execute, save) {
  assert.deepEqual(results.map(r => r.name), CASES, 'The fixed plan cannot be changed');
  let stopReason = null;
  save(); // Every slot is durable before the first action.
  for (const entry of results) {
    if (stopReason) { entry.reason = stopReason; save(); continue; }
    entry.outcome = 'running'; delete entry.reason; save();
    try { Object.assign(entry, await execute({...entry})); }
    catch (error) { Object.assign(entry, {outcome: 'failed', error: errorText(error), checkPassed: false, cleanupVerified: false}); }
    if (entry.outcome !== 'passed' || entry.checkPassed !== true || entry.cleanupVerified !== true) {
      entry.outcome = 'failed';
      stopReason = `Stopped after slot ${entry.slot}: calibration/check/cleanup failed or uncertain; no retry or replacement`;
    }
    save();
  }
}
export function createTelemetry(clock = () => Number(process.hrtime.bigint()) / 1e6) {
  const origin = clock(), records = [];
  let overflow = false;
  return {records, get overflow() { return overflow; },
    record(type, fields = {}) {
      if (records.length >= LIMITS.telemetryRecords) { overflow = true; return; }
      records.push({...fields, type, sequence: records.length + 1, elapsedMs: clock() - origin});
    }};
}
function deadlineError(stage, record) {
  record('deadline-expired', {stage});
  return Error(`Deadline expired at ${stage}`);
}
async function waitUntil(predicate, deadline, stage, record, terminal = () => null) {
  while (!predicate()) {
    const reason = terminal();
    if (reason) throw Error(`${stage}: ${reason}`);
    if (Date.now() >= deadline) throw deadlineError(stage, record);
    await sleep(Math.min(20, Math.max(1, deadline - Date.now())));
  }
}

// All timing instrumentation is outside the saved metric interval. Measures use the
// original start/end numbers; they do not manufacture historical thread CPU clocks.
export function calibrationPage(documentId) {
  return `<!doctype html><meta charset="utf-8"><title>Clock calibration only</title>
<body>Standalone clock calibration<script>
window.calibrate = async function () {
  const documentId = ${JSON.stringify(documentId)}, rows = [];
  const probe = {positiveDeltas: [], monotonic: true};
  let previous = performance.now();
  for (let i = 0; i < 20000; i++) {
    const now = performance.now();
    if (now < previous) probe.monotonic = false;
    if (now > previous) probe.positiveDeltas.push(now - previous);
    previous = now;
  }
  probe.minimumPositiveMs = probe.positiveDeltas.length ? Math.min(...probe.positiveDeltas) : null;
  delete probe.positiveDeltas;
  for (const kind of ['busy', 'yield']) for (let sequence = 1; sequence <= 5; sequence++) {
    const identity = {documentId, kind, sequence};
    const begin = performance.mark('${PREFIX}' + kind + '.begin', {detail: identity});
    const startMs = performance.now();
    if (kind === 'busy') {
      while (performance.now() - startMs < ${LIMITS.busyMs}) { /* fixed synchronous CPU span */ }
    } else await new Promise(resolve => setTimeout(resolve, ${LIMITS.yieldMs}));
    const endMs = performance.now();
    const durationMs = endMs - startMs;
    const end = performance.mark('${PREFIX}' + kind + '.end', {detail: {...identity, startMs, endMs, durationMs}});
    performance.measure('${PREFIX}' + kind + '.measure', {start: startMs, end: endMs, detail: {...identity, startMs, endMs, durationMs}});
    rows.push({...identity, startMs, endMs, durationMs, beginMarkMs: begin.startTime, endMarkMs: end.startTime});
  }
  return {documentId, timeOrigin: performance.timeOrigin, probe, rows};
};
</script>`;
}
function detailOf(event, isMark) {
  const raw = isMark ? event.args?.data?.detail : event.args?.detail;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
const finite = Number.isFinite;
const close = (a, b, tolerance) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
export function validateClockTrace(trace, snapshot) {
  const issues = [], spans = [];
  const require = (condition, message) => { if (!condition) issues.push(message); };
  require(Array.isArray(trace?.traceEvents), 'Missing traceEvents');
  require(typeof snapshot?.documentId === 'string' && snapshot.documentId.length > 0, 'Missing page document identity');
  require(finite(snapshot?.timeOrigin), 'Missing page time origin');
  require(snapshot?.probe?.monotonic === true, 'Page clock is not monotonic');
  require(finite(snapshot?.probe?.minimumPositiveMs) && snapshot.probe.minimumPositiveMs > 0 &&
    snapshot.probe.minimumPositiveMs <= LIMITS.performanceQuantumMs, 'Missing or coarse performance clock precision');
  const expected = ['busy', 'yield'].flatMap(kind => Array.from({length: 5}, (_, i) => `${kind}:${i + 1}`));
  const rows = snapshot?.rows ?? [];
  require(JSON.stringify(rows.map(r => `${r.kind}:${r.sequence}`)) === JSON.stringify(expected), 'Page sequence/count mismatch');
  const marks = [], measures = new Map();
  for (const event of trace?.traceEvents ?? []) {
    if (!event.name?.startsWith(PREFIX)) continue;
    const suffix = event.name.slice(PREFIX.length).split('.');
    const [kind, phase] = suffix;
    require(['busy', 'yield'].includes(kind) && ['begin', 'end', 'measure'].includes(phase) && suffix.length === 2, 'Unexpected calibration event');
    if (phase === 'begin' || phase === 'end') {
      try { marks.push({...event, detail: detailOf(event, true), kind, phase}); }
      catch { issues.push('Invalid mark detail JSON'); }
    } else if (phase === 'measure') {
      const id = event.id2;
      require(id && typeof id === 'object' && Object.keys(id).length === 1 && ('local' in id || 'global' in id), 'Missing measure identity');
      const key = JSON.stringify([event.pid, event.tid, kind, id]);
      const group = measures.get(key) ?? []; group.push(event); measures.set(key, group);
    }
  }
  require(marks.length === 20, 'Expected exactly 20 actual marks');
  // Chromium can reuse async id2 values for non-overlapping user measures.
  // Pair chronological b/e instances inside each identity, rejecting overlap/orphans.
  const measurePairs = [];
  for (const [id, group] of measures) {
    let pending = null;
    for (const event of [...group].sort((a, b) => a.ts - b.ts)) {
      require(finite(event.ts) && Number.isInteger(event.ts), 'Invalid measure wall timestamp');
      if (event.ph === 'b') {
        require(!pending, 'Ambiguous overlapping measure identity');
        pending = event;
      } else if (event.ph === 'e') {
        require(Boolean(pending), 'Orphan measure end');
        if (pending) measurePairs.push({id: `${id}:${measurePairs.length}`, begin: pending, end: event});
        pending = null;
      } else require(false, 'Unexpected measure phase');
    }
    require(!pending, 'Orphan measure begin');
  }
  require(measurePairs.length === 10, 'Expected exactly 10 retrospective measure pairs');
  const contexts = new Set(marks.map(e => JSON.stringify([e.args?.data?.navigationId, e.pid, e.tid])));
  require(contexts.size === 1, 'Document/PID/TID identity changed');
  for (const mark of marks) {
    require(mark.ph === 'I', 'Actual mark must be an instant event');
    require(typeof mark.args?.data?.navigationId === 'string' && mark.args.data.navigationId.length > 0, 'Missing navigation identity');
    require(Number.isInteger(mark.pid) && mark.pid > 0 && Number.isInteger(mark.tid) && mark.tid > 0, 'Missing PID/TID');
    require(finite(mark.ts) && finite(mark.tts), 'Missing actual-mark wall/thread clock');
    require(Number.isInteger(mark.ts) && Number.isInteger(mark.tts), 'Trace clocks not integer microseconds');
    require(mark.detail?.documentId === snapshot?.documentId && mark.detail?.kind === mark.kind, 'Mark document/kind mismatch');
  }
  const orderedMarks = [...marks].sort((a, b) => a.ts - b.ts);
  require(JSON.stringify(orderedMarks.map(m => `${m.kind}:${m.detail?.sequence}:${m.phase}`)) ===
    JSON.stringify(expected.flatMap(key => [`${key}:begin`, `${key}:end`])), 'Actual mark sequence mismatch');
  for (let i = 1; i < orderedMarks.length; i++) {
    require(orderedMarks[i].tts >= orderedMarks[i - 1].tts, 'Nonmonotonic actual-mark thread clock');
  }
  const seenMeasures = new Set();
  for (const row of rows) {
    const key = `${row.kind}:${row.sequence}`;
    const pair = marks.filter(m => m.kind === row.kind && m.detail?.sequence === row.sequence);
    const begin = pair.find(m => m.phase === 'begin'), end = pair.find(m => m.phase === 'end');
    require(pair.length === 2 && begin && end, `Missing/duplicate mark pair ${key}`);
    if (!begin || !end) continue;
    require(row.documentId === snapshot.documentId && row.endMs >= row.startMs &&
      close(row.durationMs, row.endMs - row.startMs, 1e-8), `Page timestamps mismatch ${key}`);
    require(close(begin.args?.data?.startTime, row.beginMarkMs, LIMITS.durationErrorMs) &&
      close(end.args?.data?.startTime, row.endMarkMs, LIMITS.durationErrorMs), `Mark/page timestamps mismatch ${key}`);
    require(row.beginMarkMs <= row.startMs && row.endMarkMs >= row.endMs, `Page bracket excludes interval ${key}`);
    require(close(end.detail?.durationMs, row.durationMs, 1e-8) && close(end.detail?.startMs, row.startMs, 1e-8) &&
      close(end.detail?.endMs, row.endMs, 1e-8), `End mark detail mismatch ${key}`);
    const wallMs = (end.ts - begin.ts) / 1000, threadMs = (end.tts - begin.tts) / 1000;
    require(wallMs >= 0 && threadMs >= 0 && threadMs <= wallMs + LIMITS.bracketErrorMs, `Implausible CPU/wall units ${key}`);
    require(wallMs + LIMITS.bracketErrorMs >= row.durationMs, `Wall bracket shorter than metric ${key}`);
    require(close(wallMs, row.endMarkMs - row.beginMarkMs, LIMITS.bracketErrorMs), `Wall clock unit/precision mismatch ${key}`);
    if (row.kind === 'busy') require(threadMs >= LIMITS.minimumBusyCpuMs && row.durationMs >= LIMITS.busyMs - LIMITS.performanceQuantumMs,
      `Busy span did not advance thread clock plausibly ${key}`);
    if (row.kind === 'yield') require(row.durationMs >= LIMITS.yieldMs - LIMITS.performanceQuantumMs &&
      wallMs - threadMs >= LIMITS.minimumYieldSeparationMs, `Yield did not separate wall and thread clocks ${key}`);
    let matched = 0;
    for (const {id, begin: mb, end: me} of measurePairs) {
      let detail;
      try { detail = detailOf(mb, false); } catch { continue; }
      if (detail?.kind !== row.kind || detail?.sequence !== row.sequence) continue;
      matched++; seenMeasures.add(id);
      require(detail.documentId === snapshot.documentId && mb.pid === begin.pid && mb.tid === begin.tid &&
        me.pid === begin.pid && me.tid === begin.tid, `Measure identity mismatch ${key}`);
      require(close(detail.startMs, row.startMs, 1e-8) && close(detail.endMs, row.endMs, 1e-8) &&
        close(detail.durationMs, row.durationMs, 1e-8) && close(mb.args?.startTime, row.startMs, LIMITS.durationErrorMs), `Measure saved timestamps mismatch ${key}`);
      require(close((me.ts - mb.ts) / 1000, row.durationMs, LIMITS.durationErrorMs), `Measure duration mismatch ${key}`);
      require(mb.ts >= begin.ts - LIMITS.bracketErrorMs * 1000 && me.ts <= end.ts + LIMITS.bracketErrorMs * 1000 &&
        me.ts >= mb.ts, `Measure outside actual brackets ${key}`);
      // Deliberately do not read mb.tts/me.tts: retrospective clocks are not historical CPU.
    }
    require(matched === 1, `Expected one measure for ${key}`);
    spans.push({kind: row.kind, sequence: row.sequence, documentId: row.documentId,
      navigationId: begin.args?.data?.navigationId, pid: begin.pid, tid: begin.tid,
      metricMs: row.durationMs, bracketWallMs: wallMs, bracketThreadMs: threadMs});
  }
  require(seenMeasures.size === measurePairs.length, 'Unmatched retrospective measure');
  const positiveThreadDeltas = orderedMarks.slice(1).map((m, i) => m.tts - orderedMarks[i].tts).filter(n => finite(n) && n > 0);
  return {passed: issues.length === 0, issues, spans, precisionBounds: LIMITS,
    observedMinimumPositiveThreadDeltaUs: positiveThreadDeltas.length ? Math.min(...positiveThreadDeltas) : null,
    interpretation: 'Actual-mark tts deltas are conservative same-thread CPU brackets, including all work between marks. Yielding spans include intervening same-thread work. Observed deltas do not establish hardware clock resolution. Retrospective measure tts is never historical CPU. Calibration is diagnostic, not acceptance or exact attribution.'};
}

export class CdpConnection {
  constructor(socket, record) {
    this.socket = socket; this.record = record; this.pending = new Map(); this.nextId = 0;
    this.events = []; this.closed = false; this.failure = null;
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { this.fail('Invalid CDP JSON'); return; }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) { record('cdp-late-response', {id: message.id}); return; }
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) { record('cdp-error', {id: message.id, method: pending.method, error: message.error}); pending.reject(Error(`${pending.method}: ${message.error.message}`)); }
        else { record('cdp-ack', {id: message.id, method: pending.method}); pending.resolve(message.result ?? {}); }
      } else if (message.method) {
        if (this.events.length >= LIMITS.telemetryRecords) { this.fail('CDP event bound exceeded'); return; }
        this.events.push(message);
        if (message.method === 'Tracing.tracingComplete') record('tracing-complete', {
          stream: message.params?.stream ?? null, dataLossOccurred: message.params?.dataLossOccurred ?? null,
          traceFormat: message.params?.traceFormat ?? null, streamCompression: message.params?.streamCompression ?? null});
        else if (/^(Target\.(detachedFromTarget|targetDestroyed|targetCrashed)|Inspector\.(detached|targetCrashed)|Page\.frameDetached)$/.test(message.method))
          record('target-event', {method: message.method, params: message.params, sessionId: message.sessionId ?? null});
      }
    });
    socket.addEventListener('close', event => { this.closed = true; record('socket-close', {code: event.code, reason: event.reason, wasClean: event.wasClean}); this.fail('CDP socket closed'); });
    socket.addEventListener('error', () => { record('socket-error'); this.fail('CDP socket error'); });
  }
  fail(reason) {
    this.failure ??= reason;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer); this.record('cdp-error', {id, method: pending.method, error: reason}); pending.reject(Error(reason));
    }
    this.pending.clear();
  }
  send(method, params = {}, {sessionId, deadline = Date.now() + LIMITS.commandMs} = {}) {
    const id = ++this.nextId; this.record('cdp-send', {id, method, sessionId: sessionId ?? null});
    if (this.failure || this.closed || this.socket.readyState !== 1) {
      const error = this.failure ?? 'CDP socket is not open'; this.record('cdp-error', {id, method, error}); return Promise.reject(Error(error));
    }
    if (Date.now() >= deadline) return Promise.reject(deadlineError(method, this.record));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(deadlineError(method, this.record)); }, Math.max(1, deadline - Date.now()));
      this.pending.set(id, {resolve, reject, timer, method});
      try { this.socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})})); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); this.record('cdp-error', {id, method, error: errorText(error)}); reject(error); }
    });
  }
  close() { this.record('socket-close-request'); this.socket.close(); }
}
export async function drainTrace(cdp, record, writeChunk, {durationMs = LIMITS.drainMs, maxBytes = LIMITS.traceBytes} = {}) {
  const deadline = Date.now() + durationMs;
  const state = {complete: false, eof: false, bytes: 0, stage: 'Tracing.end', stream: null};
  record('trace-drain-start', {durationMs});
  try {
    await cdp.send('Tracing.end', {}, {deadline});
    state.stage = 'Tracing.tracingComplete';
    await waitUntil(() => cdp.events.some(e => e.method === 'Tracing.tracingComplete'), deadline, state.stage, record,
      () => cdp.failure || (cdp.closed ? 'CDP socket closed before completion' : null));
    const completions = cdp.events.filter(e => e.method === 'Tracing.tracingComplete');
    assert.equal(completions.length, 1, 'Multiple tracingComplete events');
    const completion = completions[0].params;
    assert.ok(typeof completion.stream === 'string' && completion.stream.length, 'Missing trace stream handle');
    state.stream = completion.stream; state.dataLossOccurred = completion.dataLossOccurred ?? false;
    assert.ok(!completion.streamCompression || completion.streamCompression === 'none', 'Unexpected trace compression');
    state.stage = 'IO.read';
    while (!state.eof) {
      if (Date.now() >= deadline) throw deadlineError(state.stage, record);
      record('io-read-start', {stream: state.stream, bytes: state.bytes});
      const chunk = await cdp.send('IO.read', {handle: state.stream, size: 262144}, {deadline});
      assert.equal(typeof chunk.data, 'string', 'Invalid trace stream data');
      const data = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
      assert.ok(state.bytes + data.length <= maxBytes, 'Trace exceeds fixed byte bound');
      writeChunk(data); state.bytes += data.length; state.eof = chunk.eof === true;
      record('io-read-end', {bytes: data.length, eof: state.eof});
      if (state.eof) record('io-eof', {bytes: state.bytes});
    }
    assert.notEqual(state.dataLossOccurred, true, 'Browser reported trace data loss');
    state.complete = true; state.stage = 'complete';
  } catch (error) { state.error = errorText(error); record('trace-drain-error', {stage: state.stage, error: state.error}); }
  finally {
    if (state.stream && !cdp.closed && !cdp.failure && Date.now() < deadline) {
      try { await cdp.send('IO.close', {handle: state.stream}, {deadline}); }
      catch (error) { state.closeError = errorText(error); state.complete = false; }
    }
    record('trace-drain-finished', {...state});
  }
  return state;
}

function validProcessIdentity(identity) {
  return Number.isInteger(identity?.pid) && identity.pid > 0 &&
    typeof identity.creationTimeFileTime === 'string' && /^[1-9]\d*$/.test(identity.creationTimeFileTime) &&
    typeof identity.executableBasename === 'string' && identity.executableBasename.length > 0 &&
    !/[\\/]/.test(identity.executableBasename);
}
function sameProcess(a, b) {
  return validProcessIdentity(a) && validProcessIdentity(b) && a.pid === b.pid &&
    a.creationTimeFileTime === b.creationTimeFileTime && a.executableBasename === b.executableBasename;
}
export function validateOwnershipEvidence(ready, records, terminated) {
  const issues = [], require = (condition, message) => { if (!condition) issues.push(message); };
  require(ready?.jobVerified === true && ready?.ownershipVerified === true, 'Initial ownership was not verified');
  require(validProcessIdentity(ready?.root), 'Missing/invalid owned root identity');
  require(terminated?.cleanupVerified === true && terminated?.ownershipVerified === true, 'Terminal ownership/cleanup was not verified');
  require(terminated?.activeProcessCount === 0 && terminated?.rootExited === true, 'Owned root or descendants may remain');
  require(Array.isArray(terminated?.errors) && terminated.errors.length === 0, 'Terminal ownership errors');
  require(!records.some(r => r.type === 'error' || r.type === 'fatal'), 'Earlier ownership failure');
  const exits = records.filter(r => r.type === 'root_exit');
  require(exits.length === 1 && sameProcess(exits[0], ready?.root), 'Root exit identity does not match created root');
  require(Number.isInteger(exits[0]?.exitCode) && exits[0].exitCode === terminated?.rootExitCode, 'Root exit code mismatch');
  const known = new Map();
  for (const record of records) {
    if (record.root) require(sameProcess(record.root, ready?.root), 'Root identity changed during lifecycle');
    if (Array.isArray(record.processes)) for (const member of record.processes) {
      require(validProcessIdentity(member), 'Inventory has missing process identity');
      if (known.has(member.pid)) require(sameProcess(known.get(member.pid), member), 'PID reused or identity changed');
      else known.set(member.pid, member);
    }
  }
  const observed = terminated?.observedProcesses;
  require(Array.isArray(observed) && observed.length > 0, 'Missing terminal owned-process history');
  require(Array.isArray(observed) && observed.some(p => sameProcess(p, ready?.root)), 'Terminal root identity missing or changed');
  const terminalPids = new Set();
  for (const member of observed ?? []) {
    require(validProcessIdentity(member), 'Invalid terminal process identity');
    require(member.exitState === 'exited', 'Observed owned process is surviving or uncertain');
    require(!terminalPids.has(member.pid), 'Duplicate/reused terminal PID'); terminalPids.add(member.pid);
    if (known.has(member.pid)) require(sameProcess(known.get(member.pid), member), 'Terminal creation time changed');
  }
  for (const member of known.values()) require(observed?.some(p => sameProcess(p, member)), 'Previously observed process is missing from teardown');
  return {passed: issues.length === 0, issues};
}

class OwnedProcess {
  constructor(helper, args, record) {
    this.records = []; this.record = record; this.error = null; this.exited = false; this.exitCode = null; this.request = 0;
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper, ...args,
      '-LifetimeSeconds', '180', '-TeardownSeconds', '10'], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    this.child.on('error', error => { this.error = errorText(error); record('owner-helper-error', {error: this.error}); });
    this.child.on('exit', (code, signal) => { this.exitCode = code; record('owner-helper-exit', {code, signal}); });
    this.child.on('close', () => { this.exited = true; record('owner-helper-stdio-closed'); });
    this.child.stdin.on('error', error => { this.error = errorText(error); record('owner-helper-stdin-error', {error: this.error}); });
    let buffer = '', stderrBytes = 0;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', text => {
      buffer += text;
      if (Buffer.byteLength(buffer) > 1024 * 1024) { this.error = 'Owner protocol line exceeds bound'; buffer = ''; return; }
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          assert.equal(event.sequence, this.records.length + 1, 'Owner protocol sequence mismatch');
          assert.ok(finite(event.elapsedMs), 'Owner protocol missing monotonic time');
          assert.ok(!this.records.length || event.elapsedMs >= this.records.at(-1).elapsedMs, 'Owner protocol clock regressed');
          assert.ok(this.records.length < 500, 'Owner protocol record bound');
          this.records.push(event); record('owner-event', {event});
          if (event.type === 'error' || event.type === 'fatal') this.error = event.error ?? JSON.stringify(event.errors ?? event);
        } catch (error) { this.error = errorText(error); record('owner-protocol-error', {error: this.error}); }
      }
    });
    this.child.stdout.on('end', () => { if (buffer.trim()) this.error = 'Unterminated owner protocol record'; });
    this.child.stderr.on('data', data => {
      stderrBytes += data.length;
      // The helper emits no commands/env/profile contents. Preserve its bounded diagnostics only.
      if (stderrBytes <= 16384) record('owner-helper-stderr', {text: String(data)});
      else this.error = 'Owner helper stderr exceeded bound';
    });
  }
  async event(type, requestId, durationMs) {
    await waitUntil(() => this.records.some(r => r.type === type && (!requestId || r.requestId === requestId)),
      Date.now() + durationMs, `owner.${type}`, this.record,
      () => this.error || (this.exited ? 'Owner helper exited without required response' : null));
    return this.records.find(r => r.type === type && (!requestId || r.requestId === requestId));
  }
  async ready() {
    const ready = await this.event('ready', null, LIMITS.launchMs);
    assert.equal(ready.jobVerified, true, 'Windows Job ownership not verified');
    assert.equal(ready.ownershipVerified, true, 'Initial process ownership unverified');
    assert.ok(validProcessIdentity(ready.root), 'Missing owned root identity');
    this.readyRecord = ready; return ready;
  }
  command(command) {
    const requestId = String(++this.request);
    this.record('owner-command', {command, requestId});
    assert.ok(!this.exited && !this.child.stdin.destroyed, 'Owner helper is unavailable');
    this.child.stdin.write(JSON.stringify({command, requestId}) + '\n'); return requestId;
  }
  async inspect() { return this.event('inventory', this.command('inspect'), LIMITS.commandMs); }
  async terminate() {
    let result;
    try {
      result = await this.event('terminated', this.command('terminate'), LIMITS.teardownMs);
      await waitUntil(() => this.exited, Date.now() + LIMITS.commandMs, 'owner.helper-exit', this.record);
      assert.equal(result.cleanupVerified, true, 'Owned process cleanup unverified');
      assert.equal(result.ownershipVerified, true, 'Ownership was not verified throughout');
      assert.equal(result.activeProcessCount, 0, 'Owned processes remain');
      assert.equal(result.rootExited, true, 'Owned root exit unverified');
      assert.deepEqual(result.errors, [], 'Owner reported cleanup errors');
      assert.equal(this.exitCode, 0, 'Owner helper exited unsuccessfully');
      assert.equal(this.error, null, 'Owner helper protocol failed');
      const evidence = validateOwnershipEvidence(this.readyRecord, this.records, result);
      assert.equal(evidence.passed, true, evidence.issues.join('; '));
      return result;
    } catch (error) {
      this.record('cleanup-error', {error: errorText(error)});
      // EOF invokes the helper's bounded Job-only cleanup; never kill by image name/PID.
      this.child.stdin.end();
      if (!this.exited) {
        try { await waitUntil(() => this.exited, Date.now() + LIMITS.teardownMs, 'owner.EOF-cleanup', this.record); }
        catch { this.record('owner-helper-stop-request'); this.child.kill(); }
      }
      return {...result, cleanupVerified: false, error: errorText(error)};
    }
  }
}
async function portOpen(port) {
  return new Promise(resolve => {
    const socket = createConnection({host: '127.0.0.1', port});
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true)); socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
    socket.setTimeout(500, () => done(true));
  });
}
async function portsFree(ports, record) {
  let free = false;
  for (let i = 0; i < 20; i++) {
    free = (await Promise.all(ports.map(portOpen))).every(open => !open);
    if (free) break; await sleep(100);
  }
  record('ports-check', {ports, portsFree: free}); return free;
}
async function discoverBrowser(port, record, owner) {
  const deadline = Date.now() + LIMITS.launchMs;
  while (Date.now() < deadline) {
    if (owner.error || owner.records.some(e => e.type === 'root_exit')) throw Error(owner.error ?? 'Owned browser root exited during launch');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(500)});
      if (response.ok) {
        const version = await response.json();
        const url = new URL(version.webSocketDebuggerUrl);
        assert.equal(url.protocol, 'ws:'); assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.equal(Number(url.port), port);
        return version;
      }
    } catch { /* bounded readiness polling is not a replacement browser or case */ }
    await sleep(50);
  }
  throw deadlineError('browser.discovery', record);
}
async function openCdp(url, record) {
  const socket = new WebSocket(url), cdp = new CdpConnection(socket, record);
  await waitUntil(() => socket.readyState === 1, Date.now() + LIMITS.commandMs, 'socket.open', record, () => cdp.failure);
  record('socket-open'); return cdp;
}
export function browserArguments(port, profile) {
  return ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', 'about:blank'];
}
async function runCase(entry, context) {
  const {root, output, executable, helper} = context;
  const directory = resolve(output, `case-${entry.slot}-${entry.name}`); mkdirSync(directory);
  const telemetry = createTelemetry(), record = telemetry.record;
  let owner, cdp, server, result = {checkPassed: false, cleanupVerified: false}, cleanup;
  const port = 9376, httpPort = 4206;
  try {
    if (entry.name === 'owned-child-cleanup') {
      owner = new OwnedProcess(helper, ['-OwnedChildSelfTest'], record);
      result.ready = await owner.ready();
      assert.ok(result.ready.activeProcessCount >= 2, 'Self-test did not establish owned root and child');
      await owner.event('root_exit', null, LIMITS.launchMs);
      result.afterRootExit = await owner.inspect();
      assert.ok(result.afterRootExit.activeProcessCount >= 1, 'No surviving owned child after root exit');
      assert.ok(result.afterRootExit.processes.every(p => p.pid !== result.ready.root.pid), 'Root remains active after reported exit');
      result.checkPassed = true;
    } else {
      assert.equal(await portOpen(port), false, 'Dedicated CDP port occupied; nothing will be killed');
      const documentId = `calibration-${entry.name}`, page = calibrationPage(documentId);
      writeFileSync(resolve(directory, 'page.html'), page);
      server = createServer((request, response) => {
        if (request.url !== '/calibration.html') { response.writeHead(404); response.end(); return; }
        response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}); response.end(page);
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(httpPort, '127.0.0.1', resolve); });
      record('local-page-listening', {port: httpPort});
      const profile = resolve(directory, 'profile');
      owner = new OwnedProcess(helper, ['-Executable', executable, '-ArgumentsJson', JSON.stringify(browserArguments(port, profile)), '-WorkingDirectory', root], record);
      result.ready = await owner.ready();
      const discovery = await discoverBrowser(port, record, owner);
      cdp = await openCdp(discovery.webSocketDebuggerUrl, record);
      result.browser = await cdp.send('Browser.getVersion');
      await cdp.send('Target.setDiscoverTargets', {discover: true});
      const targets = await cdp.send('Target.getTargets');
      const pages = targets.targetInfos.filter(t => t.type === 'page' && t.url === 'about:blank');
      assert.equal(pages.length, 1, 'Expected one owned blank page');
      const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: pages[0].targetId, flatten: true});
      const pageSend = (method, params = {}, deadline) => cdp.send(method, params, {sessionId, ...(deadline ? {deadline} : {})});
      await pageSend('Runtime.enable'); await pageSend('Page.enable'); await pageSend('Inspector.enable');
      await pageSend('Page.setLifecycleEventsEnabled', {enabled: true});
      await cdp.send('Tracing.start', {categories: 'devtools.timeline,blink.user_timing', options: 'record-continuously', transferMode: 'ReturnAsStream'});
      const navigation = await pageSend('Page.navigate', {url: `http://127.0.0.1:${httpPort}/calibration.html`});
      assert.ok(!navigation.errorText && navigation.loaderId, 'Calibration navigation failed');
      result.navigation = navigation;
      await waitUntil(() => cdp.events.some(e => e.method === 'Page.lifecycleEvent' && e.sessionId === sessionId && e.params?.name === 'load' && e.params?.loaderId === navigation.loaderId),
        Date.now() + LIMITS.commandMs, 'page.load', record, () => cdp.failure);
      const evaluated = await pageSend('Runtime.evaluate', {expression: 'window.calibrate()', awaitPromise: true, returnByValue: true}, Date.now() + 15_000);
      assert.ok(!evaluated.exceptionDetails, 'Calibration page threw an exception');
      result.snapshot = evaluated.result?.value;
      saveJSON(resolve(directory, 'snapshot.json'), result.snapshot ?? null); // persisted before any checking/flush
      result.preFlushInventory = await owner.inspect();
      assert.equal(result.preFlushInventory.ownershipVerified, true, 'Pre-flush ownership uncertain');
      if (entry.name === 'shutdown-before-flush') {
        record('controlled-shutdown-before-flush');
        try { await cdp.send('Browser.close'); } catch (error) { result.browserCloseError = errorText(error); }
        await owner.event('root_exit', null, LIMITS.launchMs);
        await waitUntil(() => cdp.closed, Date.now() + LIMITS.commandMs, 'controlled.socket-close', record);
      }
      const chunks = [];
      result.trace = await drainTrace(cdp, record, chunk => chunks.push(chunk));
      if (chunks.length) writeFileSync(resolve(directory, 'trace.json'), Buffer.concat(chunks));
      saveJSON(resolve(directory, 'trace-status.json'), result.trace);
      if (entry.name === 'normal-clock') {
        assert.equal(result.trace.complete, true, `Trace drain failed: ${result.trace.error}`);
        const validation = validateClockTrace(JSON.parse(Buffer.concat(chunks).toString('utf8')), result.snapshot);
        saveJSON(resolve(directory, 'clock-validation.json'), validation);
        assert.equal(validation.passed, true, validation.issues.join('; '));
        assert.ok(validation.spans.every(span => result.preFlushInventory.processes.some(p => p.pid === span.pid && validProcessIdentity(p))), 'Trace renderer was not in owned job inventory');
        result.clockCalibrationPassed = true;
      } else {
        assert.equal(result.trace.complete, false, 'Unexpected complete trace after deliberate shutdown');
        assert.equal(result.trace.eof, false, 'Unexpected EOF after deliberate shutdown');
        assert.equal(result.trace.stage, 'Tracing.end', 'Controlled interruption was not localized at end send');
        assert.match(result.trace.error, /socket closed/, 'Controlled shutdown must be classified as a closed socket');
        assert.ok(cdp.closed && owner.records.some(e => e.type === 'root_exit'), 'Missing controlled shutdown evidence');
        result.expectedInterruptionVerified = true;
      }
      result.checkPassed = true;
    }
  } catch (error) { result.error = errorText(error); record('case-error', {error: result.error}); }
  finally {
    if (cdp && !cdp.closed && !cdp.failure) {
      try { await cdp.send('Browser.close'); } catch (error) { result.browserCloseError = errorText(error); }
    }
    if (owner) cleanup = await owner.terminate();
    else cleanup = {cleanupVerified: false, error: 'Owned process was never established'};
    if (cdp && !cdp.closed) cdp.close();
    let serverClosed = !server;
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(error => { serverClosed = !error; resolve(); }));
    }
    const free = entry.name === 'owned-child-cleanup' ? true : await portsFree([port, httpPort], record);
    result.cleanup = {ownedTreeExited: cleanup.activeProcessCount === 0 && cleanup.rootExited === true,
      ownedCleanup: cleanup, localServerClosed: serverClosed, previewExited: null, portsFree: free,
      cleanupVerified: cleanup.cleanupVerified === true && serverClosed && free};
    result.cleanupVerified = result.cleanup.cleanupVerified;
    if (telemetry.overflow) { result.checkPassed = false; result.error = 'Lifecycle telemetry bound exceeded'; }
    result.outcome = result.checkPassed && result.cleanupVerified ? 'passed' : 'failed';
    saveJSON(resolve(directory, 'lifecycle.json'), {overflow: telemetry.overflow, records: telemetry.records});
    saveJSON(resolve(directory, 'ownership.json'), owner?.records ?? []);
    saveJSON(resolve(directory, 'result.json'), result);
  }
  return {outcome: result.outcome, checkPassed: result.checkPassed, cleanupVerified: result.cleanupVerified,
    error: result.error ?? null, clockCalibrationPassed: result.clockCalibrationPassed ?? null,
    expectedInterruptionVerified: result.expectedInterruptionVerified ?? null, artifactDirectory: `case-${entry.slot}-${entry.name}`};
}
export async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(root, '.test-output/harness-calibration');
  assert.ok(!existsSync(output), 'Refuse to overwrite a previous calibration'); mkdirSync(output, {recursive: true});
  const manifest = {schemaVersion: 1, purpose: 'Standalone lifecycle/clock calibration only; no traffic comparison or release clearance',
    priorRuns: PRIOR_RUNS, plan: [...CASES], results: plannedCases(), limits: LIMITS,
    runner: {platform: process.platform, node: process.version, image: process.env.ImageVersion ?? null},
    clockMeaning: 'Only actual-mark tts brackets may bound same-thread CPU; retrospective measure tts is not historical CPU.',
    noRetries: true, noReplacement: true, productionSourceImported: false};
  const save = () => saveJSON(resolve(output, 'manifest.json'), manifest); save();
  try {
    assert.equal(process.platform, 'win32', 'Standalone calibration requires Windows Edge; do not launch on Unix');
    const helper = resolve(root, 'scripts/diagnostic-owned-process.ps1');
    const executable = process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    assert.ok(existsSync(helper) && existsSync(executable), 'Required owned launcher or installed Edge is missing');
    const git = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
    assert.equal(git.status, 0, 'Cannot establish source identity'); manifest.commit = git.stdout.trim();
    manifest.sourceSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
    manifest.launcherSha256 = sha256(readFileSync(helper)); save();
    await executeCases(manifest.results, entry => runCase(entry, {root, output, executable, helper}), save);
    assert.ok(manifest.results.every(r => r.outcome === 'passed' && r.cleanupVerified), 'Calibration failed; remaining slots retained as not-run. Do not retry.');
    manifest.passed = true;
  } catch (error) {
    manifest.passed = false; manifest.error = errorText(error);
    for (const entry of manifest.results) if (entry.outcome === 'not-run' && entry.reason === 'Preparation has not completed') entry.reason = `Preparation failed: ${manifest.error}`;
    process.exitCode = 1;
  } finally { save(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
