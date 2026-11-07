import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {CASES, LIMITS, PRIOR_RUNS, plannedCases, executeCases, createTelemetry, calibrationPage,
  validateClockTrace, validateOwnershipEvidence, CdpConnection, drainTrace, browserArguments} from '../scripts/traffic-harness-calibration.mjs';

function fixture() {
  const snapshot = {documentId: 'fixture-doc', timeOrigin: 1234, probe: {monotonic: true, minimumPositiveMs: 0.1}, rows: []};
  const traceEvents = []; let time = 100, thread = 5000, id = 0;
  for (const kind of ['busy', 'yield']) for (let sequence = 1; sequence <= 5; sequence++) {
    const startMs = time + 0.1, durationMs = kind === 'busy' ? 25 : 80, endMs = startMs + durationMs;
    const row = {documentId: snapshot.documentId, kind, sequence, startMs, endMs, durationMs,
      beginMarkMs: time, endMarkMs: endMs + 0.1};
    snapshot.rows.push(row);
    const common = {cat: 'blink.user_timing', pid: 40, tid: 41};
    const stamp = ms => Math.round(1000000 + ms * 1000);
    traceEvents.push({...common, name: `citymanager.calibration.${kind}.begin`, ph: 'I', ts: stamp(row.beginMarkMs), tts: thread,
      args: {data: {navigationId: 'navigation-1', startTime: row.beginMarkMs, detail: JSON.stringify({documentId: row.documentId, kind, sequence})}}});
    thread += kind === 'busy' ? 25000 : 1000;
    traceEvents.push({...common, name: `citymanager.calibration.${kind}.end`, ph: 'I', ts: stamp(row.endMarkMs), tts: thread,
      args: {data: {navigationId: 'navigation-1', startTime: row.endMarkMs, detail: JSON.stringify({documentId: row.documentId, kind, sequence, startMs, endMs, durationMs})}}});
    const measure = {...common, name: `citymanager.calibration.${kind}.measure`, id2: {local: String(++id)}};
    traceEvents.push({...measure, ph: 'b', ts: stamp(startMs), args: {startTime: startMs, detail: JSON.stringify({documentId: row.documentId, kind, sequence, startMs, endMs, durationMs})}});
    traceEvents.push({...measure, ph: 'e', ts: stamp(endMs), args: {}});
    time = endMs + 5; thread += 2000;
  }
  return {snapshot, trace: {traceEvents}};
}
const validation = (mutate = () => {}) => { const f = fixture(); mutate(f); return validateClockTrace(f.trace, f.snapshot); };

