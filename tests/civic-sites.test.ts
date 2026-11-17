import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildCivic, civicSiteReason, buildPark, buildPlant, buildRoad, zoneCell, bulldoze, access, treasurySpendable, householdWorkerCount, venueEmploymentForHousehold, leaseVenue, endVenueLease, venueLeaseCandidate, MONTH, SIZE, type City } from '../src/sim.ts';
import { CIVIC, CIVIC_KINDS, MAX_CIVIC_SITES, civicAt, civicBuildReason, civicCoverage, civicPoints, civicUpkeepReason, civicFeeReason, civicDailyWageReason, civicRentReason, civicPayroll, civicWageReason, civicWorkers } from '../src/civic/sites.ts';
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
  for (const kind of CIVIC_KINDS) {
    // Each kind is tried where its own footprint fits: larger kinds need more than one free parcel.
    const d = deserialize(serialize(c)), cell = d.cells.map((_, i) => i).find(i => civicSiteReason(d, i, kind) === null)!;
    assert.notEqual(cell, undefined, `fixture has room for a ${kind}`);
    const treasury = d.accounts.treasury, entries = d.ledger.length, r = buildCivic(d, cell, kind);
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

test('a larger site takes its whole footprint, by map coordinate, and one free parcel is not enough', async () => {
  const { civicParcels, civicSiteReason } = await import('../src/sim.ts');
  const { civicFootprint, civicCells } = await import('../src/civic/sites.ts');
  const c = seeded();
  // An anchor whose 2×2 block is free and touches a connected road.
  const anchor = c.cells.map((_, i) => i).find(i => civicSiteReason(c, i, 'stadium') === null);
  assert.notEqual(anchor, undefined, 'fixture has room for a stadium');
  const parts = civicParcels(c, anchor!, 'stadium')!;
  assert.deepEqual(civicFootprint('stadium'), [2, 2]); assert.equal(parts.length, 4); assert.equal(parts[0], anchor);
  assert.deepEqual(parts.map(p => [p % SIZE - anchor! % SIZE, Math.floor(p / SIZE) - Math.floor(anchor! / SIZE)]), [[0, 0], [1, 0], [0, 1], [1, 1]], 'row by row from the top-left');
  assert.equal(buildCivic(c, anchor!, 'stadium').ok, true);
  const site = civicAt(c, anchor!)!; assert.deepEqual(civicCells(site), parts);
  for (const part of parts) { assert.equal(civicAt(c, part), site, 'every parcel belongs to the site'); const before = serialize(c); assert.equal(buildPark(c, part).ok, false); assert.equal(zoneCell(c, part, 'R').ok, false); assert.equal(serialize(c), before); }
  // Overlapping footprints are refused; the saved shape round-trips; removing any parcel removes the site.
  assert.equal(buildCivic(c, parts[1], 'clinic').ok, false);
  const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved);
  assert.equal(bulldoze(c, parts[3]).ok, true); for (const part of parts) assert.equal(civicAt(c, part), undefined);
  // The east edge of the map has no room for a second column.
  const edge = SIZE - 1; assert.equal(civicParcels(c, edge, 'stadium'), null); assert.match(civicSiteReason(c, edge, 'stadium')!, /2×2/);
});

test('a one-parcel stadium from an older save still loads; a tampered footprint does not', () => {
  const c = seeded(); const [cell] = sites(c);
  assert.equal(buildCivic(c, cell, 'clinic').ok, true);
  const save = JSON.parse(serialize(c)); save.civic.sites[0].kind = 'stadium';
  const old = deserialize(JSON.stringify(save)); assert.equal(old.civic!.sites[0].cells, undefined); assert.equal(civicAt(old, cell)!.kind, 'stadium');
  const bad = (edit: (s: any) => void, why: string) => { const copy = structuredClone(save); edit(copy); assert.throws(() => deserialize(JSON.stringify(copy)), /civic/, why); };
  bad(s => { s.civic.sites[0].cells = [cell]; }, 'cells on a one-parcel shape');
  bad(s => { s.civic.sites[0].cells = [cell, cell + 1, cell + 2, cell + 3]; }, 'not the 2×2 block');
  bad(s => { s.civic.sites[0].kind = 'airport'; }, 'an airport is never one parcel');
});

test('an airport brings visitor income each month, more with each attraction, and none without its road', async () => {
  const { cityAttractions, civicSiteReason } = await import('../src/sim.ts');
  const { civicVisitorIncome, civicVisitorsReason } = await import('../src/civic/sites.ts');
  assert.equal(civicVisitorIncome('airport', 0), 50_000); assert.equal(civicVisitorIncome('airport', 3), 140_000); assert.equal(civicVisitorIncome('clinic', 5), 0);
  const c = seeded(MONTH + 5);
  const anchor = c.cells.map((_, i) => i).find(i => civicSiteReason(c, i, 'airport') === null);
  assert.notEqual(anchor, undefined, 'fixture has room and money for an airport');
  assert.equal(buildCivic(c, anchor!, 'airport').ok, true);
  const site = civicAt(c, anchor!)!; assert.equal(site.cells!.length, 6);
  assert.deepEqual(homeAmenities(c, c.buildings.find(b => b.zone === 'R')!.cell).services!.airport, false, 'an airport adds no happiness');
  const attractions = cityAttractions(c); assert.equal(attractions, c.parks.length);
  while (c.tick % MONTH !== 0) step(c);
  const income = c.ledger.filter(e => e.reason === civicVisitorsReason(site.id));
  assert.deepEqual(income.map(e => [e.from, e.to, e.amount, e.tick]), [['outside', 'treasury', civicVisitorIncome('airport', cityAttractions(c)), c.tick]]);
  deserialize(serialize(c));
});

