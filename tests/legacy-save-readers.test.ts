import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deserializeV2 } from '../src/legacy-v2.ts';
import { deserializeV3 } from '../src/legacy-v3.ts';

const household = JSON.stringify({ version: 2, tick: 180 }), current = JSON.stringify({ version: 9, tick: 180 });

test('frozen published v2 reader returns exact valid state and rejects corrupt old economics before migration', () => {
  const raw = readFileSync(new URL('./fixtures/legacy-v2-day180.json', import.meta.url), 'utf8'), old = deserializeV2(raw);
  assert.equal(old.version, 2); assert.equal(old.rulesVersion, 'household-1'); assert.equal(old.tick, 180);
  assert.equal(JSON.stringify(old), raw); assert.equal(JSON.stringify(deserializeV2(raw)), raw);
  const corruptions = [
    (c: typeof old) => { c.households[0].members++; },
    (c: typeof old) => { c.employment[0].workers += 100; },
    (c: typeof old) => { c.employment.push({ ...c.employment[0] }); },
    (c: typeof old) => { c.ledger[0].amount++; },
    (c: typeof old) => { c.goodsLedger[0].quantity++; },
    (c: typeof old) => { c.nextId = c.households[0].id; },
    (c: typeof old) => { c.firms[0].workDays[c.households[0].wallet] = 1; },
    (c: typeof old) => { c.rulesVersion = 'worker-1' as typeof c.rulesVersion; },
  ];
  for (const corrupt of corruptions) { const copy = JSON.parse(raw); corrupt(copy); assert.throws(() => deserializeV2(JSON.stringify(copy))); }
  for (const invalid of ['{broken', JSON.stringify({ version: 1 }), current, ' '.repeat(12_000_001)]) assert.throws(() => deserializeV2(invalid));
});

const frozenV3Hashes = {
  96: 'd3df2066643b63e0e2839215922c373c302f84907c55fd2890b56fb467652fdb',
  97: '16b5b547aaf12732cb179b3634946e6fd9c8a973aba7ce948b623e8490579327',
  119: '2f63fa3d0863568907009ae405b770fd3fc7a79bcd9306d4aced72391aed2727',
  180: '59518ff5b7d2a7c7de52ef8cb8362ed387f91df67ffc09934c93e97f3a556693',
} as const;

test('frozen v3 readers preserve published skill/job/economic history including unsettled wages byte-for-byte', () => {
  for (const tick of [96, 97, 119, 180] as const) {
    const raw = readFileSync(new URL(`./fixtures/legacy-v3-day${tick}.json`, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(raw).digest('hex'), frozenV3Hashes[tick]);
    const old = deserializeV3(raw); assert.equal(old.version, 3); assert.equal(old.rulesVersion, 'worker-1'); assert.equal(old.tick, tick);
    assert.equal(JSON.stringify(old), raw); assert.equal(JSON.stringify(deserializeV3(raw)), raw);
    if (tick !== 180) assert.ok(old.firms.some(f => Object.values(f.workDays).some(days => days > 0)), 'Actual earned wage claims remain, not cleared by the reader');
    assert.ok(old.employment.every(e => e.skill === 'general' || e.skill === e.occupation));
  }
});

test('frozen v3 reader rejects corrupt old skills, claims, journals, capacities and unsupported versions before conversion', () => {
  const raw = readFileSync(new URL('./fixtures/legacy-v3-day119.json', import.meta.url), 'utf8'), old = deserializeV3(raw);
  const corruptions = [
    (c: typeof old) => { c.households[0].workerSkills.general++; },
    (c: typeof old) => { c.households[0].members++; },
    (c: typeof old) => { c.employment[0].workers += 100; },
    (c: typeof old) => { c.employment.push({ ...c.employment[0] }); },
    (c: typeof old) => { c.employment[0].skill = (c.employment[0].occupation === 'manufacturing' ? 'retail' : 'manufacturing'); },
    (c: typeof old) => { c.firms[0].workDays[c.households[0].wallet] = 1000; },
    (c: typeof old) => { c.ledger[0].amount++; },
    (c: typeof old) => { c.goodsLedger[0].quantity++; },
    (c: typeof old) => { c.nextId = c.households[0].id; },
    (c: typeof old) => { c.rulesVersion = 'agriculture-1' as typeof c.rulesVersion; },
    (c: typeof old) => { c.firms[0].zone = 'F' as typeof c.firms[0]['zone']; },
  ];
  for (const corrupt of corruptions) { const copy = JSON.parse(raw); corrupt(copy); assert.throws(() => deserializeV3(JSON.stringify(copy))); }
  for (const invalid of ['{broken', old.version.toString(), JSON.stringify({ version: 1 }), household, current, ' '.repeat(12_000_001)]) assert.throws(() => deserializeV3(invalid));
});
