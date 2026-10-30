import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, buildRoad, buildParallelRoad, bulldoze, SIZE, type City } from '../src/sim.ts';
import { busStopAt, busStopSides } from '../src/bus/buildings.ts';
import { BusEngine } from '../src/bus/engine.ts';
import { connectPresentedBusEvents, getBusLiveSource, setBusLiveReader } from '../src/bus/live.ts';
import { createBusLine } from '../src/bus/lines.ts';
import { buildBusDepot, buildBusStop, busDepotReason, busStopSiteReason, defaultBusStopSide } from '../src/bus/placement.ts';
import {
  beginLineEdit, bulldozeGuarded, busPanelModel, busRemovalImpact, busToolPreview, chooseSide, commitDepotRemoval, commitDraft, commitStopRemoval, emptyBusUi, placeBusStop, previewLine, tapLineStop, upgradeLine,
} from '../src/bus/player.ts';
import { paintBusComposer, paintBusPanel } from '../src/bus/panel.ts';
import { busEnabled, type BusStopSide } from '../src/bus/types.ts';

const at = (x: number, y: number) => y * SIZE + x;
const city = () => createCity(61025);
const stopCell = (c: City) => {
  for (let i = 0; i < c.cells.length; i++) if (busStopSiteReason(c, i, defaultBusStopSide(c, i), true) === null) return i;
  throw new Error('no stop cell');
};
const depotCell = (c: City) => {
  for (let i = 0; i < c.cells.length; i++) if (busDepotReason(c, i, true) === null) return i;
  throw new Error('no depot cell');
};
const farStop = (c: City, from: number) => {
  for (let i = 0; i < c.cells.length; i++) {
    const far = Math.abs(i % SIZE - from % SIZE) + Math.abs(Math.floor(i / SIZE) - Math.floor(from / SIZE)) >= 2;
    if (far && busStopSiteReason(c, i, defaultBusStopSide(c, i), true) === null) return i;
  }
  throw new Error('no second stop');
};

test('flag off: placement, drafts and the panel stay inert', () => {
  const c = city(), cell = stopCell(c);
  assert.equal(busEnabled(), false);
  assert.equal(placeBusStop(c, cell, null).ok, false);
  assert.equal(c.bus, undefined);
  assert.equal(busToolPreview(c, 'bus-stop', cell, emptyBusUi())?.label, 'ระบบรถเมล์ยังไม่เปิดใช้');
  assert.equal(busPanelModel(c).enabled, false);
  assert.equal(commitDraft(c, emptyBusUi()).result.ok, false);
  assert.equal(upgradeLine(c, 1).ok, false);
});

test('stop tool repeats the placement reason: straight road, junction, side, spacing', () => {
  const c = city(), cell = stopCell(c), state = emptyBusUi();
  const ok = busToolPreview(c, 'bus-stop', cell, state, true);
  assert.equal(ok?.ok, true);
  assert.match(ok!.label, /วางป้ายฝั่ง/);
  const placed = placeBusStop(c, cell, null, true);
  assert.equal(placed.ok, true, placed.message);
  const beside = [cell - 1, cell + 1].find(i => c.cells[i]?.road);
  assert.ok(beside !== undefined);
  const crowded = busToolPreview(c, 'bus-stop', beside!, state, true);
  assert.equal(crowded?.ok, false);
  assert.equal(crowded?.label, busStopSiteReason(c, beside!, defaultBusStopSide(c, beside!), true));
  assert.match(crowded!.label, /2 ช่อง/);
  let other = -1;
  for (let i = 1; i < c.cells.length - 1; i++) {
    const spaced = Math.abs(i % SIZE - cell % SIZE) + Math.abs(Math.floor(i / SIZE) - Math.floor(cell / SIZE)) >= 2;
    const straight = c.cells[i - 1]?.road && c.cells[i + 1]?.road && i % SIZE !== 0;
    if (spaced && straight && busStopSiteReason(c, i, defaultBusStopSide(c, i), true) === null) { other = i; break; }
  }
  assert.ok(other >= 0);
  const directed = buildParallelRoad(c, other - 1, other + 1, true);
  assert.equal(directed.ok, true, directed.message);
  const side = defaultBusStopSide(c, other)!;
  const wrong = ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[side];
  const refused = placeBusStop(c, other, wrong, true);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /ทิศทาง|ด้าน/);
  const branch = [cell - SIZE, cell + SIZE].find(i => i >= 0 && i < SIZE * SIZE && !c.cells[i].road && !c.cells[i].building);
  assert.ok(branch !== undefined);
  const built = buildRoad(c, cell, branch!);
  assert.equal(built.ok, true, built.message);
  let junction = -1;
  for (let i = 0; i < c.cells.length; i++) {
    const sides = busStopSides(c, i, SIZE);
    if ('reason' in sides && /ทางแยก|หัวมุม/.test(sides.reason)) { junction = i; break; }
  }
  assert.ok(junction >= 0, 'a branch should refuse the stop');
  const blocked = busToolPreview(c, 'bus-stop', junction, state, true);
  assert.equal(blocked?.ok, false);
  assert.equal(blocked?.label, busStopSiteReason(c, junction, 'n', true));
  assert.match(blocked!.label, /ทางแยก|หัวมุม|ถนน/);
});