test('fixed manifest has every case before any action, no traffic or replacement slots', async () => {
  assert.deepEqual(CASES, ['normal-clock', 'shutdown-before-flush', 'owned-child-cleanup']);
  const results = plannedCases(), saves = [], calls = [];
  assert.ok(results.every(r => r.outcome === 'not-run'));
  await executeCases(results, async entry => { calls.push(entry.name); return {outcome: 'passed', checkPassed: true, cleanupVerified: true}; }, () => saves.push(structuredClone(results)));
  assert.ok(saves[0].every(r => r.outcome === 'not-run'));
  assert.deepEqual(calls, CASES); assert.ok(results.every(r => r.outcome === 'passed'));
});
test('any check, cleanup, or unexpected failure stops all later slots as not-run', async () => {
  for (const failure of [
    {outcome: 'failed', checkPassed: false, cleanupVerified: true},
    {outcome: 'passed', checkPassed: true, cleanupVerified: false},
    {outcome: 'passed', checkPassed: false, cleanupVerified: true},
    {outcome: 'passed', checkPassed: true},
    Error('setup failed'),
  ]) {
    const results = plannedCases(), calls = [];
    await executeCases(results, async entry => {
      calls.push(entry.slot); if (failure instanceof Error) throw failure; return failure;
    }, () => {});
    assert.deepEqual(calls, [1]); assert.equal(results[0].outcome, 'failed');
    assert.ok(results.slice(1).every(r => r.outcome === 'not-run' && /no retry or replacement/.test(r.reason)));
  }
});
test('valid five busy and five yielding spans calibrate only actual mark clocks', () => {
  const result = validation(); assert.equal(result.passed, true, result.issues.join('; '));
  assert.equal(result.spans.length, 10);
  assert.ok(result.spans.filter(r => r.kind === 'busy').every(r => r.bracketThreadMs > 1));
  assert.ok(result.spans.filter(r => r.kind === 'yield').every(r => r.bracketWallMs - r.bracketThreadMs >= 20));
  assert.match(result.interpretation, /all work between marks/);
  assert.match(result.interpretation, /Retrospective measure tts is never historical CPU/);
});
test('reused async measure IDs pair chronological instances, while orphans and overlap fail', () => {
  const reused = f => { for (const e of f.trace.traceEvents) if (e.id2) e.id2 = {local: 'reused'}; };
  assert.equal(validation(reused).passed, true);
  assert.equal(validation(f => { reused(f); f.trace.traceEvents[6].ts = f.trace.traceEvents[2].ts + 1; }).passed, false);
  assert.equal(validation(f => { reused(f); f.trace.traceEvents.splice(3, 1); }).passed, false);
});
test('missing wall/thread clocks, wrong units, and quantization fail closed', () => {
  for (const mutate of [
    f => { delete f.trace.traceEvents[0].tts; },
    f => { delete f.trace.traceEvents[0].ts; },
    f => { f.trace.traceEvents[0].tts = 0.2; },
    f => { for (const e of f.trace.traceEvents) if ('tts' in e) e.tts *= 1000; },
    f => { for (const e of f.trace.traceEvents) if ('tts' in e) e.tts = Math.round(e.tts / 1000); },
    f => { f.snapshot.probe.minimumPositiveMs = null; },
    f => { f.snapshot.probe.minimumPositiveMs = 1; },
    f => { f.snapshot.probe.monotonic = false; },
  ]) assert.equal(validation(mutate).passed, false);
});
test('document, navigation, PID, TID and contiguous sequences cannot drift', () => {
  for (const mutate of [
    f => { f.trace.traceEvents[1].pid++; },
    f => { f.trace.traceEvents[1].tid++; },
    f => { delete f.trace.traceEvents[1].args.data.navigationId; },
    f => { f.trace.traceEvents[1].args.data.navigationId = 'different'; },
    f => { const e = f.trace.traceEvents[0]; e.args.data.detail = e.args.data.detail.replace('fixture-doc', 'other-doc'); },
    f => { f.snapshot.rows[2].sequence = 4; },
    f => { f.trace.traceEvents.push(structuredClone(f.trace.traceEvents[0])); },
    f => { f.trace.traceEvents.splice(0, 1); },
    f => { f.trace.traceEvents[0].ph = 'b'; },
  ]) assert.equal(validation(mutate).passed, false);
});
test('thread regression between spans, zero busy CPU and CPU beyond wall fail', () => {
  for (const mutate of [
    f => { f.trace.traceEvents[4].tts = f.trace.traceEvents[1].tts - 1; },
    f => { f.trace.traceEvents[1].tts = f.trace.traceEvents[0].tts; },
    f => { f.trace.traceEvents[1].tts += 10000; },
    f => { f.trace.traceEvents[21].tts = f.trace.traceEvents[20].tts + 80000; },
  ]) assert.equal(validation(mutate).passed, false);
});
test('measures must match exact saved timestamps/duration and lie within actual brackets', () => {
  for (const mutate of [
    f => { f.trace.traceEvents[3].ts += 10; },
    f => { f.trace.traceEvents[2].ts += 1000; f.trace.traceEvents[3].ts += 1000; },
    f => { f.trace.traceEvents[2].args.startTime += 1; },
    f => { f.trace.traceEvents[2].pid++; },
    f => { f.trace.traceEvents[2].id2 = null; },
    f => { f.trace.traceEvents.splice(3, 1); },
    f => { f.snapshot.rows[0].durationMs++; },
    f => { f.trace.traceEvents[0].args.data.startTime += 1; },
  ]) assert.equal(validation(mutate).passed, false);
});
test('explicit precision bounds accept trace microsecond rounding, not arbitrary slack', () => {
  assert.equal(LIMITS.durationErrorMs, 0.002); assert.equal(LIMITS.bracketErrorMs, 0.202);
  assert.equal(validation(f => { f.trace.traceEvents[3].ts += 1; }).passed, true);
  assert.equal(validation(f => { f.trace.traceEvents[3].ts += 3; }).passed, false);
});
test('retrospective measure tts is ignored, never interpreted as historical CPU', () => {
  const result = validation(f => {
    for (const e of f.trace.traceEvents) if (e.ph === 'b' || e.ph === 'e') e.tts = e.ph === 'b' ? Number.MAX_SAFE_INTEGER : -100;
  });
  assert.equal(result.passed, true, result.issues.join('; '));
});
test('standalone page records marks outside original interval and retrospective measures from saved endpoints', async () => {
  const html = calibrationPage('vm-doc'); let now = 0; const calls = [];
  const performance = {timeOrigin: 100, now: () => { now = Math.round((now + 0.1) * 10) / 10; return now; },
    mark: (name, options) => { calls.push({name, ...options}); now += 1; return {startTime: now}; },
    measure: (name, options) => { calls.push({name, ...options}); now += 100; }};
  const context = {window: {}, performance, setTimeout: (callback, ms) => { now += ms; callback(); }};
  runInNewContext(html.split('<script>')[1].split('</script>')[0], context);
  const snapshot = await context.window.calibrate();
  assert.equal(snapshot.rows.length, 10); assert.equal(calls.length, 30);
  for (let i = 0; i < 10; i++) {
    const row = snapshot.rows[i], [begin, end, measure] = calls.slice(i * 3, i * 3 + 3);
    assert.ok(begin.name.endsWith('.begin')); assert.ok(end.name.endsWith('.end')); assert.ok(measure.name.endsWith('.measure'));
    assert.equal(measure.start, row.startMs); assert.equal(measure.end, row.endMs);
    assert.equal(row.durationMs, row.endMs - row.startMs);
    assert.ok(row.beginMarkMs <= row.startMs && row.endMarkMs >= row.endMs);
    assert.ok(row.durationMs < (row.kind === 'busy' ? 26 : 81), 'post-span instrumentation is excluded');
  }
  assert.ok(!html.includes('src/')); assert.ok(!html.includes('import '));
});

