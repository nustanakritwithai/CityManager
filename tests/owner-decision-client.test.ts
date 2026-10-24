import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step } from '../src/sim.ts';
import { captureOwnerSnapshot } from '../src/owner-decision.ts';
import { buildOwnerDecisionResponse } from '../server/city-advisor/src/owner-contract.mjs';
import type { OwnerDecisionRequest, OwnerDecisionResponse } from '../server/city-advisor/src/owner-contract.mjs';
import { ownerDecisionConnectionReady, requestOwnerDecision, validOwnerDecisionEndpoint } from '../src/owner-decision-client.ts';

const endpoint = 'https://advisor.example/api/city-advisor/report';
const connection = () => ({ enabled: true, endpoint });
const fixture = () => {
  const city = createCity(61025);
  for (let day = 0; day < 30; day++) step(city);
  const firm = city.firms.find(f => f.commercialKind === 'market');
  assert(firm);
  const snapshot = captureOwnerSnapshot(city, firm.id);
  assert(snapshot);
  const request: OwnerDecisionRequest = { schemaVersion: 3, operation: 'owner-decision', locale: 'th', snapshot };
  return { city, firm, snapshot, request };
};
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const ai = (request: OwnerDecisionRequest, candidateId: 'hold' | 'safe-transfer' = 'hold') => buildOwnerDecisionResponse(request, { candidateId }, 'ai');
const fallback = (request: OwnerDecisionRequest) => buildOwnerDecisionResponse(request, { candidateId: 'safe-transfer' }, 'fallback');

test('owner decision connection remains explicit and validates only the HTTPS report path', async () => {
  const { snapshot } = fixture(); let calls = 0;
  const neverFetch = (async () => { calls++; throw new Error(); }) as typeof fetch;
  assert.equal(ownerDecisionConnectionReady(), false);
  assert.equal(ownerDecisionConnectionReady(connection()), true);
  for (const url of ['http://advisor.example/api/city-advisor/report', `${endpoint}?key=x`, `${endpoint}#token`, 'https://user:password@advisor.example/api/city-advisor/report', 'https://api.opentyphoon.ai/v1/chat/completions', `${endpoint}/`]) assert.equal(validOwnerDecisionEndpoint(url), false);
  assert.equal((await requestOwnerDecision(snapshot, undefined, neverFetch)).reason, 'not_configured');
  assert.equal((await requestOwnerDecision(snapshot, { enabled: false, endpoint }, neverFetch)).transport, 'offline');
  assert.equal((await requestOwnerDecision(snapshot, { enabled: true, endpoint: `${endpoint}?key=x` }, neverFetch)).reason, 'invalid_endpoint');
  assert.equal(calls, 0);
});

test('one explicit request sends only the bounded owner snapshot without browser credentials and accepts an allowed selection', async () => {
  const { snapshot, request } = fixture(), before = structuredClone(request); let calls = 0;
  const result = await requestOwnerDecision(snapshot, connection(), (async (url, options) => {
    calls++; assert.equal(url, endpoint); assert.equal(options?.method, 'POST');
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error');
    assert.equal(options?.cache, 'no-store'); assert.equal(options?.referrerPolicy, 'no-referrer');
    assert.deepEqual(options?.headers, { 'Content-Type': 'application/json' }); assert(options?.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(String(options?.body)), request);
    assert(!String(options?.body).includes('TYPHOON_API_KEY'));
    assert.equal((options?.headers as Record<string, string>).Authorization, undefined);
    return json(ai(request, 'hold'));
  }) as typeof fetch);
  assert.equal(calls, 1); assert.equal(result.transport, 'remote');
  assert.equal(result.response?.mode, 'ai'); assert.deepEqual(result.response?.snapshot, snapshot);
  assert.equal(result.response?.selection.candidateId, 'hold'); assert.deepEqual(request, before);
});

test('provider fallback is deterministic and no arbitrary prose, candidate or altered snapshot is accepted', async () => {
  const { snapshot, request } = fixture();
  const knownFallback = buildOwnerDecisionResponse(request, { candidateId: 'safe-transfer' }, 'fallback');
  const altered = structuredClone(knownFallback); altered.snapshot = { ...altered.snapshot, tick: altered.snapshot.tick + 1 };
  const invalidCandidate = { ...knownFallback, selection: { candidateId: 'new-command' } };
  const prose = { ...ai(request), text: 'Invented explanation' };
  const outputs = [json(knownFallback), json(altered), json(invalidCandidate), json(prose), new Response('x'.repeat(32769), { headers: { 'Content-Type': 'application/json' } }), new Response('not JSON', { headers: { 'Content-Type': 'application/json' } }), new Response(JSON.stringify(ai(request)), { status: 503, headers: { 'Content-Type': 'application/json' } })];
  for (let i = 0; i < outputs.length; i++) {
    const result = await requestOwnerDecision(snapshot, connection(), (async () => outputs[i]) as typeof fetch);
    assert.equal(result.transport, 'fallback'); assert.equal(result.response?.mode, 'fallback');
    assert.equal(result.response?.selection.candidateId, 'safe-transfer');
    assert(!JSON.stringify(result).includes('Invented explanation'));
  }
  const wrongFallback = buildOwnerDecisionResponse(request, { candidateId: 'hold' }, 'fallback');
  const result = await requestOwnerDecision(snapshot, connection(), (async () => json(wrongFallback)) as typeof fetch);
  assert.equal(result.transport, 'fallback'); assert.equal(result.response?.selection.candidateId, 'safe-transfer');
});

test('invalid request, network failure, cancellation and deadline retain a local fallback without retry', async context => {
  const { snapshot } = fixture(); let calls = 0;
  const invalid = structuredClone(snapshot); invalid.snapshotHash = 'forged';
  const noRequest = await requestOwnerDecision(invalid, connection(), (async () => { calls++; throw new Error(); }) as typeof fetch);
  assert.equal(noRequest.reason, 'invalid_request'); assert.equal(noRequest.response, null); assert.equal(calls, 0);

  const network = await requestOwnerDecision(snapshot, connection(), (async () => { calls++; throw new Error('private upstream detail'); }) as typeof fetch);
  assert.equal(network.reason, 'network_or_response'); assert.equal(network.transport, 'fallback'); assert(!JSON.stringify(network).includes('private upstream detail'));

  const controller = new AbortController();
  const pending = requestOwnerDecision(snapshot, connection(), (async () => { calls++; return new Promise<Response>(() => {}); }) as typeof fetch, controller.signal);
  controller.abort(); assert.equal((await pending).reason, 'cancelled');

  const deadline = new AbortController();
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { assert.equal(milliseconds, 20_000); return deadline.signal; });
  const timed = requestOwnerDecision(snapshot, connection(), (async () => { calls++; return new Promise<Response>(() => {}); }) as typeof fetch);
  deadline.abort(); const result = await timed;
  assert.equal(result.reason, 'timeout'); assert.equal(result.response?.mode, 'fallback');
  assert.equal(calls, 3);
});
