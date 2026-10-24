import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeEntitySnapshot, buildLocalEntityExplanation, entityExplanationCandidates, acceptEntityExplanation } from '../src/entity-contract.mjs';
import { buildEntityReport, entityProviderInput, ENTITY_UPSTREAM, ENTITY_MODEL } from '../src/entity-report.mjs';
import { createAdvisorServer, configFromEnv } from '../src/server.mjs';

const fixture = () => {
  const snapshot = makeEntitySnapshot({
    schemaVersion: 1, entity: { kind: 'factory', id: 117355, buildingId: 117355, firmId: 991033, householdId: null, cell: 42 },
    tick: 90, window: { fromTick: 61, toTick: 90, inclusive: true, maxDays: 30, empty: false },
    facts: [
      { id: 'cash.current', value: 15000, unit: 'satang', period: 'snapshot' },
      { id: 'cash.inflow', value: 10000, unit: 'satang', period: 'window' },
      { id: 'cash.outflow', value: 12000, unit: 'satang', period: 'window' },
      { id: 'cash.net', value: -2000, unit: 'satang', period: 'window' },
      { id: 'workforce.employed', value: 0, unit: 'people', period: 'snapshot' },
      { id: 'stocks.goods', value: 0, unit: 'goods', period: 'snapshot' },
      { id: 'access.connected', value: 0, unit: 'boolean', period: 'snapshot' },
    ],
    missing: [{ id: 'price.goodsSell', reason: 'unavailable' }],
  });
  return { schemaVersion: 2, operation: 'entity-explanation', locale: 'th', snapshot };
};
const selection = snapshot => {
  const c = entityExplanationCandidates(snapshot);
  return { observationIds: c.observations.slice(0, 3).map(row => row.id), hypothesisIds: c.hypotheses.slice(0, 2).map(row => row.id), checkIds: c.checks.slice(0, 3).map(row => row.id) };
};
const upstream = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
const upstreamContent = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const enabled = extra => ({ entityEnabled: true, upstreamEnabled: true, apiKey: 'non-deployable-entity-test-placeholder', ...extra });
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };

test('new entity provider operation is independently disabled without making a request', async () => {
  let calls = 0;
  await assert.rejects(buildEntityReport(fixture(), { upstreamEnabled: true, apiKey: 'non-deployable-test-placeholder', fetchImpl: async () => { calls++; } }), error => error.status === 503 && error.code === 'entity_explanation_disabled');
  assert.equal(calls, 0);
  assert.equal(configFromEnv({ CITY_ADVISOR_ENABLE_UPSTREAM: 'true', TYPHOON_API_KEY: 'non-deployable-test-placeholder' }).entityEnabled, false);
});

test('explicit entity enablement with provider disabled returns the deterministic local response unchanged', async () => {
  const input = freeze(fixture()), before = JSON.stringify(input); let calls = 0;
  const result = await buildEntityReport(input, { entityEnabled: true, fetchImpl: async () => { calls++; } });
  assert.deepEqual(result, buildLocalEntityExplanation(input.snapshot)); assert.equal(result.mode, 'fallback');
  assert.equal(calls, 0); assert.equal(JSON.stringify(input), before);
});

test('the fixed provider receives a minimal grounded catalog and never local identity, full save or request key', async () => {
  const input = freeze(fixture()), before = JSON.stringify(input); let calls = 0;
  const result = await buildEntityReport(input, enabled({ fetchImpl: async (url, options) => {
    calls++; assert.equal(url, ENTITY_UPSTREAM); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer non-deployable-entity-test-placeholder'); assert(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.equal(body.model, ENTITY_MODEL); assert.equal(body.max_tokens, 900); assert.equal(body.temperature, 0); assert.equal(body.stream, false); assert.equal(body.tools, undefined);
    assert.equal(body.response_format, undefined);
    const payload = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(payload), ['kind', 'tick', 'window', 'facts', 'missing', 'candidates']);
    assert.deepEqual(payload, entityProviderInput(input.snapshot));
    assert(!body.messages[1].content.includes('117355')); assert(!body.messages[1].content.includes('991033'));
    for (const key of ['entity', 'snapshotKey', 'accounts', 'ledger', 'households', 'firms', 'wallet', 'buildingId', 'householdId']) assert.equal(payload[key], undefined);
    return upstream(selection(input.snapshot));
  } }));
  assert.equal(calls, 1); assert.equal(result.mode, 'ai'); assert(acceptEntityExplanation(result, buildLocalEntityExplanation(input.snapshot)));
  assert.equal(JSON.stringify(input), before); assert(!JSON.stringify(result).includes('non-deployable-entity-test-placeholder'));
});

test('a single whole-response json or plain fence retains the validated AI selection', async () => {
  const input = fixture(), valid = selection(input.snapshot), original = JSON.stringify(input);
  let calls = 0;
  for (const content of [
    `\n\t\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n`,
    `\`\`\`\r\n${JSON.stringify(valid, null, 2)}\r\n\`\`\``,
  ]) {
    const result = await buildEntityReport(input, enabled({ fetchImpl: async () => { calls++; return upstreamContent(content); } }));
    assert.equal(result.mode, 'ai'); assert.deepEqual(result.report, valid);
    assert(acceptEntityExplanation(result, buildLocalEntityExplanation(input.snapshot)));
  }
  assert.equal(calls, 2); assert.equal(JSON.stringify(input), original);
});