function mockTrace(mode) {
  const events = [], calls = [], chunks = [], log = [];
  const cdp = {events, closed: false, failure: null, async send(method) {
    calls.push(method);
    if (method === 'Tracing.end') {
      if (mode === 'socket') { this.closed = true; this.failure = 'CDP socket closed'; throw Error(this.failure); }
      if (mode !== 'deadline') events.push({method: 'Tracing.tracingComplete', params: mode === 'missing' ? {} : {stream: 'owned-stream', dataLossOccurred: mode === 'loss'}});
    }
    if (method === 'IO.read') {
      if (mode === 'read') throw Error('controlled IO error');
      return {data: '{"traceEvents":[]}', eof: true};
    }
    if (method === 'IO.close' && mode === 'close') throw Error('IO.close failed');
    return {};
  }};
  return {cdp, calls, chunks, log, record: (type, fields) => log.push({type, ...fields})};
}
test('bounded stream drain orders end/complete/read/EOF/close and attests only complete data', async () => {
  const mock = mockTrace('ok');
  const state = await drainTrace(mock.cdp, mock.record, data => mock.chunks.push(data));
  assert.equal(state.complete, true); assert.equal(state.eof, true);
  assert.deepEqual(mock.calls, ['Tracing.end', 'IO.read', 'IO.close']);
  assert.ok(mock.log.some(e => e.type === 'io-eof')); assert.equal(Buffer.concat(mock.chunks).toString(), '{"traceEvents":[]}');
});
test('missing stream, IO errors, data loss, close failure and socket closure remain distinct', async () => {
  for (const mode of ['missing', 'read', 'loss', 'close', 'socket']) {
    const mock = mockTrace(mode), state = await drainTrace(mock.cdp, mock.record, data => mock.chunks.push(data));
    assert.equal(state.complete, false, mode);
    if (mode === 'missing') { assert.equal(state.stage, 'Tracing.tracingComplete'); assert.match(state.error, /Missing trace stream handle/); assert.ok(!mock.calls.includes('IO.read')); }
    if (mode === 'socket') { assert.equal(state.stage, 'Tracing.end'); assert.match(state.error, /socket closed/); }
    if (mode === 'read') { assert.equal(state.stage, 'IO.read'); assert.match(state.error, /controlled IO error/); }
    if (mode === 'loss') assert.match(state.error, /data loss/);
    if (mode === 'close') assert.match(state.closeError, /IO.close failed/);
  }
});
test('drain deadline and byte bound stop with explicit stage and no completion', async () => {
  const mock = mockTrace('deadline'), started = Date.now();
  const state = await drainTrace(mock.cdp, mock.record, () => {}, {durationMs: 5});
  assert.equal(state.complete, false); assert.equal(state.stage, 'Tracing.tracingComplete');
  assert.ok(Date.now() - started < 1000); assert.ok(mock.log.some(e => e.type === 'deadline-expired'));
  const big = mockTrace('ok'); const bounded = await drainTrace(big.cdp, big.record, () => { throw Error('must not write oversized trace'); }, {maxBytes: 1});
  assert.match(bounded.error, /fixed byte bound/); assert.equal(bounded.complete, false);
});
class FakeSocket extends EventTarget {
  readyState = 1; sent = [];
  send(json) { this.sent.push(JSON.parse(json)); }
  emit(type, fields = {}) { const event = new Event(type); Object.assign(event, fields); this.dispatchEvent(event); }
  close() { this.readyState = 3; this.emit('close', {code: 1000, reason: '', wasClean: true}); }
}
test('CDP records send/ack/errors and tracing completion details in monotonic order', async () => {
  let now = 0; const telemetry = createTelemetry(() => ++now), socket = new FakeSocket();
  const cdp = new CdpConnection(socket, telemetry.record);
  const start = cdp.send('Tracing.start'); socket.emit('message', {data: JSON.stringify({id: 1, result: {}})}); await start;
  const end = cdp.send('Tracing.end'); socket.emit('message', {data: JSON.stringify({id: 2, error: {code: -1, message: 'rejected'}})});
  await assert.rejects(end, /rejected/);
  socket.emit('message', {data: JSON.stringify({method: 'Tracing.tracingComplete', params: {stream: 'handle', dataLossOccurred: false}})});
  socket.emit('message', {data: JSON.stringify({method: 'Inspector.targetCrashed', params: {}})});
  assert.deepEqual(telemetry.records.slice(0, 4).map(e => e.type), ['cdp-send', 'cdp-ack', 'cdp-send', 'cdp-error']);
  assert.equal(telemetry.records[4].stream, 'handle'); assert.equal(telemetry.records[5].type, 'target-event');
  assert.ok(telemetry.records.every((e, i, a) => e.sequence === i + 1 && (!i || e.elapsedMs >= a[i - 1].elapsedMs)));
});
test('unexpected socket close immediately rejects pending command, never masquerades as missing stream', async () => {
  const socket = new FakeSocket(), log = [], cdp = new CdpConnection(socket, (type, fields) => log.push({type, ...fields}));
  const pending = cdp.send('Tracing.end'); socket.close();
  await assert.rejects(pending, /socket closed/); assert.ok(log.some(e => e.type === 'socket-close'));
  await assert.rejects(cdp.send('IO.read'), /socket closed/); assert.equal(cdp.pending.size, 0);
});
test('CDP command deadline identifies command and removes pending entry', async () => {
  const socket = new FakeSocket(), log = [], cdp = new CdpConnection(socket, (type, fields) => log.push({type, ...fields}));
  await assert.rejects(cdp.send('Tracing.end', {}, {deadline: Date.now() + 5}), /Deadline expired at Tracing.end/);
  assert.equal(cdp.pending.size, 0); assert.ok(log.some(e => e.type === 'deadline-expired' && e.stage === 'Tracing.end'));
});
test('bounded lifecycle overflow is explicit and cannot silently lose telemetry', () => {
  const telemetry = createTelemetry(); for (let i = 0; i <= LIMITS.telemetryRecords; i++) telemetry.record('test');
  assert.equal(telemetry.overflow, true); assert.equal(telemetry.records.length, LIMITS.telemetryRecords);
});
function ownershipFixture() {
  const root = {pid: 40, creationTimeFileTime: '12345678901234567', executableBasename: 'msedge.exe'};
  const child = {pid: 41, creationTimeFileTime: '12345678901234568', executableBasename: 'msedge.exe'};
  const ready = {type: 'ready', root, jobVerified: true, ownershipVerified: true, processes: [root, child]};
  const records = [ready, {type: 'root_exit', ...root, exitCode: 0}];
  const terminated = {cleanupVerified: true, ownershipVerified: true, activeProcessCount: 0, rootExited: true,
    rootExitCode: 0, errors: [], observedProcesses: [{...root, exitState: 'exited'}, {...child, exitState: 'exited'}]};
  return {ready, records, terminated};
}
test('ownership evidence requires matching creation identity and every observed process exited', () => {
  const valid = ownershipFixture();
  assert.equal(validateOwnershipEvidence(valid.ready, valid.records, valid.terminated).passed, true);
  for (const mutate of [
    f => { delete f.ready.root.creationTimeFileTime; },
    f => { f.ready.root.creationTimeFileTime = '0'; },
    f => { f.ready.root.creationTimeFileTime = 12345; },
    f => { f.records[1].pid++; },
    f => { f.records[1].creationTimeFileTime = '999'; },
    f => { f.terminated.observedProcesses[0].pid = 999; },
    f => { f.terminated.observedProcesses[0].creationTimeFileTime = '999'; },
    f => { f.terminated.observedProcesses[1].exitState = 'running'; },
    f => { f.terminated.observedProcesses[1].exitState = 'unknown'; },
    f => { f.terminated.observedProcesses.pop(); },
    f => { f.terminated.activeProcessCount = 1; },
    f => { f.terminated.rootExitCode = 137; },
    f => { f.records.push({type: 'error', error: 'identity query failed'}); },
    f => { f.records.push({type: 'inventory', processes: [{...f.ready.root, creationTimeFileTime: '999'}]}); },
  ]) {
    const f = ownershipFixture(); mutate(f);
    assert.equal(validateOwnershipEvidence(f.ready, f.records, f.terminated).passed, false);
  }
});
test('every browser uses owned suspended launcher with unchanged sandbox and software rendering', () => {
  const source = readFileSync(new URL('../scripts/traffic-harness-calibration.mjs', import.meta.url), 'utf8');
  const args = browserArguments(9376, 'C:/owned/profile');
  assert.ok(args.includes('--use-angle=swiftshader'));
  assert.ok(!args.some(a => /no-sandbox|disable.*sandbox|breakaway/i.test(a)));
  assert.ok(!source.includes('taskkill')); assert.ok(!source.includes("spawn(executable"));
  assert.ok(source.includes('new OwnedProcess(helper'));
  assert.ok(source.includes("await owner.event('root_exit'"));
  assert.ok(source.includes('result.afterRootExit.activeProcessCount >= 1'));
  assert.ok(source.includes('result.activeProcessCount, 0'));
  assert.ok(source.indexOf("saveJSON(resolve(directory, 'snapshot.json')") < source.indexOf("assert.equal(validation.passed"));
});
test('workflow is narrow push-only, read-only and retains all prior evidence links', () => {
  const workflow = readFileSync(new URL('../.github/workflows/traffic-harness-calibration.yml', import.meta.url), 'utf8');
  assert.match(workflow, /branches: \['diagnostic\/housing-harness-calibration'\]/);
  assert.ok(!workflow.includes('workflow_dispatch')); assert.ok(!workflow.includes('pull_request:'));
  assert.match(workflow, /contents: read/); assert.match(workflow, /persist-credentials: false/);
  assert.ok(!workflow.includes('npm ')); assert.ok(!workflow.includes('run: node scripts/traffic-game-paired-diagnostic'));
  for (const path of ['scripts/diagnostic-owned-process.ps1', 'tests/traffic-harness-calibration.test.mjs', 'scripts/diagnostic-max-evidence.mjs']) assert.ok(workflow.includes(path));
  const actions = [...workflow.matchAll(/uses: ([^\s]+)/g)].map(m => m[1]);
  assert.equal(actions.length, 3); assert.ok(actions.every(a => /@[a-f0-9]{40}$/.test(a)));
  assert.match(workflow, /if: always\(\)/); assert.match(workflow, /retention-days: 30/);
  const preflight = workflow.indexOf('name: Retain immutable fixed plan');
  assert.ok(preflight >= 0 && preflight < workflow.indexOf('name: Verify deterministic diagnostic contracts'));
  assert.ok(workflow.includes('harness-calibration-preflight-plan.json'));
  assert.ok(workflow.includes('Runtime not yet started; contract preflight has not succeeded'));
  assert.ok(workflow.includes("{flag:'wx'}"), 'Preflight manifest cannot overwrite prior evidence');
  assert.equal(PRIOR_RUNS.length, 3); assert.equal(new Set(PRIOR_RUNS.map(r => r.run)).size, 3);
});
