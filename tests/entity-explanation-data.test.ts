import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserialize, serialize, step, type City } from '../src/sim.ts';
import { createCity as createCityV5, step as stepV5, serialize as serializeV5 } from '../src/legacy-v5.ts';
import { buildingCardData } from '../src/building-card-data.ts';
import { captureEntityExplanation, makeEntitySnapshot, validateEntitySnapshot, validateEntityRequest, buildLocalEntityExplanation, acceptEntityExplanation, entityExplanationRows, entityExplanationCandidates, entityFactEvidence } from '../src/entity-explanation-data.ts';
import type { EntitySnapshot } from '../src/entity-explanation-data.ts';

// Synthetic canonical fe307 v4 city preserves pre-commercial-L1 retail evidence.
// It is a local test fixture only, never included in the provider request.
const fixture = readFileSync(new URL('./fixtures/entity-card-v4.json', import.meta.url), 'utf8');
const city = (): City => deserialize(fixture);
const capture = (c: City, buildingId = c.buildings[0].id) => { const s = captureEntityExplanation(c, { kind: 'building', buildingId }); assert(s); return s; };
const fact = (s: EntitySnapshot, id: string) => s.facts.find(row => row.id === id);
function freeze(value: unknown): void { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } }

test('a funded v6 factory keeps entity wire scope and classifies actual capital as cash flow, never profit', () => {
  const old = createCityV5(61025);
  for (let day = 0; day < 388; day++) stepV5(old);
  const c = deserialize(serializeV5(old));
  while (!c.firms.some(f => f.fundedBy) && c.tick < 395) step(c);
  const firm = c.firms.find(f => f.fundedBy)!;
  assert(firm?.fundedBy);
  const before = serialize(c), snapshot = capture(c, firm.building);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.entity.firmId, firm.id);
  assert.equal(fact(snapshot, 'cash.current')!.value, 260_000);
  assert.equal(fact(snapshot, 'cash.inflow')!.value, 300_000);
  assert.equal(fact(snapshot, 'cash.outflow')!.value, 40_000);
  assert.equal(fact(snapshot, 'workforce.employed')!.value, 0);
  assert(!snapshot.facts.some(f => /profit|fundedBy|sponsor/i.test(f.id)));
  const request = { schemaVersion: 2, operation: 'entity-explanation', locale: 'th', snapshot };
  assert.deepEqual(validateEntityRequest(request).snapshot, snapshot);
  const encoded = JSON.stringify(request);
  for (const forbidden of ['"fundedBy"', '"accounts"', '"ledger"', '"growthStartTick"', `firm:${firm.fundedBy.firmId}`, firm.wallet]) assert(!encoded.includes(forbidden));
  assert.equal(serialize(c), before);
});

test('all six card kinds retain exact selected identity and bounded copied evidence without a full save', () => {
  const c = city(), before = serialize(c), kinds = new Set<string>();
  for (const building of c.buildings) {
    const s = capture(c, building.id); kinds.add(s.entity.kind);
    assert.equal(s.entity.id, building.id); assert.equal(s.entity.buildingId, building.id); assert.equal(s.entity.cell, building.cell); assert.equal(s.tick, c.tick);
    assert(s.facts.length <= 24); assert(Buffer.byteLength(JSON.stringify({ schemaVersion: 2, operation: 'entity-explanation', locale: 'th', snapshot: s })) <= 16384);
    for (const forbidden of ['wallets', 'accounts', 'ledger', 'goodsLedger', 'cropLedger', 'households', 'rng', 'seed']) assert(!Object.hasOwn(s, forbidden));
    for (const household of c.households) assert(!JSON.stringify(s).includes(household.wallet));
    for (const firm of c.firms) assert(!JSON.stringify(s).includes(firm.wallet));
  }
  const h = c.households[0], home = c.buildings.find(b => b.id === h.home)!;
  const s = captureEntityExplanation(c, { kind: 'household', householdId: h.id, sourceBuildingId: home.id, sourceCell: home.cell }); assert(s); kinds.add(s.entity.kind);
  assert.equal(s.entity.householdId, h.id); assert.equal(s.entity.firmId, null);
  assert.deepEqual([...kinds].sort(), ['factory', 'farm', 'house', 'household', 'market', 'shop']);
  assert.equal(serialize(c), before);
});

