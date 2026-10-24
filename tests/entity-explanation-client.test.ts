import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEntitySnapshot, buildLocalEntityExplanation, buildEntityReport, entityExplanationCandidates } from '../server/city-advisor/src/entity-contract.mjs';
import type { EntityRequest, EntityResponse } from '../server/city-advisor/src/entity-contract.mjs';
import { requestEntityExplanation, entityConnectionReady, validEntityEndpoint } from '../src/entity-explanation-client.ts';

const endpoint = 'https://advisor.example/api/city-advisor/report';
const connection = () => ({ enabled: true, endpoint });
const fixture = () => {
  const snapshot = makeEntitySnapshot({ schemaVersion: 1,
    entity: { kind: 'household', id: 7, householdId: 7, buildingId: 3, firmId: null, cell: 31 },
    tick: 90, window: { fromTick: 61, toTick: 90, inclusive: true, maxDays: 30, empty: false },
    facts: [
      { id: 'cash.current', value: 25000, unit: 'satang', period: 'snapshot' },
      { id: 'workforce.members', value: 3, unit: 'people', period: 'snapshot' },
      { id: 'workforce.employed', value: 2, unit: 'people', period: 'snapshot' },
    ], missing: [{ id: 'price.goodsBuy', reason: 'ambiguous' }],
  });
  const request: EntityRequest = { schemaVersion: 2, operation: 'entity-explanation', locale: 'th', snapshot };
  return { request, local: buildLocalEntityExplanation(snapshot) };
};
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const ai = (local: EntityResponse) => buildEntityReport(local.snapshot, local.report, 'ai');

test('entity transport stays disabled unless explicitly enabled and the exact HTTPS route is valid', async () => {
  const { request, local } = fixture(); let calls = 0;
  const neverFetch = (async () => { calls++; throw new Error(); }) as typeof fetch;
  assert.equal(entityConnectionReady(), false); assert.equal(entityConnectionReady({ enabled: false, endpoint }), false);
  assert.equal(entityConnectionReady(connection()), true);
  assert.equal((await requestEntityExplanation(request, local, undefined, neverFetch)).reason, 'not_configured');
  assert.equal((await requestEntityExplanation(request, local, { enabled: false, endpoint }, neverFetch)).transport, 'offline');
  for (const url of ['http://advisor.example/api/city-advisor/report', `${endpoint}?key=x`, `${endpoint}#token`, 'https://user:password@advisor.example/api/city-advisor/report', 'https://api.opentyphoon.ai/v1/chat/completions', `${endpoint}/`]) assert.equal(validEntityEndpoint(url), false);
  assert.equal((await requestEntityExplanation(request, local, { enabled: true, endpoint: `${endpoint}?key=x` }, neverFetch)).reason, 'invalid_endpoint');
  assert.equal(calls, 0);
});

test('the browser sends only a validated entity request, without credentials, and accepts referenced selections', async () => {
  const { request, local } = fixture(), before = structuredClone(request); let calls = 0;
  const result = await requestEntityExplanation(request, local, connection(), (async (url, options) => {
    calls++; assert.equal(url, endpoint); assert.equal(options?.method, 'POST');
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store'); assert.equal(options?.referrerPolicy, 'no-referrer');
    assert.deepEqual(options?.headers, { 'Content-Type': 'application/json' }); assert(options?.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(String(options?.body)), request);
    assert(!String(options?.body).includes('TYPHOON_API_KEY')); assert.equal((options?.headers as Record<string, string>).Authorization, undefined);
    return json(ai(local));
  }) as typeof fetch);
  assert.equal(calls, 1); assert.equal(result.transport, 'remote'); assert.equal(result.report.mode, 'ai');
  assert.deepEqual(result.report.snapshot, request.snapshot); assert.deepEqual(request, before);
  const candidates = entityExplanationCandidates(result.report.snapshot);
  assert(result.report.report.observationIds.every(id => candidates.observations.some(row => row.id === id)));
});