test('fenced output never permits prose, unsupported IDs, extra keys or missing eligible selections', async () => {
  const input = fixture(), valid = selection(input.snapshot), local = buildLocalEntityExplanation(input.snapshot);
  const fenced = value => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
  const variants = [
    `Explanation:\n${fenced(valid)}`,
    `${fenced(valid)}\nAdditional advice`,
    `${fenced(valid)}\n${fenced(valid)}`,
    fenced({ ...valid, observationIds: ['observed.invented'] }),
    fenced({ ...valid, observationIds: ['cash.current'] }),
    fenced({ ...valid, hypothesisIds: ['invented.cause'] }),
    fenced({ ...valid, checkIds: ['invented.check'] }),
    fenced({ ...valid, explanation: 'Unverified causal narrative' }),
    fenced({ ...valid, observationIds: [] }),
    fenced({ ...valid, checkIds: [] }),
    `\`\`\`javascript\n${JSON.stringify(valid)}\n\`\`\``,
  ];
  let calls = 0;
  for (const content of variants) {
    const result = await buildEntityReport(input, enabled({ fetchImpl: async () => { calls++; return upstreamContent(content); } }));
    assert.deepEqual(result, local);
  }
  assert.equal(calls, variants.length);
});

test('insufficient evidence stays local without a paid/provider attempt', async () => {
  const input = fixture(); input.snapshot = makeEntitySnapshot({ ...input.snapshot, facts: [], missing: [{ id: 'cash.current', reason: 'unavailable' }] });
  let calls = 0;
  const result = await buildEntityReport(input, enabled({ fetchImpl: async () => { calls++; } }));
  assert.equal(result.mode, 'fallback'); assert.equal(calls, 0); assert.deepEqual(result.snapshot.facts, []);
  assert(result.report.checkIds.includes('check.missing'));
});

test('invented references, causal prose and provider errors retain local data with no retry', async () => {
  const input = fixture(), local = buildLocalEntityExplanation(input.snapshot), valid = selection(input.snapshot);
  const variants = [
    async () => upstream({ ...valid, observationIds: ['observed.invented'] }),
    async () => upstream({ ...valid, text: 'The factory caused a crash', severity: 100 }),
    async () => new Response('private provider detail', { status: 429 }),
    async () => { throw new Error('private provider detail'); },
    async () => new Response('x'.repeat(32769)),
    async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not JSON' } }] })),
  ];
  let calls = 0;
  for (const make of variants) {
    const result = await buildEntityReport(input, enabled({ fetchImpl: async () => { calls++; return make(); } }));
    assert.deepEqual(result, local); assert(!JSON.stringify(result).includes('private provider detail'));
  }
  assert.equal(calls, variants.length);
});

test('provider deadline and explicit cancellation stop a hung mock without additional calls', async context => {
  const deadline = new AbortController(); let calls = 0;
  context.mock.method(AbortSignal, 'timeout', milliseconds => { assert.equal(milliseconds, 15000); return deadline.signal; });
  const input = fixture(), local = buildLocalEntityExplanation(input.snapshot);
  const pending = buildEntityReport(input, enabled({ fetchImpl: async () => { calls++; return new Promise(() => {}); } }));
  deadline.abort(); assert.deepEqual(await pending, local); assert.equal(calls, 1);
  const cancellation = new AbortController(); cancellation.abort();
  assert.deepEqual(await buildEntityReport(input, enabled({ signal: cancellation.signal, fetchImpl: async () => { calls++; } })), local);
  assert.equal(calls, 1);
});

async function withServer(config, deps, run) {
  const server = createAdvisorServer(config, deps);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (url, body) => fetch(`${url}/api/city-advisor/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('existing HTTP report route gates entity v2 independently and preserves safe local/error responses', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('must not call'); };
  await withServer(configFromEnv({}), { fetchImpl }, async url => {
    const response = await post(url, fixture()); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'entity_explanation_disabled' });
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const city = await post(url, { schemaVersion: 1, locale: 'th', snapshot: { tick: 1, window: { startTick: 1, endTick: 1 }, metrics: [{ id: 'treasury', value: 100, unit: 'currency', source: 'citymanager.aggregate.v1' }] } });
    assert.equal(city.status, 200); assert.equal((await city.json()).schemaVersion, 1);
  });
  await withServer({ ...configFromEnv({}), entityEnabled: true }, { fetchImpl }, async url => {
    const response = await post(url, fixture()); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), buildLocalEntityExplanation(fixture().snapshot));
    const bad = fixture(); bad.snapshot.entity.id++;
    const invalid = await post(url, bad); assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'invalid_entity_snapshot' });
  });
  assert.equal(calls, 0);
});

test('disconnecting the HTTP caller aborts the in-flight mocked provider request', async () => {
  let began;
  const started = new Promise(resolve => { began = resolve; });
  let stopped;
  const aborted = new Promise(resolve => { stopped = resolve; });
  await withServer({ ...configFromEnv({}), entityEnabled: true, upstreamEnabled: true, apiKey: 'non-deployable-test-placeholder' }, {
    fetchImpl: async (_url, options) => {
      began();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => { stopped(); reject(new Error('caller stopped')); }, { once: true });
      });
    },
  }, async url => {
    const request = http.request(`${url}/api/city-advisor/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    request.on('error', () => {}); request.end(JSON.stringify(fixture()));
    await started; request.destroy();
    await Promise.race([aborted, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Provider did not abort')), 1500))]);
  });
});