test('services and places together add at most the cap', async () => {
  const { CIVIC_POINTS_CAP, CIVIC_ATTRACTIONS } = await import('../src/civic/sites.ts');
  const all = Object.fromEntries(CIVIC_KINDS.map(kind => [kind, true])) as Record<(typeof CIVIC_KINDS)[number], boolean>;
  const uncapped = CIVIC_KINDS.reduce((n, kind) => n + CIVIC[kind].points, 0);
  assert.ok(uncapped > CIVIC_POINTS_CAP, 'the cap matters once every kind is in reach');
  assert.equal(civicPoints(all), CIVIC_POINTS_CAP);
  assert.equal(civicPoints({ ...none, clinic: true, museum: true } as typeof all), CIVIC.clinic.points + CIVIC.museum.points, 'below the cap nothing is lost');
  assert.deepEqual([...CIVIC_ATTRACTIONS], ['library', 'temple', 'stadium', 'museum', 'amusement', 'cinema', 'restaurant', 'nightmarket', 'concert']);
});

const VENUES = CIVIC_KINDS.filter(kind => CIVIC[kind].staff);
/** A venue next to homes in a city with spare labour, stepped day by day with a save round trip each day. */
function venueCity(kind: (typeof VENUES)[number], days: number) {
  const c = seeded(60), home = c.buildings.find(b => b.zone === 'R')!.cell;
  // The starter city is fully employed; closing its factories and farms leaves residents looking for work.
  for (const b of c.buildings.filter(b => b.zone === 'I' || b.zone === 'F')) assert.equal(bulldoze(c, b.cell).ok, true);
  const cell = c.cells.map((_, i) => i).filter(i => civicSiteReason(c, i, kind) === null).sort((a, b) => distance(a, home) - distance(b, home))[0];
  assert.equal(buildCivic(c, cell, kind).ok, true);
  const site = () => civicAt(c, cell)!;
  for (let i = 0; i < days; i++) { step(c); const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved, `day ${i}`); }
  return { c, site, cell };
}

test('a venue hires residents, pays them monthly from the treasury and withholds wage tax', () => {
  const { c, site } = venueCity('cinema', MONTH + 2), staff = CIVIC.cinema.staff!, id = site().id;
  const wages = c.ledger.filter(e => e.reason === civicWageReason('cinema', id));
  assert.ok(wages.length > 0, 'wages were paid at month end');
  for (const e of wages) { assert.equal(e.from, 'treasury'); assert.match(e.to, /^household:\d+$/); assert.equal(e.amount % staff.dailyWage, 0); assert.equal(e.tick % MONTH, 0); }
  assert.ok(wages.reduce((n, e) => n + e.amount, 0) <= staff.slots * MONTH * staff.dailyWage);
  assert.ok(civicWorkers(site()) <= staff.slots); // firms hire first, so the venue may be short-staffed again by now
  for (const a of site().staffing!.allocations) {
    const h = c.households.find(h => h.id === a.householdId)!;
    assert.ok(householdWorkerCount(c, h.id) <= h.workforce, 'a worker holds one job');
  }
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0, 'money is conserved');
});

test('households in reach pay the fee from their own wallet, one venue a day, within what the staff can serve', () => {
  const { c, site } = venueCity('restaurant', 12), staff = CIVIC.restaurant.staff!, reason = civicFeeReason('restaurant', site().id);
  const visits = c.ledger.filter(e => e.reason === reason);
  assert.ok(visits.length > 0, 'somebody visited');
  for (const e of visits) { assert.match(e.from, /^household:\d+$/); assert.equal(e.to, 'treasury'); assert.equal(e.amount, staff.fee); }
  const perDay = new Map<number, string[]>(); for (const e of visits) perDay.set(e.tick, [...perDay.get(e.tick) ?? [], e.from]);
  for (const [, wallets] of perDay) { assert.ok(wallets.length <= staff.slots * staff.visitsPerWorker); assert.equal(new Set(wallets).size, wallets.length, 'one visit per household per day'); }
});