test('full saves, extra fields and a request/local snapshot mismatch cannot be transmitted', async () => {
  const { request, local } = fixture(); let calls = 0;
  const invalid = structuredClone(request) as EntityRequest & { save?: unknown };
  invalid.save = { accounts: { treasury: 1000 } };
  const other = fixture(); other.request.snapshot = makeEntitySnapshot({ ...other.request.snapshot, tick: 91, window: { fromTick: 62, toTick: 91, inclusive: true, maxDays: 30, empty: false } });
  const neverFetch = (async () => { calls++; throw new Error(); }) as typeof fetch;
  assert.equal((await requestEntityExplanation(invalid, local, connection(), neverFetch)).reason, 'invalid_request');
  assert.equal((await requestEntityExplanation(other.request, local, connection(), neverFetch)).reason, 'invalid_request');
  assert.equal(calls, 0);
});

test('wrong entity/time/facts, invented evidence and provider prose preserve the local fallback', async () => {
  const { request, local } = fixture();
  const wrongEntity = ai(local); wrongEntity.snapshot = makeEntitySnapshot({ ...wrongEntity.snapshot, entity: { ...wrongEntity.snapshot.entity, id: 8, householdId: 8 } });
  const wrongValue = ai(local); wrongValue.snapshot = makeEntitySnapshot({ ...wrongValue.snapshot, facts: wrongValue.snapshot.facts.map(row => row.id === 'cash.current' ? { ...row, value: row.value + 1 } : row) });
  const forged = ai(local); forged.report.observationIds = ['observed.invented'];
  const prose = { ...ai(local), text: 'Invented cause' };
  const cases = [json(wrongEntity), json(wrongValue), json(forged), json(prose), new Response('x'.repeat(65537), { headers: { 'Content-Type': 'application/json' } }), new Response('not JSON', { headers: { 'Content-Type': 'application/json' } }), new Response(JSON.stringify(ai(local)))];
  let calls = 0;
  for (const response of cases) {
    const result = await requestEntityExplanation(request, local, connection(), (async () => { calls++; return response; }) as typeof fetch);
    assert.equal(result.transport, 'fallback'); assert.equal(result.report, local);
  }
  assert.equal(calls, cases.length);
});

test('network/HTTP failure and a valid provider fallback retain evidence without retry or sensitive errors', async () => {
  const { request, local } = fixture(); let calls = 0;
  const cases = [async () => new Response('private detail', { status: 503 }), async () => { throw new Error('private detail'); }];
  for (const run of cases) {
    const result = await requestEntityExplanation(request, local, connection(), (async () => { calls++; return run(); }) as typeof fetch);
    assert.equal(result.transport, 'fallback'); assert.equal(result.report, local); assert(!JSON.stringify(result).includes('private detail'));
  }
  const result = await requestEntityExplanation(request, local, connection(), (async () => { calls++; return json(local); }) as typeof fetch);
  assert.equal(result.reason, 'provider_fallback'); assert.equal(result.transport, 'remote'); assert.deepEqual(result.report, local);
  assert.equal(calls, 3);
});

test('cancellation and deadline are distinguished and each stop a hung request without automatic retry', async context => {
  const { request, local } = fixture(); let calls = 0;
  const controller = new AbortController();
  const pending = requestEntityExplanation(request, local, connection(), (async () => { calls++; return new Promise<Response>(() => {}); }) as typeof fetch, controller.signal);
  controller.abort(); assert.equal((await pending).reason, 'cancelled');
  const deadline = new AbortController();
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { assert.equal(milliseconds, 20000); return deadline.signal; });
  const timed = requestEntityExplanation(request, local, connection(), (async () => { calls++; return new Promise<Response>(() => {}); }) as typeof fetch);
  deadline.abort(); const result = await timed;
  assert.equal(result.reason, 'timeout'); assert.equal(result.report, local); assert.equal(calls, 2);
});
