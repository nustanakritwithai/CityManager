import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createCity, deserialize, serialize } from '../src/sim.ts';
import { browserSnapshotState } from './browser-snapshot.ts';
import { populationFixture } from './population-capacity-fixture.ts';

test('browser snapshot helpers validate saves while preserving their raw journal representation', async () => {
  const directory = new URL('./', import.meta.url);
  const files = readdirSync(directory).filter(name => name.endsWith('-smoke.mjs'));
  const city = createCity(61025), saved = serialize(city), parsed = JSON.parse(saved);
  const historical = readFileSync(new URL('./fixtures/housing-v16-park-session.json', import.meta.url), 'utf8');
  const historicCity = JSON.parse(historical); delete historicCity.parkRuntime;
  const historicalRaw = JSON.stringify(historicCity);
  let checked = 0;
  for (const file of files) {
    const line = readFileSync(new URL(file, directory), 'utf8').split('\n').find(text => text.startsWith('const state'));
    if (!line || !line.includes('window.cityManager.snapshot()')) continue;
    const run = runInNewContext(`async (evaluate, browserSnapshotState, deserialize, mode) => { ${line} return state(); }`);
    const evaluate = async (expression: string) => expression === 'JSON.parse(window.cityManager.snapshot())' ? JSON.parse(saved) : saved;
    const actual = await run(evaluate, browserSnapshotState, deserialize, 'candidate');
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(city)), `${file}: complete city preserved`);
    for (const edit of [
      (v: any) => { v.version = 999; }, (v: any) => { v.rulesVersion = 'chain-14'; },
      (v: any) => { v.commercialBaseVersion = 999; }, (v: any) => { v.accounts.treasury++; },
    ]) {
      const invalid = structuredClone(parsed); edit(invalid);
      await assert.rejects(() => run(async () => JSON.stringify(invalid), browserSnapshotState, deserialize, 'candidate'), undefined, `${file}: invalid save rejected`);
    }
    if (file === 'compact-smoke.mjs') {
      const legacy = { version: 1, accounts: { treasury: 123 } };
      const raw = await run(async () => legacy, browserSnapshotState, deserialize, 'baseline');
      assert.deepEqual(JSON.parse(JSON.stringify(raw)), legacy, 'historical baseline remains untouched');
    }
    checked++;
  }
  assert.equal(checked, 16, 'all browser city snapshot helpers, including plant upgrades and demolition refunds, are covered');
  const historicalState = browserSnapshotState(historicalRaw);
  assert.deepEqual(historicalState.ledger, historicCity.ledger, 'genuine old journals remain byte-for-byte represented');
  assert.deepEqual(historicalState.cropLedger, historicCity.cropLedger);
  assert.deepEqual(historicalState.goodsLedger, historicCity.goodsLedger);
  assert.equal(historicalRaw, JSON.stringify(historicCity), 'validation leaves original save bytes untouched');
  const uncheckpointed = serialize(populationFixture(128)), source = JSON.parse(uncheckpointed);
  assert.ok(deserialize(uncheckpointed).ledger.length < source.ledger.length, 'fixture triggers real decoder compaction');
  assert.deepEqual(browserSnapshotState(uncheckpointed).ledger, source.ledger, 'helper never substitutes the compacted decoder result');
  assert.equal(uncheckpointed, JSON.stringify(source), 'the original raw bytes remain available for exact read-only comparisons');
});