test('line tool clicks stops in order and surfaces create, edit and delete messages', () => {
  const c = city();
  assert.ok(buildBusDepot(c, depotCell(c), true).ok);
  const a = stopCell(c); assert.ok(buildBusStop(c, a, undefined, true).ok);
  const b = farStop(c, a); assert.ok(buildBusStop(c, b, undefined, true).ok);
  let state = emptyBusUi();
  const first = tapLineStop(c, state, a, true); state = first.state;
  assert.equal(first.ok, true); assert.deepEqual(state.draft.stopIds, [c.bus!.stops[0].id]);
  const repeat = tapLineStop(c, state, a, true);
  assert.equal(repeat.ok, false); assert.match(repeat.message, /ห้ามใส่ป้ายเดียวกันติดกัน/); assert.equal(repeat.state, state);
  const second = tapLineStop(c, state, b, true); state = second.state;
  assert.match(second.message, /สร้างได้|2 ป้าย|คัน/);
  const created = commitDraft(c, state, true);
  assert.equal(created.result.ok, true, created.result.message);
  assert.match(created.result.message, /สร้างสายรถเมล์/);
  const id = created.result.id!;
  state = beginLineEdit(c, created.state, id);
  state = tapLineStop(c, state, b, true).state;
  state = tapLineStop(c, state, a, true).state;
  const edited = commitDraft(c, state, true);
  assert.equal(edited.result.ok, true, edited.result.message);
  assert.match(edited.result.message, /แก้สายรถเมล์/);
  assert.deepEqual(c.bus!.lines[0].stopIds, [c.bus!.stops[1].id, c.bus!.stops[0].id]);
  const over = previewLine(c, { ...emptyBusUi().draft, stopIds: c.bus!.stops.map(s => s.id), busCount: 99, depotId: c.bus!.depots[0].id, editing: null });
  assert.equal(over.ok, false); assert.match(over.message, /จุได้/);
  const removed = commitDraft(c, { side: null, draft: { stopIds: [c.bus!.stops[0].id], depotId: c.bus!.depots[0].id, busCount: 1, busLevel: 1, editing: null } }, true);
  assert.match(removed.result.message, /อย่างน้อย 2 ป้าย/);
  assert.equal(c.bus!.lines.length, 1);
});

