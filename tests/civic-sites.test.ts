import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildCivic, buildPark, buildPlant, buildRoad, zoneCell, bulldoze, access, treasurySpendable, MONTH, SIZE, type City } from '../src/sim.ts';
import { CIVIC, CIVIC_KINDS, MAX_CIVIC_SITES, civicAt, civicBuildReason, civicCoverage, civicPoints, civicUpkeepReason } from '../src/civic/sites.ts';
import { homeAmenities } from '../src/resident-happiness.ts';

const seeded = (days = 40) => { const c = createCity(61025); for (let i = 0; i < days; i++) step(c); return c; };
/** Empty, unzoned parcels with connected road frontage, nearest the map start first. */
const sites = (c: City) => c.cells.map((_, i) => i).filter(i => { const cell = c.cells[i]; return !cell.road && cell.zone === null && cell.building === null && access(c, i) && !c.parks.some(p => p.cell === i) && !c.plants.some(p => p.cell === i) && !c.education?.campuses.some(p => p.cell === i) && !civicAt(c, i); });
const none = Object.fromEntries(CIVIC_KINDS.map(kind => [kind, false]));
const distance = (a: number, b: number) => Math.abs(a % SIZE - b % SIZE) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));

test('a city that never builds a service keeps a byte-identical save', () => {
  const c = seeded(), before = serialize(c);
  assert.equal('civic' in c, false);
  assert.equal(serialize(deserialize(before)), before);
});

test('building charges the treasury once, records the site and survives a save round trip', () => {
  const c = seeded();
  const [cell] = sites(c); assert.notEqual(cell, undefined, 'fixture has a free parcel on a connected road');
  for (const kind of CIVIC_KINDS) {
    const d = deserialize(serialize(c)), treasury = d.accounts.treasury, entries = d.ledger.length, r = buildCivic(d, cell, kind);
    assert.equal(r.ok, true, r.message);
    const site = civicAt(d, cell)!; assert.deepEqual({ kind: site.kind, cell: site.cell, tick: site.tick }, { kind, cell, tick: d.tick });
    assert.equal(d.accounts.treasury, treasury - CIVIC[kind].cost);
    assert.deepEqual(d.ledger.slice(entries).map(e => [e.from, e.to, e.amount, e.reason]), [['treasury', 'construction', CIVIC[kind].cost, civicBuildReason(kind, site.id)]]);
    const saved = serialize(d); assert.deepEqual(deserialize(saved).civic, d.civic); assert.equal(serialize(deserialize(saved)), saved);
  }
});

test('placement refuses occupied, unconnected and unaffordable parcels without changing the city', () => {
  const c = seeded();
  const [cell, other] = sites(c);
  const refused = (city: City, i: number, why: string) => { const before = serialize(city); assert.equal(buildCivic(city, i, 'clinic').ok, false, why); assert.equal(serialize(city), before, why); };
  refused(c, c.cells.findIndex(x => x.road), 'road');
  refused(c, c.cells.findIndex(x => x.building !== null), 'building');
  refused(c, c.cells.findIndex((x, i) => !x.road && x.zone === null && x.building === null && !access(c, i)), 'no connected road');
  assert.equal(buildCivic(c, cell, 'clinic').ok, true); refused(c, cell, 'already a service');
  const poor = deserialize(serialize(c)); poor.accounts.treasury = 0; assert.equal(treasurySpendable(poor), 0); refused(poor, other, 'no money');
  // The parcel is taken for every other builder too.
  for (const [name, attempt] of [['park', () => buildPark(c, cell)], ['plant', () => buildPlant(c, cell, 'power')], ['zone', () => zoneCell(c, cell, 'R')], ['road', () => buildRoad(c, cell, cell)]] as const) {
    const before = serialize(c); assert.equal(attempt().ok, false, name); assert.equal(serialize(c), before, name);
  }
});

test('the site limit holds on load', () => {
  const c = seeded(); const [cell] = sites(c); assert.equal(buildCivic(c, cell, 'fire').ok, true);
  const save = JSON.parse(serialize(c)), first = save.civic.sites[0];
  save.civic.sites = Array.from({ length: MAX_CIVIC_SITES + 1 }, (_, n) => ({ ...first, id: first.id + n, cell: first.cell + n }));
  assert.throws(() => deserialize(JSON.stringify(save)), /civic save: too many sites/);
});