test('a venue gives happiness only while someone works there, and removing it pays what was earned', () => {
  const { c, site, cell } = venueCity('nightmarket', 5);
  const home = c.buildings.find(b => b.zone === 'R' && distance(b.cell, cell) <= CIVIC.nightmarket.radius)!.cell;
  assert.equal(civicCoverage(c, home, distance).nightmarket, true);
  const staffing = site().staffing!, kept = staffing.allocations; staffing.allocations = [];
  assert.equal(civicCoverage(c, home, distance).nightmarket, false, 'closed without staff');
  staffing.allocations = kept;
  const owed = civicPayroll(site()), id = site().id; assert.ok(owed > 0);
  const entries = c.ledger.length; assert.equal(bulldoze(c, cell).ok, true);
  assert.equal(c.ledger.slice(entries).filter(e => e.reason === civicWageReason('nightmarket', id)).reduce((n, e) => n + e.amount, 0), owed);
  assert.equal(c.households.some(h => venueEmploymentForHousehold(c, h.id).length > 0), false);
  const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved);
});

test('venue staffing in a save is checked: unknown households, too many workers and staffing on other kinds are refused', () => {
  const { c, site } = venueCity('cinema', 3), bad = (mutate: (d: City) => void, why: string) => { const d = JSON.parse(serialize(c)); mutate(d); assert.throws(() => deserialize(JSON.stringify(d)), /Invalid civic save|Unsupported or corrupt CityManager save/, why); };
  const at = (d: City) => d.civic!.sites.find(s => s.id === site().id)!;
  assert.ok(site().staffing?.allocations.length, 'the fixture has staff to tamper with');
  // The untouched save loads, so each refusal below comes from its own change.
  { const d = JSON.parse(serialize(c)); assert.equal(serialize(deserialize(JSON.stringify(d))), serialize(c)); }
  bad(d => { at(d).staffing!.allocations.push({ householdId: 999_999, skill: 'general', workers: 1 }); }, 'unknown household');
  bad(d => { at(d).staffing!.allocations[0].workers = 99; }, 'too many workers');
  bad(d => { (at(d) as { kind: string }).kind = 'clinic'; }, 'staffing on a kind without staff');
});

test('a leased venue pays its staff daily from the operator, takes fees into the operator wallet and pays the city rent', () => {
  const { c, site } = venueCity('cinema', 3), staff = CIVIC.cinema.staff!, id = site().id;
  const candidate = venueLeaseCandidate(c, site())!; assert.ok(candidate, 'a household can afford the lease');
  const r = leaseVenue(c, id); assert.equal(r.ok, true, r.message);
  assert.deepEqual(site().operator, { householdId: candidate.id, since: c.tick });
  assert.deepEqual(site().staffing?.workDays ?? {}, {}, 'city wages owed were settled at the hand-over');
  assert.equal(leaseVenue(c, id).ok, false, 'one operator at a time');
  const wallet = candidate.wallet, start = c.tick;
  for (let i = 0; i < MONTH + 2; i++) { step(c); const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved, `day ${i}`); }
  const rows = c.ledger.filter(e => e.tick > start);
  const wages = rows.filter(e => e.reason === civicDailyWageReason('cinema', id)), fees = rows.filter(e => e.reason === civicFeeReason('cinema', id));
  for (const e of wages) { assert.equal(e.from, wallet); assert.notEqual(e.to, wallet); assert.equal(e.amount % staff.dailyWage, 0); }
  for (const e of fees) { assert.equal(e.to, wallet); assert.notEqual(e.from, wallet); }
  assert.equal(rows.filter(e => e.reason === civicUpkeepReason('cinema', id)).length, 0, 'the city stops paying upkeep');
  const rent = rows.filter(e => e.reason === civicRentReason('cinema', id)); assert.ok(rent.length >= 1); for (const e of rent) { assert.equal(e.from, wallet); assert.equal(e.to, 'treasury'); }
  assert.ok(c.households.some(h => h.id === candidate.id), 'the operator household stays');
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0, 'money is conserved');
  assert.equal(endVenueLease(c, id).ok, true); assert.equal(site().operator, undefined);
  const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved);
});

test('a lease in a save is checked: unknown household, a household running two venues, a lease with unpaid days and a lease on a service are refused', () => {
  const { c, site } = venueCity('cinema', 3); assert.equal(leaseVenue(c, site().id).ok, true); step(c);
  const bad = (mutate: (d: City) => void, why: string) => { const d = JSON.parse(serialize(c)); mutate(d); assert.throws(() => deserialize(JSON.stringify(d)), /Invalid civic save/, why); };
  const at = (d: City) => d.civic!.sites.find(s => s.id === site().id)!;
  assert.equal(serialize(deserialize(serialize(c))), serialize(c), 'the untouched lease loads');
  bad(d => { at(d).operator!.householdId = 999_999; }, 'unknown household');
  bad(d => { at(d).operator!.since = d.tick + 1; }, 'lease in the future');
  bad(d => { at(d).staffing = { allocations: at(d).staffing?.allocations ?? [], workDays: { 'household:1': 1 } }; }, 'unpaid days under a lease');
  bad(d => { (at(d) as { kind: string }).kind = 'clinic'; }, 'lease on a service');
  bad(d => { const other = { ...at(d), id: d.nextId - 1 }; delete (other as { staffing?: unknown }).staffing; d.civic!.sites.push(other); }, 'second venue for the same household');
});