test('panel shows routes, depot load, fleet, headway and display-only fare', () => {
  const c = city();
  assert.ok(buildBusDepot(c, depotCell(c), true).ok);
  const a = stopCell(c), b = farStop(c, a);
  assert.ok(buildBusStop(c, a, undefined, true).ok); assert.ok(buildBusStop(c, b, undefined, true).ok);
  assert.ok(createBusLine(c, { depotId: c.bus!.depots[0].id, stopIds: c.bus!.stops.map(s => s.id), busCount: 2, busLevel: 1 }).ok);
  const model = busPanelModel(c, true, null, []);
  assert.equal(model.depots[0].capacity, 6); assert.equal(model.depots[0].assigned, 2); assert.equal(model.depots[0].free, 4);
  assert.match(model.depots[0].label, /ใช้ 2\/6/);
  const line = model.lines[0];
  assert.equal(line.statusLabel, 'วิ่ง'); assert.equal(line.reasonLabel, null);
  assert.equal(line.busCount, 2); assert.equal(line.runningBuses, 2);
  assert.ok(line.headwayMinutes! > 0); assert.match(line.headwayLabel, /หัวคิว/);
  assert.match(line.stopsLabel, /#/);
  assert.ok(line.display.some(row => row.includes('ยังไม่เก็บเงิน')));
  assert.match(line.upgradeLabel ?? '', /ยกระดับเป็นระดับ 2/);
  assert.match(line.upgradeLabel ?? '', /ยังไม่เก็บเงิน/);
  c.bus!.depots[0].open = false;
  const paused = busPanelModel(c, true, null, []);
  assert.equal(paused.lines[0].status, 'suspended'); assert.equal(paused.lines[0].statusLabel, 'หยุดชั่วคราว');
  assert.equal(paused.lines[0].reason, 'depotClosed'); assert.match(paused.lines[0].reasonLabel ?? '', /อู่ปิด/);
  assert.equal(paused.lines[0].headwayMinutes, null);
});

test('upgrade button path writes bus level only and keeps fare display-only', () => {
  const c = city();
  assert.ok(buildBusDepot(c, depotCell(c), true).ok);
  const a = stopCell(c), b = farStop(c, a);
  assert.ok(buildBusStop(c, a, undefined, true).ok); assert.ok(buildBusStop(c, b, undefined, true).ok);
  const lineId = createBusLine(c, { depotId: c.bus!.depots[0].id, stopIds: c.bus!.stops.map(s => s.id), busCount: 1, busLevel: 1 }).id!;
  const before = structuredClone(c.bus);
  const raised = upgradeLine(c, lineId, true);
  assert.equal(raised.ok, true);
  if (raised.ok) assert.match(raised.message, /ระดับ 2/);
  assert.equal(c.bus!.lines[0].busLevel, 2);
  assert.equal(c.bus!.lines[0].busCount, before!.lines[0].busCount);
  assert.deepEqual(c.bus!.depots, before!.depots);
  assert.equal(upgradeLine(c, lineId, false).ok, false);
  assert.equal(c.bus!.lines[0].busLevel, 2);
});

test('deleting a stop or depot warns and lists lines before anything is removed', async () => {
  const c = city();
  assert.ok(buildBusDepot(c, depotCell(c), true).ok);
  const a = stopCell(c), b = farStop(c, a);
  assert.ok(buildBusStop(c, a, undefined, true).ok); assert.ok(buildBusStop(c, b, undefined, true).ok);
  const lineId = createBusLine(c, { depotId: c.bus!.depots[0].id, stopIds: c.bus!.stops.map(s => s.id), busCount: 1, busLevel: 1 }).id!;
  const stop = c.bus!.stops[0], depot = c.bus!.depots[0];
  const stopImpact = busRemovalImpact(c, stop.cell, 'bulldoze');
  assert.ok(stopImpact); assert.deepEqual(stopImpact!.lineIds, [lineId]); assert.match(stopImpact!.body, new RegExp(`สายที่กระทบ: #${lineId}`));
  let ran = false;
  const cancelled = await bulldozeGuarded(c, stop.cell, true, async () => false, () => { ran = true; return bulldoze(c, stop.cell); });
  assert.equal(cancelled, null); assert.equal(ran, false); assert.ok(busStopAt(c, stop.cell));
  const direct = commitStopRemoval(c, stop.id, false);
  assert.equal(direct.removed, false); assert.match(direct.message, /สายที่กระทบ/); assert.ok(busStopAt(c, stop.cell));
  const depotImpact = busRemovalImpact(c, depot.cell, 'direct');
  assert.match(depotImpact!.body, /อู่สุดท้าย/);
  const refused = commitDepotRemoval(c, depot.id, true);
  assert.equal(refused.removed, false); assert.equal(c.bus!.depots.length, 1); assert.equal(c.bus!.lines[0].id, lineId);
  let confirms = 0;
  await bulldozeGuarded(c, stop.cell, false, async () => { confirms++; return false; }, cell => ({ ok: true, message: `run ${cell}` }));
  assert.equal(confirms, 0, 'flag off keeps the old silent bulldoze');
  const gone = commitStopRemoval(c, stop.id, true);
  assert.equal(gone.removed, true); assert.match(gone.message, /ลบป้าย/); assert.equal(busStopAt(c, stop.cell), undefined);
  assert.ok(!c.bus!.lines[0].stopIds.includes(stop.id));
});

test('live read uses snapshot, waiting, detail and totals and never drains events', async () => {
  const c = city();
  assert.ok(buildBusDepot(c, depotCell(c), true).ok);
  const a = stopCell(c), b = farStop(c, a);
  assert.ok(buildBusStop(c, a, undefined, true).ok); assert.ok(buildBusStop(c, b, undefined, true).ok);
  const lineId = createBusLine(c, { depotId: c.bus!.depots[0].id, stopIds: c.bus!.stops.map(s => s.id), busCount: 2, busLevel: 1 }).id!;
  const engine = new BusEngine(c, 5 * 60);
  engine.advanceTo(6 * 60);
  engine.submit([{ requestId: 'p', purpose: 'commute', from: 0, to: 1, persons: 4, lineId, fromStopId: c.bus!.stops[0].id, toStopId: c.bus!.stops[1].id, fareSatang: 30 }]);
  const seen: string[] = [];
  const read = {
    snapshot: (minute?: number) => { seen.push('snapshot'); return engine.snapshot(minute); },
    busesDetail: () => { seen.push('detail'); return engine.busesDetail(); },
    waitingAt: (id: number) => { seen.push('wait'); return engine.waitingAt(id); },
    get totals() { seen.push('totals'); return engine.totals; },
    drainEvents: () => { seen.push('drain'); return []; },
  };
  const pending = engine.pendingEvents;
  const model = busPanelModel(c, true, read, []);
  assert.equal(engine.pendingEvents, pending);
  assert.deepEqual(seen.filter(name => name === 'drain'), []);
  assert.ok(seen.includes('snapshot') && seen.includes('detail') && seen.includes('wait') && seen.includes('totals'));
  assert.equal(model.lines[0].live?.seen, 2);
  assert.equal(model.totals?.accepted, 4);
  assert.equal(model.stops.find(stop => stop.id === c.bus!.stops[0].id)?.waiting, 4);
  assert.ok((model.waiting ?? 0) >= 4);
  const noted = busPanelModel(c, true, null, [{ kind: 'board', busId: 'bus-1', lineId, stopId: c.bus!.stops[0].id, cell: a, minute: 360, persons: 4 }]);
  assert.match(noted.boardNote ?? '', /ขึ้น 4 คน/);
  const pendingAfter = engine.pendingEvents;
  setBusLiveReader(() => read);
  assert.equal(getBusLiveSource(), read);
  const stop = await connectPresentedBusEvents();
  assert.equal(stop, null, 'frame.ts is owned by PR #134; this build only subscribes when it is present');
  assert.equal(engine.pendingEvents, pendingAfter);
  assert.deepEqual(seen.filter(name => name === 'drain'), []);
  setBusLiveReader(() => null);
});

test('panel and composer buttons are touch targets and call the handlers', () => {
  const c = city();
  assert.ok(buildBusDepot(c, depotCell(c), true).ok);
  const a = stopCell(c), b = farStop(c, a);
  assert.ok(buildBusStop(c, a, undefined, true).ok); assert.ok(buildBusStop(c, b, undefined, true).ok);
  assert.ok(createBusLine(c, { depotId: c.bus!.depots[0].id, stopIds: c.bus!.stops.map(s => s.id), busCount: 1, busLevel: 1 }).ok);
  const doc = fakeDocument();
  const host = doc.createElement('section'); host.ownerDocument = doc;
  const upgraded: number[] = [], removed: number[] = [];
  paintBusPanel(host, busPanelModel(c, true, null, []), {
    onUpgrade: id => upgraded.push(id), onDeleteLine: () => {}, onEditStops: () => {}, onBusCount: () => {},
    onDeleteStop: id => removed.push(id), onDeleteDepot: () => {}, onFocus: () => {}, onClose: () => {},
  });
  const buttons = walk(host).filter(node => node.tag === 'button');
  assert.ok(buttons.length >= 4);
  assert.ok(buttons.every(node => node.className.includes('bus-touch')));
  const upgrade = buttons.find(node => node.dataset.action === 'upgrade')!;
  assert.match(upgrade.textContent, /ยังไม่เก็บเงิน/);
  upgrade.click(); assert.deepEqual(upgraded, [c.bus!.lines[0].id]);
  const drop = buttons.find(node => node.dataset.action === 'delete-stop')!;
  drop.click(); assert.deepEqual(removed, [c.bus!.stops[0].id]);
  const composer = doc.createElement('div'); composer.ownerDocument = doc;
  const sides: (BusStopSide | null)[] = [];
  paintBusComposer(composer, { mode: 'stop', message: 'เลือกฝั่ง', side: 'n', stops: [], depots: [], busCount: 1, commitLabel: '' }, {
    onSide: side => sides.push(side), onUndo: () => {}, onClear: () => {}, onCommit: () => {}, onDepot: () => {}, onCount: () => {},
  });
  const north = walk(composer).find(node => node.dataset.side === 'n')!;
  assert.equal(north.getAttribute('aria-pressed'), 'true');
  north.click(); assert.deepEqual(sides, ['n']);
  assert.equal(chooseSide(emptyBusUi(), 'e').side, 'e');
  const css = readFileSync('src/bus/player.css', 'utf8');
  assert.match(css, /min-height:\s*44px/); assert.match(css, /touch-action:\s*manipulation/);
});

test('the dock button is hidden until the flag is on, and this PR does not drain events or draw routes', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /id="bus-tool"[^>]*hidden/);
  const files = ['src/bus/player.ts', 'src/bus/panel.ts', 'src/bus/menu.ts', 'src/bus/mount.ts', 'src/bus/live.ts', 'src/main.ts', 'src/renderer.ts'];
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /\.drainEvents\s*\(/, file);
  const renderer = readFileSync('src/renderer.ts', 'utf8');
  assert.match(renderer, /bus-stop/);
  assert.doesNotMatch(renderer, /busLineRoutes|polyline/);
  const main = readFileSync('src/main.ts', 'utf8');
  assert.match(main, /bulldozeGuarded/); assert.match(main, /busEnabled\(/);
  assert.match(main, /trafficLayer\?\.bus\?\.engine/);
  assert.match(readFileSync('src/bus/live.ts', 'utf8'), /subscribeBusEvents/);
  assert.doesNotMatch(readFileSync('src/bus/player.ts', 'utf8'), /validateBus|traffic\/bridge|src\/traffic\/layer|src\/traffic\/clock/);
});