test('upkeep is charged at each month end and stops when the site is removed', () => {
  const c = seeded(MONTH + 5);
  const [cell] = sites(c); assert.equal(buildCivic(c, cell, 'police').ok, true);
  const id = civicAt(c, cell)!.id, reason = civicUpkeepReason('police', id);
  while (c.tick % MONTH !== 0) step(c);
  const bills = c.ledger.filter(e => e.reason === reason);
  assert.deepEqual(bills.map(e => [e.from, e.to, e.amount, e.tick]), [['treasury', 'upkeep', CIVIC.police.upkeep, c.tick]]);
  deserialize(serialize(c));
  const treasury = c.accounts.treasury, removed = bulldoze(c, cell);
  assert.equal(removed.ok, true, removed.message); assert.equal(civicAt(c, cell), undefined); assert.equal('civic' in c, false, 'empty section is dropped');
  assert.equal(c.accounts.treasury, treasury, 'removal is free and refunds nothing');
  const removedAt = c.tick;
  for (let i = 0; i < MONTH; i++) step(c);
  // Old entries may be archived out of the live ledger; none may be written after the removal.
  assert.equal(c.ledger.filter(e => e.reason === reason && e.tick > removedAt).length, 0, 'no upkeep after removal'); deserialize(serialize(c));
});

test('covered homes gain each kind once; homes out of reach gain nothing', () => {
  const c = seeded();
  const [cell] = sites(c), home = c.buildings.filter(b => b.zone === 'R').sort((a, b) => distance(a.cell, cell) - distance(b.cell, cell))[0];
  const base = homeAmenities(c, home.cell);
  assert.deepEqual(base.services, none);
  assert.equal(buildCivic(c, cell, 'clinic').ok, true);
  const inReach = distance(home.cell, cell) <= CIVIC.clinic.radius, after = homeAmenities(c, home.cell);
  assert.equal(after.services!.clinic, inReach); assert.equal(after.points, base.points + (inReach ? CIVIC.clinic.points : 0));
  // Pure coverage rule on a known layout: radius is inclusive, kinds do not stack with themselves.
  const host = { civic: { version: 1 as const, rules: 'civic-1' as const, sites: [{ id: 1, cell: 0, kind: 'clinic' as const, tick: 0 }, { id: 2, cell: 1, kind: 'clinic' as const, tick: 0 }, { id: 3, cell: 0, kind: 'fire' as const, tick: 0 }] } };
  const line = (a: number, b: number) => Math.abs(a - b);
  assert.deepEqual(civicCoverage(host, CIVIC.clinic.radius, line), { ...none, clinic: true, fire: true });
  assert.equal(civicPoints(civicCoverage(host, CIVIC.clinic.radius, line)), CIVIC.clinic.points + CIVIC.fire.points);
  assert.deepEqual(civicCoverage(host, CIVIC.fire.radius + 2, line), none);
  assert.deepEqual(civicCoverage({}, 0, line), none);
});

test('a malformed civic section is rejected on load', () => {
  const c = seeded(); const [cell] = sites(c); assert.equal(buildCivic(c, cell, 'fire').ok, true);
  const good = JSON.parse(serialize(c));
  const broken = (edit: (save: any) => void, why: string) => { const save = structuredClone(good); edit(save); assert.throws(() => deserialize(JSON.stringify(save)), /civic/, why); };
  broken(s => { s.civic.sites[0].kind = 'school'; }, 'unknown kind');
  broken(s => { s.civic.sites[0].cell = s.cells.findIndex((x: any) => x.road); }, 'on a road');
  broken(s => { s.civic.sites.push({ ...s.civic.sites[0] }); }, 'duplicate id and cell');
  broken(s => { s.civic.sites[0].tick = s.tick + 1; }, 'built in the future');
  broken(s => { s.civic.rules = 'civic-2'; }, 'unknown rules');
  broken(s => { s.civic.sites[0].extra = 1; }, 'extra field');
});

test('ledger reasons read in Thai in the panels', async () => {
  const { reasonLabel } = await import('../src/inspector-data.ts');
  assert.equal(reasonLabel(civicBuildReason('police', 12)), 'สร้างสถานีตำรวจ #12');
  assert.equal(reasonLabel(civicUpkeepReason('clinic', 7)), 'ค่าบำรุงสถานีอนามัย #7 รายเดือน');
  assert.equal(reasonLabel(civicUpkeepReason('fire', 3)), 'ค่าบำรุงสถานีดับเพลิง #3 รายเดือน');
  assert.equal(reasonLabel(civicBuildReason('stadium', 40)), 'สร้างสนามฟุตบอล #40');
  assert.equal(reasonLabel(civicUpkeepReason('temple', 41)), 'ค่าบำรุงวัด #41 รายเดือน');
  assert.equal(reasonLabel('Build park #5'), 'สร้างสวนสาธารณะ #5', 'other Build reasons keep their own labels');
});
