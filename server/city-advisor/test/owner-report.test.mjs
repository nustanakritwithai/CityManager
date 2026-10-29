import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, ownerFinance, serialize, step } from '../../../src/sim.ts';
import { captureOwnerSnapshot } from '../../../src/owner-decision.ts';
import { ownerDecisionCandidates } from '../src/owner-contract.mjs';
import { buildOwnerDecisionReport } from '../src/owner-report.mjs';
import { configFromEnv, createAdvisorServer } from '../src/server.mjs';
import { ENTITY_MODEL, ENTITY_UPSTREAM } from '../src/entity-report.mjs';

const fixture = (days = 215) => {
  const city = createCity(61025);
  for (let day = 0; day < days; day++) step(city);
  const firm = city.firms.find(row => row.commercialKind === 'market');
  assert(firm);
  const snapshot = captureOwnerSnapshot(city, firm.id);
  assert(snapshot);
  return { city, firm, request: { schemaVersion: 3, operation: 'owner-decision', locale: 'th', snapshot } };
};
const { city: transferCity, firm: transferFirm, request: input } = fixture();
const output = candidateId => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ candidateId }) } }] }), { headers: { 'Content-Type': 'application/json' } });
const enabled = extra => ({ ownerDecisionEnabled: true, upstreamEnabled: true, apiKey: 'non-deployable-owner-test-placeholder', ...extra });

test('transfer fixture has actual open-month profit after tax and development retention', () => {
  // Five real simulation days after the monthly payout; no injected cash,
  // fabricated profit or modified snapshot is used to enable the provider path.
  assert.equal(input.snapshot.tick, 215); assert.equal(transferFirm.id, 22);
  assert.equal(transferFirm.monthlyRevenue, 34_000); assert.equal(transferFirm.monthlyExpense, 16_000);
  const finance = ownerFinance(transferCity, transferFirm.id);
  assert.equal(finance.historyReconciled, true); assert.equal(finance.earnedWages, 0);
  assert.equal(finance.taxReserve, 3_600); assert.equal(finance.developmentReserve, 132_200);
  assert.equal(finance.distributable, 10_800); assert.equal(finance.withdrawAvailable, 10_800);
  assert.equal(input.snapshot.budgetKnown, true);
  assert.equal(input.snapshot.facts.firmCash, 188_400);
  assert.equal(input.snapshot.facts.safeContribute, 0); assert.equal(input.snapshot.facts.safeWithdraw, 10_000);
});

test('fully distributed month-end earnings offer only hold and never call the enabled provider', async () => {
  const { city, firm, request } = fixture(210), before = serialize(city);
  const finance = ownerFinance(city, firm.id);
  assert.equal(finance.developmentReserve, 128_600);
  assert.equal(finance.distributable, 0); assert.equal(finance.withdrawAvailable, 0);
  assert.equal(request.snapshot.facts.safeContribute, 0); assert.equal(request.snapshot.facts.safeWithdraw, 0);
  assert.deepEqual(ownerDecisionCandidates(request.snapshot), [{ id: 'hold', action: 'hold', amountSatang: 0 }]);
  let calls = 0;
  const result = await buildOwnerDecisionReport(request, enabled({ fetchImpl: async () => { calls++; return output('safe-transfer'); } }));
  assert.equal(result.mode, 'fallback'); assert.equal(result.selection.candidateId, 'hold');
  assert.equal(calls, 0); assert.deepEqual(result.snapshot, request.snapshot);
  assert.equal(serialize(city), before);
});

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
