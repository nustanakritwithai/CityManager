import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, serialize, step } from '../src/sim.ts';
import { captureOwnerSnapshot, ownerProposalForCandidate } from '../src/owner-decision.ts';
import { createOwnerDecisionSession, replayOwnerJournal } from '../src/owner-decision-session.ts';
import { requestOwnerDecision } from '../src/owner-decision-client.ts';
import { buildOwnerDecisionResponse } from '../server/city-advisor/src/owner-contract.mjs';
import type { OwnerDecisionRequest } from '../server/city-advisor/src/owner-contract.mjs';
import { stressOwnerCash } from './owner-decision-fixture.ts';

test('a provider-selected half-safe transfer crosses the client and journal boundary once, then replays without another request', async () => {
  const city = createCity(61025);
  for (let day = 0; day < 209; day++) step(city);
  stressOwnerCash(city);

  const session = createOwnerDecisionSession(city);
  session.setMode('typhoon-auto');
  assert.deepEqual(session.advance(city), []);
  assert.equal(city.tick, 210);

  const firm = city.firms.find(f=>f.zone==='C'&&f.owner!==null);
  assert(firm);
  assert(session.evaluateTyphoonAutoMonthly(city, firm.id).length > 0);
  const snapshot = captureOwnerSnapshot(city, firm.id);
  assert(snapshot);
  const endpoint = 'https://advisor.example/api/city-advisor/report';
  let requests = 0;

  const result = await requestOwnerDecision(snapshot, { enabled: true, endpoint }, async (url, init) => {
    requests++;
    assert.equal(url, endpoint);
    assert.equal(init?.method, 'POST');
    const request = JSON.parse(String(init?.body)) as OwnerDecisionRequest;
    assert.equal(request.operation, 'owner-decision');
    assert.equal(request.snapshot.snapshotHash, snapshot.snapshotHash);
    return new Response(JSON.stringify(buildOwnerDecisionResponse(request, { candidateId: 'safe-transfer-half' }, 'ai')), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  });

  assert.equal(result.transport, 'remote');
  assert.equal(result.response?.mode, 'ai');
  assert.equal(result.response?.selection.candidateId, 'safe-transfer-half');
  assert.equal(requests, 1);

  const proposal = ownerProposalForCandidate(snapshot, result.response.selection.candidateId);
  assert.equal(proposal.command.amountSatang, 5_000);
  const before = serialize(city);
  const ledgerLength = city.ledger.length;
  assert.equal(session.registerTyphoonProposal(city, proposal), true);
  const outcome = session.applyTyphoonAuto(city, proposal.proposalId, 'typhoon-auto');
  assert.equal(outcome.status, 'applied');
  assert(['contributeOwnerCapital', 'withdrawOwnerProfit'].includes(outcome.command!.type));
  assert.notEqual(serialize(city), before);
  assert.equal(city.ledger.length, ledgerLength + 1);

  const appliedState = serialize(city);
  assert.equal(session.applyTyphoonAuto(city, proposal.proposalId, 'typhoon-auto').code, 'duplicate-proposal');
  assert.equal(serialize(city), appliedState);

  const replay = replayOwnerJournal(JSON.parse(JSON.stringify(session.exportJournal())));
  assert.equal(replay.ok, true, replay.message);
  assert.equal(serialize(replay.city!), appliedState);
  assert.equal(requests, 1);
});
