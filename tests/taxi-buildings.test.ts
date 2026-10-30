import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, bulldoze, buildPark, zoneCell, buildRoad, connectedRoads, SIZE, type City } from '../src/sim.ts';
import { TAXI_ENABLED, MAX_TAXI_DEPOTS, TAXI_DEPOT, taxiAt, taxiEnabled, taxiUnits } from '../src/taxi/buildings.ts';
import * as placement from '../src/taxi/placement.ts';
import * as buildings from '../src/taxi/buildings.ts';
import { buildTaxiDepot, taxiSiteReason, upgradeTaxiDepot, toggleTaxiDepot } from '../src/taxi/placement.ts';
import { SAVE_KEY, TAXI_BACKUP_KEY, saveStoredCity } from '../src/save-storage.ts';

const grown = () => { const c = createCity(61025); for (let d = 0; d < 20; d++) step(c); return c; };
const nb = (i: number) => [i - 1, i + 1, i - SIZE, i + SIZE].filter(n => n >= 0 && n < SIZE * SIZE && (Math.abs((n % SIZE) - (i % SIZE)) <= 1));
/** Empty unzoned lots beside a connected road. */
const sites = (c: City) => { const r = connectedRoads(c); return c.cells.flatMap((x, i) => !x.road && x.zone === null && x.building === null && nb(i).some(n => r.has(n)) && !c.parks.some(p => p.cell === i) && !c.plants.some(p => p.cell === i) && !c.education?.campuses.some(k => k.cell === i) ? [i] : []); };
const withTaxi = () => { const c = grown(), s = sites(c); assert.ok(buildTaxiDepot(c, s[0], true).ok); assert.ok(buildTaxiDepot(c, s[1], true).ok); return c; };

