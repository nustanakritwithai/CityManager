import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, buildRoad, bulldoze, zoneCell, deserialize, serialize, GATEWAY, SIZE } from '../src/sim.ts';
import { groupedToolFixture, assertGroupedRowLayout, assertGroupedLabel, groupedRowSwipe, groupedKeyEvents } from './grouped-tool-menu-browser.mjs';
import { createTrafficServerFixture, loadedTrafficSession } from './traffic-server-entry-fixture.mjs';

const cell = (x: number, y: number) => y * SIZE + x;
const selectorFixture = () => {
  const city = createCity(61025, { starter: false });
  assert.equal(buildRoad(city, GATEWAY, cell(10, 12)).ok, true);
  return serialize(city);
};

for (const [name, makeRaw] of [['selector', selectorFixture], ['grouped', groupedToolFixture]] as const) {
  test(`${name} menu uses the migrated live city without changing legacy server bytes or economics`, async () => {
    const raw = makeRaw(), original = deserialize(raw), server = createTrafficServerFixture('http://127.0.0.1:4173/CityManager/');
    const ack = await server.seed(raw), live = loadedTrafficSession(ack.raw).city;
    assert.equal(ack.raw, raw); assert.equal(ack.revision, 1); assert.equal(server.active.raw, raw);
    assert.equal(original.cells.length, 576); assert.equal(live.cells.length, 672);
    assert.deepEqual(live.cells.slice(0, 576), original.cells);
    assert.deepEqual(live.resources.fertility.slice(0, 576), original.resources.fertility);
    const { cells: _oldCells, resources: _oldResources, ...oldState } = original;
    const { cells: _liveCells, resources: _liveResources, ...liveState } = live;
    assert.deepEqual(liveState, oldState, 'Expansion preserves every non-grid field, including exact balances and ledgers');
    assert.equal(original.resources.version, 'fertility-1'); assert.equal(live.resources.version, 'fertility-2');
    assert.equal(live.resources.seed, original.resources.seed);
    assert.notEqual(serialize(live), raw, 'The browser baseline is the validated migrated city, not legacy input bytes');
    const command = name === 'selector' ? (city: typeof live) => bulldoze(city, cell(10, 12)) : (city: typeof live) => zoneCell(city, cell(5, 13), 'C');
    assert.equal(command(original).ok, true); assert.equal(command(live).ok, true);
    assert.equal(serialize(live), serialize(loadedTrafficSession(serialize(original)).city), 'Native-command expectations retain exact placement and accounting after expansion');
    assert.equal(server.active.raw, raw); assert.equal(server.active.revision, 1);
    assert.deepEqual(server.writes, [], 'Deriving live expectations never sends a server write');
  });
}

test('both browser helpers seed original bytes and assert against the actual live migration', () => {
  const selector = readFileSync(new URL('./select-menu-browser.mjs', import.meta.url), 'utf8');
  const grouped = readFileSync(new URL('./grouped-tool-menu-browser.mjs', import.meta.url), 'utf8');
  assert.match(selector, /loadedFixture = serialize\(loadedTrafficSession\(fixture\)\.city\)/);
  assert.match(selector, /assert\.equal\(baseline, loadedFixture\)/);
  assert.match(selector, /const expected = deserialize\(loadedFixture\)/);
  assert.match(selector, /await load\(fixture\)/);
  assert.match(grouped, /raw = groupedToolFixture\(\), fixture = serialize\(loadedTrafficSession\(raw\)\.city\)/);
  assert.equal((grouped.match(/await load\(raw\)/g) ?? []).length, 3);
  assert.doesNotMatch(grouped, /await load\(fixture\)/);
  assert.match(grouped, /const expected = deserialize\(fixture\)/);
});

const serviceTools = ['power', 'water', 'park', 'school', 'university'];
function rowGeometry() {
  const a = { x: 160, y: 700, right: 210, bottom: 750, w: 50, h: 50 };
  const m = { x: 8, y: 644, right: 312, bottom: 694, w: 304, h: 50 };
  return { a, m, width: 320, height: 844, ratio: 1, layout: 'row', direction: 'row', overflowX: 'auto', overflowY: 'hidden', client: 304, scroll: 316, scrollLeft: 0, clientY: 50, scrollY: 50,
    buttons: serviceTools.map((tool, index) => {
      const x = 8 + index * 64, right = x + 60;
      return { tool, x, y: 644, right, bottom: 694, w: 60, h: 50, centerInside: x + 30 < m.right, hit: x + 30 < m.right,
        label: { width: 56, scroll: 56, left: x + 2, right: right - 2, top: 676, bottom: 690, buttonLeft: x, buttonRight: right, buttonTop: 644, buttonBottom: 694 } };
    }),
  };
}

