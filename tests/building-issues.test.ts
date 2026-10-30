import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, buildRoad, buildCampus, buildPark, buildPlant, GATEWAY, SIZE, toggleCampus, type City } from '../src/sim.ts';
import { buildingIssues, buildingIssueRevision, issuePlaceRoute, ISSUE_PRIORITY } from '../src/building-issues.ts';
import { RETAIL_MAX_LEVEL } from '../src/retail-capacity.ts';
import { initialCampusReport, educationLevel } from '../src/education.ts';
import { visibleIssueCells } from '../src/building-issue-layout.ts';
import { bindIssueInput, issueGesture } from '../src/building-issue-input.ts';

function fixture(zone: 'R' | 'C' | 'I' | 'F' = 'I'): City {
  const c = createCity(5, { starter: false }); buildRoad(c, GATEWAY, GATEWAY + 8);
  const b = { id: 100, cell: GATEWAY + 2 - SIZE, zone, level: zone === 'C' ? 2 : 1, age: 0, ...(zone === 'R' ? { housingType: 'cottage' as const } : {}) };
  c.buildings.push(b); c.cells[b.cell].building = b.id; c.cells[b.cell].zone = zone;
  if (zone !== 'R') c.firms.push({ id: 101, building: b.id, zone, wallet: 'firm:101', inventory: 0, products: { 'milled-rice': 0, 'canned-food': 0, sugar: 0 }, crops: { rice: 0, vegetables: 0, sugarcane: 0 }, cropInventory: 0, cropCost: 0, productionTick: 0, profit: 0, monthlyRevenue: 0, monthlyExpense: 0, lastMonthProfit: 0, workDays: {}, ...(zone === 'I' ? { recipe: 'rice-mill' } : {}), ...(zone === 'C' ? { commercialKind: 'retail' as const } : {}) } as City['firms'][number]);
  c.accounts['firm:101'] = 100_000; return c;
}
const facts = (c: City, cell = c.buildings[0].cell) => buildingIssues(c).find(i => i.cell === cell)?.details ?? [];

test('deterministic priority groups multiple causes into one badge with a remaining count', () => {
  const c = fixture(); c.utilities.outside = { power: 0, water: 0 };
  const before = JSON.stringify(c), issues = buildingIssues(c), at = issues.find(i => i.cell === c.buildings[0].cell)!;
  assert.deepEqual(at.details.map(f => f.kind), ['no-power', 'no-water', 'no-workers', 'no-input']);
  assert.equal(at.kind, 'no-power'); assert.equal(at.remaining, 3); assert.equal(issues.length, 1);
  assert.deepEqual(ISSUE_PRIORITY.slice(0, 4), ['no-road', 'no-power', 'no-water', 'no-utilities']);
  assert.equal(JSON.stringify(c), before, 'reason computation never steps, trades, pays or writes saves');
});

test('utility facts use actual per-building demand, clear and reappear in the same paused tick', () => {
  const c = fixture(); c.utilities.outside.power = 0;
  const first = facts(c).find(f => f.kind === 'no-power')!;
  assert.equal(first.current, 0); assert.equal(first.required, 3); assert.match(first.detail, /0\/3/);
  const revision = buildingIssueRevision(c); c.utilities.outside.power = 20;
  assert.notEqual(buildingIssueRevision(c), revision); assert.ok(!facts(c).some(f => f.kind === 'no-power'));
  c.utilities.outside.power = 0; assert.deepEqual(facts(c).find(f => f.kind === 'no-power'), first);
  c.cells[GATEWAY].road = false;
  assert.equal(buildingIssues(c)[0].kind, 'no-road'); assert.ok(!facts(c).some(f => ['no-power', 'no-water'].includes(f.kind)), 'road outage is not a fabricated resource shortage');
});

test('farms, homes, shops, plants and parks only report their actual supported needs', () => {
  const farm = fixture('F'); farm.utilities.outside = { power: 0, water: 0 };
  assert.ok(!facts(farm).some(f => f.kind === 'no-power')); assert.equal(facts(farm).find(f => f.kind === 'no-water')?.required, 1);
  const home = fixture('R'); home.utilities.outside = { power: 0, water: 0 }; assert.deepEqual(facts(home), [], 'empty new home draws zero utilities');
  const shop = fixture('C'); assert.equal(facts(shop).find(f => f.kind === 'no-stock')?.required, 1);
  const c = createCity(7, { starter: false }); assert.ok(buildPark(c, 1).ok); c.plants.push({ id: 200, cell: 2, kind: 'water', tick: 0 });
  assert.deepEqual(facts(c, 1).map(f => f.kind), ['no-workers']); assert.deepEqual(facts(c, 2).map(f => f.kind), ['no-road']);
});