type Fake = {
  tag: string; className: string; textContent: string; hidden: boolean; disabled: boolean; type: string; ownerDocument: FakeDoc;
  dataset: Record<string, string>; children: Fake[]; listeners: Map<string, (() => void)[]>;
  append: (...nodes: Fake[]) => void; replaceChildren: (...nodes: Fake[]) => void;
  setAttribute: (name: string, value: string) => void; getAttribute: (name: string) => string | undefined; click: () => void;
};
type FakeDoc = { createElement: (tag: string) => Fake };
function fakeDocument(): FakeDoc {
  const doc = { createElement(tag: string): Fake {
    const node = {
      tag, className: '', textContent: '', hidden: false, disabled: false, type: '', ownerDocument: doc, dataset: {}, children: [] as Fake[],
      listeners: new Map<string, (() => void)[]>(), attributes: new Map<string, string>(),
      append(...nodes: Fake[]) { for (const child of nodes) this.children.push(child); },
      replaceChildren(...nodes: Fake[]) { this.children = []; this.append(...nodes); },
      setAttribute(name: string, value: string) { this.attributes.set(name, value); },
      getAttribute(name: string) { return this.attributes.get(name); },
      addEventListener(name: string, listener: () => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); },
      click() { if (this.disabled) return; for (const listener of this.listeners.get('click') ?? []) listener(); },
    };
    return node as Fake;
  } };
  return doc;
}
function walk(node: Fake, out: Fake[] = []) { out.push(node); for (const child of node.children) walk(child, out); return out; }