test('cash stocks and inclusive trailing cash movements match canonical card, never a profit or whole-calendar-month claim', () => {
  const c = city(), h = c.buildings.find(b => b.zone === 'R')!, s = capture(c, h.id), card = buildingCardData(c, h.id)!;
  assert.deepEqual(s.window, { fromTick: 151, toTick: 180, inclusive: true, maxDays: 30, empty: false });
  assert.equal(fact(s, 'cash.current')!.value, card.cash.current); assert.equal(fact(s, 'cash.inflow')!.value, card.cash.inflow); assert.equal(fact(s, 'cash.outflow')!.value, card.cash.outflow); assert.equal(fact(s, 'cash.net')!.value, card.cash.net);
  assert.equal(fact(s, 'cash.current')!.period, 'snapshot'); assert.equal(fact(s, 'cash.net')!.period, 'window'); assert.equal(fact(s, 'cash.net')!.unit, 'satang');
  assert.match(entityFactEvidence(s, 'cash.current'), /฿/); assert.match(entityFactEvidence(s, 'cash.net'), /151–180/);
  assert(!s.facts.some(row => /profit|revenue/.test(row.id)));
  const zero = city(); zero.tick = 0; const z = capture(zero, h.id);
  assert.equal(z.window.empty, true); assert(!z.facts.some(row => row.period !== 'snapshot'));
  assert(z.missing.some(row => row.id === 'cash.inflow' && row.reason === 'empty-period'));
});

test('missing firm, unknown price and unsafe values stay missing instead of zero', () => {
  const c = city(), firm = c.firms[0], buildingId = firm.building;
  c.firms = c.firms.filter(row => row.id !== firm.id);
  const s = capture(c, buildingId); assert.equal(s.entity.firmId, null);
  assert.equal(fact(s, 'cash.current'), undefined); assert(s.missing.some(row => row.id === 'cash.current'));
  assert.equal(fact(s, 'stocks.goods'), undefined); assert(s.missing.some(row => row.id === 'stocks.goods'));
  const normal = capture(city()); assert(normal.missing.some(row => row.id.startsWith('price.')));
  const insufficient = makeEntitySnapshot({ schemaVersion: 1, entity: s.entity, tick: s.tick, window: s.window, facts: [], missing: [{ id: 'cash.current', reason: 'unavailable' }] });
  const report = buildLocalEntityExplanation(insufficient), rows = entityExplanationRows(report);
  assert.deepEqual(rows.observations, []); assert.deepEqual(rows.hypotheses, []); assert(rows.checks.length > 0);
});

test('observed unit prices retain explicit commodity denominators while cash stocks remain satang', () => {
  const c = city(), shop = c.firms.find(f => buildingCardData(c, f.building)?.kind === 'shop')!, farm = c.firms.find(f => buildingCardData(c, f.building)?.kind === 'farm')!;
  const goods = capture(c, shop.building), crops = capture(c, farm.building);
  assert.equal(fact(goods, 'price.goodsSell')!.unit, 'satang/goods');
  assert.equal(fact(crops, 'price.cropsSell')!.unit, 'satang/crops');
  assert.equal(fact(goods, 'cash.current')!.unit, 'satang');
  assert.match(entityFactEvidence(goods, 'price.goodsSell'), /฿\/หน่วยสินค้า/);
  assert.match(entityFactEvidence(crops, 'price.cropsSell'), /฿\/หน่วยพืชผล/);
});

test('selection guards reject removed, wrong-source and stale household references', () => {
  const c = city(), h = c.households[0], home = c.buildings.find(b => b.id === h.home)!;
  assert.equal(captureEntityExplanation(c, null), null);
  assert.equal(captureEntityExplanation(c, { kind: 'building', buildingId: 99999 }), null);
  assert.equal(captureEntityExplanation(c, { kind: 'household', householdId: h.id, sourceBuildingId: home.id, sourceCell: home.cell + 1 }), null);
  h.home = null;
  assert.equal(captureEntityExplanation(c, { kind: 'household', householdId: h.id, sourceBuildingId: home.id, sourceCell: home.cell }), null);
});

test('household links from an actual employer or owner workplace remain valid without treating the firm as its home', () => {
  const c = city(), allocation = c.employment[0], household = c.households.find(h => h.id === allocation.householdId)!, firm = c.firms.find(f => f.id === allocation.firmId)!, source = c.buildings.find(b => b.id === firm.building)!;
  const selection = { kind: 'household' as const, householdId: household.id, sourceBuildingId: source.id, sourceCell: source.cell };
  const s = captureEntityExplanation(c, selection); assert(s); assert.equal(s.entity.householdId, household.id); assert.equal(s.entity.buildingId, household.home);
  c.employment = c.employment.filter(item => item.householdId !== household.id || item.firmId !== firm.id); c.ownerLabor = c.ownerLabor.filter(item => item.householdId !== household.id || item.firmId !== firm.id);
  assert.equal(captureEntityExplanation(c, selection), null, 'removed relationship cannot be reinterpreted as another employer');
});