test('factory input names its recipe crop and actual batch requirement, not other crop totals', () => {
  const c = fixture(), f = c.firms[0]; f.crops.rice = 1; f.crops.vegetables = 10; f.cropInventory = 11;
  const input = facts(c).find(f => f.kind === 'no-input')!; assert.equal(input.current, 1); assert.equal(input.required, 2); assert.match(input.detail, /ข้าว 1\/2/);
  f.crops.rice = 2; assert.ok(!facts(c).some(f => f.kind === 'no-input'));
});

test('school pause is intentional inactivity; stale report does not override open or level/actual staff', () => {
  const c = fixture('R'), cell = GATEWAY + 4 - SIZE; assert.ok(buildCampus(c, cell, 'school').ok);
  const campus = c.education!.campuses[0]; campus.level = 2; campus.report = initialCampusReport('school', 1); campus.contract = 1;
  campus.report.localStaff = 99; campus.report.requiredStaff = 99;
  const row = facts(c, cell).find(f => f.kind === 'no-workers')!; assert.equal(row.current, 1); assert.equal(row.required, educationLevel('school', 2).staff);
  const tick = c.tick; toggleCampus(c, campus.id); assert.deepEqual(facts(c, cell).map(f => f.kind), ['paused']); assert.equal(facts(c, cell)[0].tone, 'inactive');
  toggleCampus(c, campus.id); assert.equal(facts(c, cell)[0].kind, 'no-workers'); assert.equal(c.tick, tick);
});

test('future growth stays separate from current operation and missing education is not invented', () => {
  const c = fixture('R'); c.buildings[0].level = 3; c.buildings[0].age = 30;
  const future = facts(c).find(f => f.kind === 'education')!; assert.equal(future.tone, 'upgrade'); assert.match(future.detail, /ไม่ใช่การหยุดทำงานวันนี้/); assert.match(future.detail, /0\/1/); assert.equal(future.current, 0); assert.equal(future.required, 1);
  delete c.education; const without = facts(c).find(f => f.kind === 'upgrade')!; assert.doesNotMatch(without.detail, /ผู้ถือวุฒิ|การศึกษา/);
  const missing = fixture(); missing.firms = []; assert.ok(facts(missing).some(f => f.kind === 'missing-data')); assert.ok(!facts(missing).some(f => ['no-workers', 'no-input'].includes(f.kind)));
});

test('unchanged meaningful state reuses the same issue result; staff, treasury and service edits invalidate', () => {
  const c = fixture(); assert.equal(buildingIssues(c), buildingIssues(c));
  for (const mutate of [() => { c.accounts.treasury++; }, () => { c.firms[0].crops.rice++; }, () => { c.education!.schoolReadyDays++; }]) {
    const before = buildingIssues(c); mutate(); assert.notEqual(buildingIssues(c), before);
  }
});

test('badge gesture distinguishes tap, drag, cancellation, multitouch and blocked tool without model mutation', () => {
  const c = fixture(), before = JSON.stringify(c), pans: number[][] = [], routes: number[] = []; let allowed = true;
  const gesture = issueGesture((x, y) => pans.push([x, y]), () => routes.push(c.buildings[0].cell), () => allowed);
  const p = (x: number, y = 0, pointerId = 1) => ({ clientX: x, clientY: y, pointerId, button: 0 });
  gesture.start(p(0)); gesture.end(p(3)); assert.deepEqual(routes, [c.buildings[0].cell]);
  gesture.start(p(0)); gesture.move(p(8)); gesture.move(p(11)); gesture.end(p(11)); assert.deepEqual(pans, [[8, 0], [3, 0]]); assert.equal(routes.length, 1);
  gesture.start(p(0)); gesture.end(p(9)); assert.equal(routes.length, 1, 'large release displacement is not a tap');
  gesture.start(p(0)); gesture.cancel(); gesture.end(p(0)); assert.equal(routes.length, 1);
  gesture.start(p(0)); gesture.start(p(0, 0, 2)); gesture.end(p(0)); assert.equal(routes.length, 1);
  gesture.start(p(0)); allowed = false; gesture.end(p(0)); assert.equal(routes.length, 1); assert.equal(gesture.start(p(0)), false);
  assert.equal(JSON.stringify(c), before);
});