test('grouped browser geometry enforces row contract, bounds, full labels and reachable 44px targets', () => {
  assert.doesNotThrow(() => assertGroupedRowLayout(rowGeometry(), serviceTools));
  for (const [description, mutate] of [
    ['old same-width expectation', (r: ReturnType<typeof rowGeometry>) => { r.buttons[0].w = r.a.w; }],
    ['column layout', (r: ReturnType<typeof rowGeometry>) => { r.layout = 'column'; }],
    ['vertical overflow', (r: ReturnType<typeof rowGeometry>) => { r.overflowY = 'auto'; }],
    ['disabled horizontal scrolling', (r: ReturnType<typeof rowGeometry>) => { r.overflowX = 'hidden'; }],
    ['offscreen menu', (r: ReturnType<typeof rowGeometry>) => { r.m.right = 321; }],
    ['clipped vertical row', (r: ReturnType<typeof rowGeometry>) => { r.scrollY = 60; }],
    ['sub-44px target', (r: ReturnType<typeof rowGeometry>) => { r.ratio = 0.5; }],
    ['blocked visible target', (r: ReturnType<typeof rowGeometry>) => { r.buttons[0].hit = false; }],
    ['clipped whole label', (r: ReturnType<typeof rowGeometry>) => { r.buttons[0].label.scroll = 70; }],
    ['vertical option stack', (r: ReturnType<typeof rowGeometry>) => { r.buttons[1].y += 50; }],
    ['changed gap or order', (r: ReturnType<typeof rowGeometry>) => { r.buttons[1].x += 4; }],
  ] as const) {
    const result = rowGeometry(); mutate(result);
    assert.throws(() => assertGroupedRowLayout(result, serviceTools), undefined, description);
  }
});

test('only the owner-accepted university caption may overflow by up to 4px', () => {
  const result = rowGeometry(), university = result.buttons.at(-1)!;
  Object.assign(university.label, { text: 'มหาวิทยาลัย', width: 47, scroll: 51 });
  assert.doesNotThrow(() => assertGroupedRowLayout(result, serviceTools));

  university.label.scroll = 52;
  assert.throws(() => assertGroupedRowLayout(result, serviceTools), /horizontal overflow/);
  university.label.scroll = 51;
  university.label.bottom = university.label.buttonBottom + 2;
  assert.throws(() => assertGroupedRowLayout(result, serviceTools), /inside its button/);
  university.label.bottom = university.label.buttonBottom - 2;
  Object.assign(university.label, { text: 'different caption' });
  assert.throws(() => assertGroupedRowLayout(result, serviceTools), /horizontal overflow/);

  const other = rowGeometry();
  Object.assign(other.buttons[0].label, { text: 'มหาวิทยาลัย', width: 47, scroll: 51 });
  assert.throws(() => assertGroupedRowLayout(other, serviceTools), /horizontal overflow/);

  // Original 980px desktop layout displayed on a 390px touch screen: six
  // layout pixels occupy less than three physical CSS pixels.
  const scaled = { ...rowGeometry().buttons.at(-1)!.label, text: 'มหาวิทยาลัย', width: 121, scroll: 127 };
  assert.doesNotThrow(() => assertGroupedLabel(scaled, 'university', 390 / 980));
  assert.throws(() => assertGroupedLabel({ ...scaled, scroll: 132 }, 'university', 390 / 980), /horizontal overflow/);
  assert.throws(() => assertGroupedLabel(scaled, undefined, 390 / 980), /horizontal overflow/);
});

test('row swipes remain horizontal and move away from either scroll boundary; native arrows retain correct codes', () => {
  for (const scrollLeft of [0, 12]) {
    const layout = { ...rowGeometry(), scrollLeft }, swipe = groupedRowSwipe(layout);
    assert.equal(swipe.y, layout.m.y + layout.m.h / 2);
    assert.ok(swipe.x + swipe.deltaX > layout.m.x && swipe.x + swipe.deltaX < layout.m.right);
    assert.equal(Math.sign(swipe.deltaX), scrollLeft ? 1 : -1);
  }
  assert.equal(groupedKeyEvents('ArrowLeft')[0].windowsVirtualKeyCode, 37);
  assert.equal(groupedKeyEvents('ArrowRight')[0].windowsVirtualKeyCode, 39);
});

test('browser row checks stay tied to the production menu sizing and horizontal scroll implementation', () => {
  const controller = readFileSync(new URL('../src/grouped-tool-menu.ts', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../src/tool-menu.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/tool-menu.css', import.meta.url), 'utf8');
  const browser = readFileSync(new URL('./grouped-tool-menu-browser.mjs', import.meta.url), 'utf8');
  assert.match(controller, /installToolMenu\(anchor, menu, true, 'row'\)/);
  assert.match(menu, /layout === 'row' \? r\.width \* 1\.2 : r\.width/);
  assert.match(css, /data-layout=row\][^{]*\{[^}]*flex-direction:row;[^}]*overflow-x:auto;[^}]*overflow-y:hidden;/);
  for (const source of ['assertGroupedRowLayout(result, expected)', 'client:m.clientWidth', 'scroll:m.scrollWidth', 'groupedRowSwipe(layout)', 'x:x+deltaX*step/5,y,id:1', '(scrollLeft-layout.scrollLeft)*deltaX<0', "await key('ArrowLeft')", "await key('ArrowRight')", "await key('Home')"]) assert.ok(browser.includes(source), source);
  assert.doesNotMatch(browser, /scrollTop>0|y:y-step\*12/);
});
