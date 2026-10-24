import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configFromEnv, createAdvisorServer, deriveData, validateInput, validateSelection, buildLocalReport, buildOperatorReport, UPSTREAM } from '../src/server.mjs';

const metric = (id, value, unit) => ({ id, value, unit, source: 'citymanager.aggregate.v1' });
const input = () => ({ schemaVersion: 1, locale: 'th', snapshot: {
  tick: 20, window: { startTick: 10, endTick: 20 },
  metrics: [metric('treasury', -20, 'currency'), metric('population', 120, 'people'), metric('housingCapacity', 100, 'people'), metric('incomePerTick', 2, 'currency/tick'), metric('expensesPerTick', 4, 'currency/tick')],
  prior: { tick: 10, metrics: [metric('treasury', 10, 'currency'), metric('population', 100, 'people')] },
} });
const base = () => configFromEnv({});
async function withServer(config, deps, run) {
  const server = createAdvisorServer(config, deps);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (url, body = input(), extra = {}) => fetch(`${url}/api/city-advisor/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nustanakritwithai.github.io', ...(extra.headers || {}) }, body: JSON.stringify(body), ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'headers')) });

test('provider is disabled by default and enabling requires only the server credential', () => {
  assert.equal(configFromEnv({}).upstreamEnabled, false);
  assert.equal(configFromEnv({}).port, 8791);
  assert.throws(() => configFromEnv({ CITY_ADVISOR_ENABLE_UPSTREAM: 'true' }));
  assert.equal(configFromEnv({ CITY_ADVISOR_ENABLE_UPSTREAM: 'true', TYPHOON_API_KEY: 'non-deployable-test-placeholder' }).upstreamEnabled, true);
  assert.throws(() => configFromEnv({ CITY_ADVISOR_PORT: '80' }));
});
test('known aggregates derive exact comparisons, flags, provenance and missing data', () => {
  const data = deriveData(validateInput(input()));
  assert.equal(data.signals.find(x => x.id === 'trend.treasury').delta, -30);
  assert.deepEqual(data.signals.find(x => x.id === 'trend.population').window, { startTick: 10, endTick: 20 });
  assert.equal(data.signals.find(x => x.id === 'threshold.net-flow-negative').value, -2);
  assert.equal(data.signals.find(x => x.id === 'threshold.housing-capacity-exceeded').conditionMet, true);
  assert.equal(data.provenance.trust, 'client_reported_unverified');
  assert(data.missingData.some(x => x.id === 'missing.current.pollution'));
  assert(!data.metrics.some(x => x.id === 'pollution'));
});
test('offline operator harness and pure report work with no authentication or provider setup', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/offline.mjs', import.meta.url)), fileURLToPath(new URL('../examples/request.json', import.meta.url))], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, buildLocalReport(input()));
  assert.equal(report.mode, 'fallback');
  assert.equal(result.stderr, '');
});
test('supervised operator export is disabled by default and shares fixed-provider validation when explicitly enabled', async () => {
  let calls = 0;
  const fakeFetch = async (url, opts) => {
    calls++;
    assert.equal(url, UPSTREAM);
    assert.equal(opts.redirect, 'error');
    assert.equal(JSON.parse(opts.body).max_tokens, 500);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summarySignalIds: ['trend.treasury'], groups: [{ category: 'economy', signalIds: ['trend.treasury'] }] }) } }] }));
  };
  assert.equal((await buildOperatorReport(input(), { fetchImpl: fakeFetch })).mode, 'fallback');
  assert.equal(calls, 0);
  await assert.rejects(buildOperatorReport(input(), { upstreamEnabled: true }));
  await assert.rejects(buildOperatorReport(input(), { maxTokens: 1201 }));
  const report = await buildOperatorReport(input(), { upstreamEnabled: true, apiKey: 'non-deployable-test-placeholder', maxTokens: 500, fetchImpl: fakeFetch });
  assert.equal(report.mode, 'ai');
  assert.equal(calls, 1);
  assert.deepEqual(report.report.summarySignalIds, ['trend.treasury']);
});
test('unknown entity data, units, duplicate metrics and invalid windows are rejected', () => {
  const changed = fn => { const x = input(); fn(x); assert.throws(() => validateInput(x), /invalid_snapshot/); };
  changed(x => { x.snapshot.households = [{ name: 'resident' }]; });
  changed(x => { x.snapshot.metrics[0].unit = 'USD'; });
  changed(x => x.snapshot.metrics.push(x.snapshot.metrics[0]));
  changed(x => { x.snapshot.window.endTick = 21; });
  changed(x => { x.snapshot.prior.tick = 20; });
  changed(x => { x.snapshot.metrics[1].value = -1; });
  changed(x => { x.question = 'Please mutate accounts'; });
  changed(x => { x.snapshot.metrics[0].id = ['treasury']; });
  changed(x => { x.snapshot.metrics[0].id = { toString: 'treasury' }; });
});
test('model cannot invent references, severity, text, causal claims or categories', () => {
  const data = deriveData(validateInput(input()));
  const valid = { summarySignalIds: ['trend.treasury'], groups: [{ category: 'economy', signalIds: ['trend.treasury'] }] };
  assert.deepEqual(validateSelection(valid, data), valid);
  for (const changed of [
    { ...valid, severity: 'high' }, { ...valid, text: 'Invented claim' },
    { ...valid, summarySignalIds: ['signal.not.real'] },
    { ...valid, groups: [{ category: 'environment', signalIds: ['trend.treasury'] }] },
  ]) assert.throws(() => validateSelection(changed, data));
});
test('public default route needs no login, token or configured identity provider', async () => {
  let calls = 0;
  await withServer(base(), { fetchImpl: async () => { calls++; throw new Error('must not call'); } }, async url => {
    const res = await post(url);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mode, 'fallback');
    assert.equal(calls, 0);
    const health = await fetch(url + '/healthz');
    assert.deepEqual(await health.json(), { ok: true, upstreamEnabled: false });
  });
});
test('disabled provider yields grounded Thai fallback and no upstream call', async () => {
  let calls = 0;
  await withServer(base(), { fetchImpl: async () => { calls++; throw new Error('must not call'); } }, async url => {
    const res = await post(url);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.mode, 'fallback');
    assert.deepEqual(body.report.hypotheses, []);
    assert.match(body.report.observations[0].text, /ผลต่าง/);
    assert.equal(body.snapshotTick, 20);
    assert.equal(calls, 0);
  });
});
test('public wildcard CORS, content type, oversized input, method and route restrictions', async () => {
  await withServer(base(), {}, async url => {
    assert.equal((await post(url, input(), { headers: { Origin: 'https://any-public-site.example' } })).status, 200);
    assert.equal((await post(url, input(), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await post(url, { text: 'x'.repeat(17_000) })).status, 413);
    assert.equal((await fetch(`${url}/api/city-advisor/report`)).status, 405);
    assert.equal((await fetch(`${url}/anything`)).status, 404);
    const preflight = await fetch(`${url}/api/city-advisor/report`, { method: 'OPTIONS', headers: { Origin: 'https://any-public-site.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), null);
  });
});
test('oversized chunked bodies receive 413 without storing an unbounded body', async () => {
  await withServer(base(), {}, async url => {
    const status = await new Promise((resolve, reject) => {
      const request = http.request(`${url}/api/city-advisor/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      request.on('error', reject);
      request.write('x'.repeat(9000));
      request.end('x'.repeat(9000));
    });
    assert.equal(status, 413);
  });
});
test('enabled mock provider receives fixed destination, bounded parameters and server-only credential', async () => {
  const config = { ...base(), upstreamEnabled: true, apiKey: 'non-deployable-test-placeholder' };
  let calls = 0;
  const fakeFetch = async (url, opts) => {
    calls++;
    assert.equal(url, UPSTREAM);
    assert.equal(opts.redirect, 'error');
    assert.equal(opts.headers.Authorization, `Bearer ${config.apiKey}`);
    const body = JSON.parse(opts.body);
    assert.equal(body.max_tokens, 1200);
    assert.equal(body.stream, false);
    assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summarySignalIds: ['trend.treasury'], groups: [{ category: 'economy', signalIds: ['trend.treasury'] }] }) } }] }));
  };
  await withServer(config, { fetchImpl: fakeFetch }, async url => {
    const res = await post(url);
    const text = await res.text();
    assert.equal(JSON.parse(text).mode, 'ai');
    assert(!text.includes(config.apiKey));
    assert.equal(calls, 1);
  });
});
test('invalid provider claims and provider errors become deterministic fallback without errors or retries', async () => {
  for (const response of [() => new Response(JSON.stringify({ choices: [{ message: { content: '{"summarySignalIds":["invented"],"groups":[]}' } }] })), () => new Response('sensitive provider error detail', { status: 500 }), () => new Response('provider quota details', { status: 429 })]) {
    let calls = 0;
    await withServer({ ...base(), upstreamEnabled: true, apiKey: 'non-deployable-test-placeholder' }, { fetchImpl: async () => { calls++; return response(); } }, async url => {
      const res = await post(url);
      const text = await res.text();
      assert.equal(JSON.parse(text).mode, 'fallback');
      assert(!text.includes('sensitive provider error detail'));
      assert.equal(calls, 1);
    });
  }
});
test('public requests have no custom per-user, global or ingress usage quotas', async () => {
  let calls = 0;
  await withServer({ ...base(), upstreamEnabled: true, apiKey: 'non-deployable-test-placeholder', model: 'ignored-unapproved-model' }, { fetchImpl: async (url, opts) => {
    calls++;
    assert.equal(JSON.parse(opts.body).model, 'typhoon-v2.5-30b-a3b-instruct');
    throw new Error('mock provider failure');
  } }, async url => {
    for (let i = 0; i < 35; i++) assert.equal((await post(url)).status, 200);
    assert.equal(calls, 35);
  });
});
test('public provider work has no custom one-request concurrency gate', async () => {
  const releases = [];
  let bothStarted;
  const started = new Promise(resolve => { bothStarted = resolve; });
  const deps = { fetchImpl: async () => new Promise(resolve => {
    releases.push(() => resolve(new Response('mock provider failure', { status: 500 })));
    if (releases.length === 2) bothStarted();
  }) };
  await withServer({ ...base(), upstreamEnabled: true, apiKey: 'non-deployable-test-placeholder' }, deps, async url => {
    const first = post(url);
    const second = post(url);
    await started;
    releases.forEach(release => release());
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
  });
});