test('integration routes badge activation to the existing inspector and preserves accessible touch targets', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), css = readFileSync(new URL('../src/building-issues.css', import.meta.url), 'utf8'), markers = readFileSync(new URL('../src/map-markers.ts', import.meta.url), 'utf8');
  assert.match(main, /new MapMarkers\(view, cell =>/); assert.match(main, /const next = issuePlaceRoute\(city, cell\); if \(next\) \{[\s\S]*?openRoute\(next\)/);
  assert.match(main, /renderBuildingIssues\(city, route\?\.page === 'place'/); assert.match(css, /width: 44px; height: 44px/);
  assert.match(markers, /setAttribute\('aria-label'/); assert.match(markers, /setAttribute\('aria-controls', 'inspector'\)/); assert.match(markers, /Cull BEFORE/);
  assert.doesNotMatch(markers, /activate\(|onCell\(|dispatchEvent\(/, 'does not route through citizen/build command picking');
});


test('live school utility allocator, not stale reports, drives exact values while paused', () => {
  const c = fixture('R'), a = GATEWAY + 4 - SIZE, b = GATEWAY + 5 - SIZE;
  assert.ok(buildCampus(c, a, 'school').ok); assert.ok(buildCampus(c, b, 'school').ok); c.utilities.outside = { power: 1, water: 1 };
  const campus = c.education!.campuses[0];
  assert.ok(!facts(c, a).some(f => f.kind === 'no-power')); assert.equal(facts(c, b).find(f => f.kind === 'no-power')?.required, 1);
  toggleCampus(c, campus.id); assert.equal(facts(c, a)[0].kind, 'paused'); assert.ok(!facts(c, b).some(f => f.kind === 'no-power'));
  toggleCampus(c, campus.id); assert.equal(facts(c, b).find(f => f.kind === 'no-power')?.current, 0);
});

test('issue route is current place identity, service-safe and read-only; deleted warning is inert', () => {
  const c = fixture(), cell = c.buildings[0].cell, before = JSON.stringify(c);
  assert.deepEqual(issuePlaceRoute(c, cell), { page: 'place', cell, buildingId: 100 }); assert.equal(JSON.stringify(c), before);
  c.buildings = []; c.firms = []; c.cells[cell].building = null; assert.equal(issuePlaceRoute(c, cell), null);
  c.parks.push({ id: 400, cell: 4, tick: 0, level: 1 }); assert.deepEqual(issuePlaceRoute(c, 4), { page: 'place', cell: 4, buildingId: null });
});

test('offscreen markers do not consume visible budget, and overlapping hit areas are culled', () => {
  const points = [...Array.from({ length: 80 }, (_, cell) => ({ cell, x: -100, y: 100, z: 1 })), { cell: 80, x: 50, y: 50, z: 1 }, { cell: 81, x: 70, y: 50, z: 1 }, { cell: 82, x: 150, y: 50, z: 1 }, { cell: 83, x: 250, y: 50, z: -1 }];
  const before = JSON.stringify(points); assert.deepEqual([...visibleIssueCells(points, 390, 844, 2)], [80, 82]); assert.equal(JSON.stringify(points), before);
});

test('badge hit areas preserve normal selection centres, including unbadged neighbouring homes', () => {
  // Exact 360x740 population fixture projection: cell270's raised icon used to
  // intercept the normal home tap for cell269 (also reproduced in landscape).
  const points = [{ cell: 270, x: 180.000, y: 331.146, z: 71.65 }, { cell: 300, x: 80, y: 180, z: 70 }];
  const targets = [{ cell: 269, x: 164.530, y: 345.457, z: 75.26 }];
  const before = JSON.stringify([points, targets]);
  assert.deepEqual([...visibleIssueCells(points, 360, 740, 1, targets)], [300], 'occluded icon does not consume the visible budget');
  assert.deepEqual([...visibleIssueCells([{ cell: 270, x: 422, y: 158.067, z: 39.28 }], 844, 390, 64, [{ cell: 269, x: 407.834, y: 172.526, z: 42.89 }])], []);
  assert.deepEqual([...visibleIssueCells(points, 360, 740, 64, [{ ...targets[0], x: 20 }])], [270, 300], 'camera movement can reveal the icon again');
  assert.equal(JSON.stringify([points, targets]), before, 'culling never changes selection/model data');
});


test('education badges share the canonical one-holder allocator, rather than copying all household diplomas', () => {
  const c = fixture(); c.buildings[0].level = 3; c.buildings[0].age = 60;
  c.buildings.push({ ...c.buildings[0], id: 102, cell: GATEWAY + 3 - SIZE }); c.cells[GATEWAY + 3 - SIZE].building = 102;
  c.firms.push({ ...c.firms[0], id: 103, building: 102, wallet: 'firm:103' }); c.accounts['firm:103'] = 100_000;
  c.education!.people.push({ householdId: 200, basic: 1, higher: 0, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0 });
  c.education!.residentBasic = 1;
  c.education!.sustain = [{ buildingId: 100, days: 30 }, { buildingId: 102, days: 30 }];
  c.employment = [101, 103].map(firmId => ({ householdId: 200, firmId, workers: 1, skill: 'general', occupation: 'manufacturing', rank: 'entry' }));
  const before = JSON.stringify(c);
  assert.ok(!facts(c).some(f => f.kind === 'education'));
  const second = facts(c, GATEWAY + 3 - SIZE).find(f => f.kind === 'education')!; assert.equal(second.current, 0); assert.equal(second.required, 1);
  assert.equal(JSON.stringify(c), before);
});

test('maximum tiers never invent a further education/upgrade gate', () => {
  for (const zone of ['I', 'F', 'C', 'R'] as const) {
    const c = fixture(zone), b = c.buildings[0]; b.age = 60; b.level = zone === 'F' ? 6 : zone === 'C' ? RETAIL_MAX_LEVEL : 9; if (zone === 'R') b.housingType = 'condo';
    assert.ok(!facts(c).some(f => f.kind === 'education' || f.kind === 'upgrade'), zone);
  }
});


test('real badge binder respects capture/target ordering, never re-arms a second pointer, and recovers after release', () => {
  const originalWindow = globalThis.window;
  type Handler = (event: any) => void;
  const globals = new Map<string, Handler[]>(), local = new Map<string, Handler[]>();
  const listenerHost = (map: Map<string, Handler[]>) => ({
    addEventListener: (name: string, fn: Handler) => map.set(name, [...(map.get(name) ?? []), fn]),
    removeEventListener: (name: string, fn: Handler) => map.set(name, (map.get(name) ?? []).filter(item => item !== fn)),
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: listenerHost(globals) });
  const button = { ...listenerHost(local), setPointerCapture() {} } as unknown as HTMLButtonElement;
  const pans: number[][] = []; let activations = 0;
  const dispose = bindIssueInput(button, (x, y) => pans.push([x, y]), () => activations++, () => true);
  const emit = (type: string, pointerId: number, x = 100, target = true, detail = 1) => {
    const event = { type, pointerId, clientX: x, clientY: 100, button: 0, detail, preventDefault() {}, stopPropagation() {} };
    // Actual DOM ordering: window capture first, then the badge target.
    for (const fn of globals.get(type) ?? []) fn(event);
    if (target) for (const fn of local.get(type) ?? []) fn(event);
  };
  try {
    for (const reverse of [false, true]) {
      emit('pointerdown', 1); emit('pointerdown', 2);
      emit('pointerup', reverse ? 1 : 2); emit('pointerup', reverse ? 2 : 1); emit('click', 2);
      assert.equal(activations, 0, 'two pointers on the badge cannot activate in either release order');
    }
    emit('pointerdown', 1, 100, false); emit('pointerdown', 2); emit('pointerup', 1, 100, false); emit('pointerup', 2);
    assert.equal(activations, 0, 'a pointer already on the canvas also prevents a new badge tap');
    emit('pointerdown', 1); emit('pointerdown', 2, 100, false); emit('pointercancel', 2, 100, false); emit('pointerup', 1);
    assert.equal(activations, 0, 'cancelling the outside pointer does not re-arm the first');
    emit('pointerdown', 1); emit('pointercancel', 1); emit('pointerup', 1); assert.equal(activations, 0);
    emit('pointerdown', 1); emit('pointerup', 1); emit('click', 1); assert.equal(activations, 1, 'fresh single tap recovers exactly once');
    emit('pointerdown', 1); emit('pointermove', 1, 112); emit('pointerup', 1, 112); emit('click', 1);
    assert.deepEqual(pans, [[12, 0]]); assert.equal(activations, 1, 'single-pointer drag still pans without activation');
    emit('click', 0, 100, true, 0); assert.equal(activations, 2, 'keyboard/assistive activation stays available');
  } finally {
    dispose(); assert.ok([...globals.values()].every(list => list.length === 0), 'global capture listeners are removed on disposal');
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});


test('issue section sizes the shared span icon wrapper and preserves KPI-first ordinary selection', () => {
  const css = readFileSync(new URL('../src/building-issues.css', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const icon = readFileSync(new URL('../src/ui-icons.ts', import.meta.url), 'utf8');
  assert.match(icon, /function iconElement[\s\S]*?createElement\('span'\)/);
  assert.match(css, /\.bc-issue-row > \.ui-icon \{[^}]*flex: 0 0 23px; width: 23px; height: 23px/);
  assert.match(css, /\.bc-issue-row > div \{[^}]*min-width: 0; overflow-wrap: anywhere/);
  assert.match(main, /\$\('#entity-content'\)\.after\(issueHost\)/);
  assert.match(main, /\$\('#building-issue-details'\)\.scrollIntoView\(\{ block: 'start', inline: 'nearest' \}\)/);
});
