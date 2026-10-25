import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step } from '../../../src/sim.ts';
import { captureOwnerSnapshot } from '../../../src/owner-decision.ts';
import { buildOwnerDecisionReport } from '../src/owner-report.mjs';
import { configFromEnv, createAdvisorServer } from '../src/server.mjs';
import { ENTITY_MODEL, ENTITY_UPSTREAM } from '../src/entity-report.mjs';

const fixture = () => {
  const city = createCity(61025);
  for (let day = 0; day < 30; day++) step(city);
  const firm = city.firms.find(row => row.commercialKind === 'market');
  assert(firm);
  const snapshot = captureOwnerSnapshot(city, firm.id);
  assert(snapshot);
  return { schemaVersion: 3, operation: 'owner-decision', locale: 'th', snapshot };
};
const input = fixture();
const output = candidateId => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ candidateId }) } }] }), { headers: { 'Content-Type': 'application/json' } });
const enabled = extra => ({ ownerDecisionEnabled: true, upstreamEnabled: true, apiKey: 'non-deployable-owner-test-placeholder', ...extra });

test('owner decision API remains disabled by default and does not call the provider', async () => {
  let calls = 0;
  assert.equal(configFromEnv({ CITY_ADVISOR_ENABLE_UPSTREAM: 'true', TYPHOON_API_KEY: 'non-deployable-test-placeholder' }).ownerDecisionEnabled, false);
  await assert.rejects(buildOwnerDecisionReport(input, { upstreamEnabled: true, apiKey: 'non-deployable-test-placeholder', fetchImpl: async () => { calls++; } }), error => error.status === 503 && error.code === 'owner_decisions_disabled');
  assert.equal(calls, 0);
});

test('enabled owner operation returns the deterministic candidate when upstream is disabled', async () => {
  let calls = 0;
  const result = await buildOwnerDecisionReport(input, { ownerDecisionEnabled: true, fetchImpl: async () => { calls++; } });
  assert.equal(result.schemaVersion, 3); assert.equal(result.operation, 'owner-decision');
  assert.equal(result.mode, 'fallback'); assert.equal(result.snapshot.snapshotHash, input.snapshot.snapshotHash);
  assert.equal(result.selection.candidateId, 'safe-transfer'); assert.equal(calls, 0);
});

test('upstream receives bounded amount candidates and can return only one of them', async () => {
  let calls = 0;
  const result = await buildOwnerDecisionReport(input, enabled({ fetchImpl: async (url, options) => {
    calls++; assert.equal(url, ENTITY_UPSTREAM);
    const body = JSON.parse(options.body);
    assert.equal(body.model, ENTITY_MODEL); assert.equal(body.max_tokens, 80); assert.equal(body.temperature, 0);
    assert.equal(options.headers.Authorization, 'Bearer non-deployable-owner-test-placeholder');
    const providerInput = JSON.parse(body.messages[1].content);
    assert.equal(providerInput.tick, input.snapshot.tick); assert.deepEqual(providerInput.facts, input.snapshot.facts);
    assert(providerInput.facts.withdrawAvailable > 10_000); assert.equal(providerInput.facts.safeWithdraw, 10_000, 'candidate amounts honor the existing transfer ceiling');
    assert.equal('actorId' in providerInput, false); assert.equal('firmId' in providerInput, false);
    assert.equal('stateHash' in providerInput, false); assert.equal('snapshotHash' in providerInput, false);
    assert.deepEqual(providerInput.candidates, [
      { id: 'hold', action: 'hold', amountSatang: 0 },
      { id: 'safe-transfer-quarter', action: 'withdrawOwnerProfit', amountSatang: 2500 },
      { id: 'safe-transfer-half', action: 'withdrawOwnerProfit', amountSatang: 5000 },
      { id: 'safe-transfer', action: 'withdrawOwnerProfit', amountSatang: 10_000 },
    ]);
    assert.equal(JSON.stringify(body).includes('non-deployable-owner-test-placeholder'), false);
    return output('safe-transfer-half');
  } }));
  assert.equal(calls, 1); assert.equal(result.mode, 'ai'); assert.equal(result.selection.candidateId, 'safe-transfer-half');
  assert.deepEqual(result.snapshot, input.snapshot);
});

test('invalid provider selections, prose, oversized replies and errors fall back without inventing a command', async () => {
  const responses = [
    output('invented-command'),
    new Response(JSON.stringify({ choices: [{ message: { content: 'I recommend withdrawing a million baht.' } }] })),
    new Response('x'.repeat(32769)),
    new Response('provider detail', { status: 503 }),
  ];
  let calls = 0;
  for (const response of responses) {
    const result = await buildOwnerDecisionReport(input, enabled({ fetchImpl: async () => { calls++; return response; } }));
    assert.equal(result.mode, 'fallback'); assert.equal(result.selection.candidateId, 'safe-transfer');
    assert(!JSON.stringify(result).includes('million baht'));
  }
  assert.equal(calls, responses.length);
});

test('the same route rejects the owner operation while its explicit deployment gate is off', async context => {
  const server = createAdvisorServer({ upstreamEnabled: true, apiKey: 'non-deployable-owner-test-placeholder', ownerDecisionEnabled: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address(); assert(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/city-advisor/report`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'owner_decisions_disabled' });
});