test('same-tick content changes bind a new key and cannot accept the previous selected response', () => {
  const c = city(), f = c.firms[0], first = capture(c, f.building), old = buildLocalEntityExplanation(first);
  c.accounts[f.wallet] += 1;
  const next = capture(c, f.building), local = buildLocalEntityExplanation(next);
  assert.equal(next.tick, first.tick); assert.notEqual(next.snapshotKey, first.snapshotKey);
  old.mode = 'ai'; assert.equal(acceptEntityExplanation(old, local), null);
  const other = capture(c, c.buildings.find(b => b.id !== f.building)!.id);
  assert.equal(acceptEntityExplanation(buildLocalEntityExplanation(other), local), null);
});

test('strict wire rejects forged keys, units, extra save fields, inherited names and unknown output references', () => {
  const s = capture(city()), local = buildLocalEntityExplanation(s);
  assert.deepEqual(validateEntityRequest({ schemaVersion: 2, operation: 'entity-explanation', locale: 'th', snapshot: s }).snapshot, s);
  for (const alter of [
    (value: EntitySnapshot) => { value.snapshotKey += 'forged'; },
    (value: EntitySnapshot) => { value.facts[0].unit = 'people'; },
    (value: EntitySnapshot) => { (value as unknown as Record<string, unknown>).accounts = { treasury: 1 }; },
    (value: EntitySnapshot) => { value.facts[0].id = 'toString'; },
    (value: EntitySnapshot) => { value.facts.push(structuredClone(value.facts[0])); },
  ]) { const changed = structuredClone(s); alter(changed); assert.throws(() => validateEntitySnapshot(changed)); }
  const ai = structuredClone(local); ai.mode = 'ai'; assert.equal(acceptEntityExplanation(ai, local)!.mode, 'ai');
  const forged = structuredClone(ai); forged.report.observationIds = ['observed.invented']; assert.equal(acceptEntityExplanation(forged, local), null);
  const prose = { ...ai, text: 'The model invented a cause' }; assert.equal(acceptEntityExplanation(prose, local), null);
  const causal = structuredClone(ai); causal.report.hypothesisIds = ['possible.guaranteed-cause']; assert.equal(acceptEntityExplanation(causal, local), null);
});

test('possible causes are eligible fixed hypotheses with evidence and never remote causal prose', () => {
  const s = capture(city()), core = structuredClone(s); core.facts = [{ id: 'cash.inflow', value: 100, unit: 'satang', period: 'window' }, { id: 'cash.outflow', value: 200, unit: 'satang', period: 'window' }]; core.missing = [];
  const { snapshotKey: _, ...rest } = core, observed = makeEntitySnapshot(rest), rows = entityExplanationRows(buildLocalEntityExplanation(observed));
  assert(rows.hypotheses.some(row => row.id === 'possible.cash-pressure' && /เป็นไปได้/.test(row.text) && /ไม่ใช่กำไร/.test(row.text)));
  assert(rows.hypotheses.every(row => row.factRefs.every(id => observed.facts.some(f => f.id === id))));
  const positive = structuredClone(rest); positive.facts[0].value = 300;
  assert(!entityExplanationCandidates(makeEntitySnapshot(positive)).hypotheses.some(row => row.id === 'possible.cash-pressure'));
});

test('deep-frozen city reads and returned report edits cannot mutate simulation; integer satang display is exact', () => {
  const c = city(), before = serialize(c); freeze(c);
  const s = capture(c), local = buildLocalEntityExplanation(s), rows = entityExplanationRows(local); assert(rows.observations.length);
  local.snapshot.entity.id = 999; local.snapshot.facts[0].value = 1; assert.equal(serialize(c), before);
  const core = capture(c), { snapshotKey: _, ...rest } = core;
  rest.facts = [{ id: 'cash.current', value: Number.MAX_SAFE_INTEGER, unit: 'satang', period: 'snapshot' }]; rest.missing = [];
  assert.match(entityFactEvidence(makeEntitySnapshot(rest), 'cash.current'), /90,071,992,547,409\.91 ฿/);
});