test('flag off by default; dev toggle; placement refused while off', () => {
  assert.equal(TAXI_ENABLED, false);
  const mem = new Map<string, string>(), st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  assert.equal(taxiEnabled('', st), false); assert.equal(taxiEnabled('?taxi=1', st), true); assert.equal(taxiEnabled('', st), true); assert.equal(taxiEnabled('?taxi=0', st), false);
  const c = grown(); assert.equal(buildTaxiDepot(c, sites(c)[0], false).ok, false); assert.equal(c.taxi, undefined);
});
test('a city without taxi saves byte-identical and never gains a taxi key', () => {
  const c = grown(), before = serialize(c);
  assert.ok(!before.includes('"taxi"'));
  assert.equal(serialize(deserialize(before)), before);
  for (let d = 0; d < 5; d++) step(c);
  assert.ok(!serialize(c).includes('"taxi"'));
});
test('round trip with taxi keeps the section, key order and save version', () => {
  const c = withTaxi(), raw = serialize(c), v = JSON.parse(raw);
  assert.equal(c.version, 9); assert.equal(v.version, JSON.parse(serialize(grown())).version);
  const back = deserialize(raw); assert.deepEqual(back.taxi, c.taxi); assert.equal(serialize(back), raw);
  assert.equal(taxiUnits(back.taxi!.depots[0]), TAXI_DEPOT.units[1]);
});
test('validator rejects bad taxi data', () => {
  const c = withTaxi(), good = JSON.parse(serialize(c));
  const bad = (f: (t: any, j: any) => void) => { const j = structuredClone(good); f(j.taxi, j); assert.throws(() => deserialize(JSON.stringify(j)), /taxi/i); };
  bad(t => { t.version = 2; });
  bad(t => { t.extra = 1; });
  bad(t => { t.depots[0].level = 3; });
  bad(t => { t.depots[1].id = t.depots[0].id; });
  bad(t => { t.stands = []; }); // stands do not exist
  bad((t, j) => { t.depots[0].id = j.nextId; });
  bad((t, j) => { t.depots[0].id = j.parks[0]?.id ?? j.buildings[0].id; });
  bad(t => { t.depots[1].cell = t.depots[0].cell; });
  bad((t, j) => { t.depots[0].cell = j.cells.findIndex((x: any) => x.road); });
  bad((t, j) => { j.cells[t.depots[0].cell].zone = 'R'; }); // an older build zoned over the lot
  bad(t => { t.depots = Array.from({ length: MAX_TAXI_DEPOTS + 1 }, (_, k) => ({ ...t.depots[0], id: 9000 + k, cell: k })); });
  bad(t => { t.depots[0].tick = 1e9; });
  assert.doesNotThrow(() => deserialize(JSON.stringify(good)));
});
test('placement rules and limits', () => {
  const c = grown(), s = sites(c);
  const road = c.cells.findIndex(x => x.road), zoned = c.cells.findIndex(x => x.zone !== null);
  assert.ok(taxiSiteReason(c, road, true)); assert.ok(taxiSiteReason(c, zoned, true));
  const lonely = c.cells.findIndex((x, i) => !x.road && x.zone === null && !nb(i).some(n => c.cells[n].road));
  assert.match(taxiSiteReason(c, lonely, true)!, /ถนน/);
  for (let k = 0; k < MAX_TAXI_DEPOTS; k++) assert.ok(buildTaxiDepot(c, s[k], true).ok);
  assert.equal(buildTaxiDepot(c, s[MAX_TAXI_DEPOTS], true).ok, false);
  assert.equal(buildTaxiDepot(c, s[0], true).ok, false, 'lot already used');
  const id = c.taxi!.depots[0].id;
  assert.ok(upgradeTaxiDepot(c, id, true).ok); assert.equal(taxiUnits(c.taxi!.depots[0]), 8); assert.equal(upgradeTaxiDepot(c, id, true).ok, false);
  assert.ok(toggleTaxiDepot(c, id, true).ok); assert.equal(taxiUnits(c.taxi!.depots[0]), 0);
  // No taxi stands anywhere in the API.
  assert.ok(![...Object.keys(placement), ...Object.keys(buildings)].some(k => /stand/i.test(k)));
  assert.deepEqual(Object.keys(buildings.createTaxi()).sort(), ['depots', 'rules', 'version']);
  // Taxi lots count as occupied for other tools.
  const t = c.taxi!.depots[1].cell;
  assert.equal(buildPark(c, t).ok, false); assert.equal(zoneCell(c, t, 'R').ok, false); assert.equal(buildRoad(c, t, t).ok, false);
  serialize(c); // still valid
});
test('bulldoze removes a taxi depot for free', () => {
  const c = withTaxi(), cell = c.taxi!.depots[0].cell, accounts = { ...c.accounts }, ledger = c.ledger.length;
  assert.ok(bulldoze(c, cell).ok); assert.equal(taxiAt(c, cell), undefined);
  assert.deepEqual(c.accounts, accounts); assert.equal(c.ledger.length, ledger);
  assert.ok(buildTaxiDepot(c, cell, true).ok); deserialize(serialize(c));
});
test('economy unchanged over N days with taxi sites present', () => {
  const a = grown(), b = grown(), s = sites(b);
  buildTaxiDepot(b, s[0], true); buildTaxiDepot(b, s[1], true);
  const strip = (c: City) => { const j = JSON.parse(serialize(c)); delete j.taxi; delete j.lastEvent; delete j.nextId; return j; };
  for (let d = 0; d < 30; d++) { step(a); step(b); }
  // Taxi sites take ids from nextId (like parks), so later entity ids shift by 2; money must not.
  const norm = (j: any) => JSON.stringify({ accounts: Object.entries(j.accounts).map(([k, v]) => [k.replace(/\d+/g, '#'), v]).sort(), ledger: j.ledger.map((e: any) => ({ ...e, from: e.from.replace(/\d+/g, '#'), to: e.to.replace(/\d+/g, '#'), reason: e.reason.replace(/#\d+/g, '#') })), goods: j.goods, crops: j.crops, households: j.households.length, firms: j.firms.length });
  assert.equal(norm(strip(b)), norm(strip(a)));
});
test('before-taxi backup is written once before the first taxi save', () => {
  const mem = new Map<string, string>(), st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), get length() { return mem.size; }, key: (n: number) => [...mem.keys()][n] ?? null, clear: () => mem.clear() };
  const c = grown(), plain = serialize(c); mem.set(SAVE_KEY, plain);
  buildTaxiDepot(c, sites(c)[0], true); const first = serialize(c);
  saveStoredCity(st as any, first, null); mem.set(SAVE_KEY, first);
  assert.equal(mem.get(TAXI_BACKUP_KEY), plain);
  buildTaxiDepot(c, sites(c)[0], true); saveStoredCity(st as any, serialize(c), null);
  assert.equal(mem.get(TAXI_BACKUP_KEY), plain); assert.equal(mem.get(`${TAXI_BACKUP_KEY}.1`), undefined);
});
