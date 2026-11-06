/**
 * Player-facing bus actions (PR B6). Placement, line drafts and the panel read model.
 * Writes go through the existing line/placement APIs. Fare and upkeep come from PR #129
 * and stay display-only. Live rows read snapshot / waitingAt / busesDetail / totals
 * when a live reader is installed. With none, the panel still shows routes.
 * This file never calls drainEvents().
 */
import { SIZE, type City, type Result } from '../sim.ts';
import { busDepotAt, busStopAt } from './buildings.ts';
import { busLevelDisplayLines, busLevelQuote, nextBusLevel, upgradeBusLine } from './level.ts';
import { BusRouteCache, busDepotLoad, busLineRoutes, createBusLine, deleteBusLine, editBusLine, type BusHost, type BusLineRoute, type BusLineSpec, type BusResult, type BusSuspendReason } from './lines.ts';
import { buildBusDepot, buildBusStop, busDepotReason, busStopSiteReason, defaultBusStopSide, removeBusDepot, removeBusStop } from './placement.ts';
import { BUS_DEPOT_BUSES, busEnabled, type BusLevel, type BusLine, type BusStopSide } from './types.ts';
import { getBusLiveSource, lastBusBoardNotes, type BusLiveRead } from './live.ts';

const OFF = 'ระบบรถเมล์ยังไม่เปิดใช้';
const REASON: Record<BusSuspendReason, string> = {
  tooFewStops: 'ป้ายไม่พอให้วิ่ง', noDepot: 'ไม่มีอู่', depotClosed: 'อู่ปิดบริการ', noBuses: 'ไม่มีรถในสาย', unreachable: 'ไปไม่ถึงตามถนน', depotFull: 'อู่เต็ม ความจุไม่พอ',
};
const SIDE: Record<BusStopSide, string> = { n: 'เหนือ', e: 'ตะวันออก', s: 'ใต้', w: 'ตะวันตก' };
const PHASE: Record<string, string> = { home: 'จอดอู่', toStart: 'ออกจากอู่', running: 'ระหว่างป้าย', dwelling: 'จอดที่ป้าย' };

export type LineDraft = { stopIds: number[]; depotId: number | null; busCount: number; busLevel: BusLevel; editing: number | null };
export type BusUiState = { side: BusStopSide | null; draft: LineDraft };
export const emptyBusUi = (): BusUiState => ({ side: null, draft: { stopIds: [], depotId: null, busCount: 1, busLevel: 1, editing: null } });

export type BusPreview = { ok: boolean; cells: { cell: number; ok: boolean }[]; cost: number; label: string };
export type BusRemovalImpact = { kind: 'stop' | 'depot'; id: number; cell: number; lineIds: number[]; title: string; body: string };
export type BusRemovalVia = 'bulldoze' | 'direct';

const coord = (cell: number) => `${(cell % SIZE) + 1},${Math.floor(cell / SIZE) + 1}`;
const ids = (list: number[]) => list.length ? list.map(id => `#${id}`).join(' ') : 'ไม่มีสาย';
const ghost = (host: BusHost): BusHost => ({ cells: host.cells, roadTopology: host.roadTopology, nextId: host.nextId, bus: host.bus ? structuredClone(host.bus) : undefined });
const lineById = (host: BusHost, id: number) => host.bus?.lines.find(line => line.id === id);
const linesForStop = (host: BusHost, stopId: number) => (host.bus?.lines ?? []).filter(line => line.stopIds.includes(stopId)).map(line => line.id).sort((a, b) => a - b);
const linesForDepot = (host: BusHost, depotId: number) => (host.bus?.lines ?? []).filter(line => line.depotId === depotId).map(line => line.id).sort((a, b) => a - b);

export function preferredDepot(host: BusHost, count: number): number | null {
  const load = busDepotLoad(host);
  const ranked = [...load].sort((a, b) => Number(b.open) - Number(a.open) || Number(b.free >= count) - Number(a.free >= count) || b.free - a.free || a.depotId - b.depotId);
  return ranked[0]?.depotId ?? null;
}
function specOf(host: BusHost, draft: LineDraft): BusLineSpec {
  return { depotId: draft.depotId ?? preferredDepot(host, draft.busCount) ?? -1, stopIds: draft.stopIds, busCount: draft.busCount, busLevel: draft.busLevel };
}
/** Validation message from createBusLine / editBusLine on a copy, so the city stays put. */
export function previewLine(host: BusHost, draft: LineDraft): BusResult {
  const copy = ghost(host), spec = specOf(host, draft);
  return draft.editing != null ? editBusLine(copy, draft.editing, spec) : createBusLine(copy, spec);
}
export function draftHint(host: BusHost, draft: LineDraft): string {
  const order = draft.stopIds.map(id => `#${id}`).join(' → ');
  if (!draft.stopIds.length) {
    const current = draft.editing != null ? lineById(host, draft.editing) : undefined;
    return current ? `แก้สาย #${draft.editing} · เดิม ${current.stopIds.map(id => `#${id}`).join(' → ')} · แตะลำดับใหม่` : 'แตะป้ายรถเมล์ตามลำดับที่รถจะจอด';
  }
  if (new Set(draft.stopIds).size < 2) return `ลำดับ ${order} · ต้องมีอย่างน้อย 2 ป้าย`;
  const result = previewLine(host, draft);
  return result.ok ? `${draft.editing != null ? 'บันทึกได้' : 'สร้างได้'} · ${order} · ${draft.busCount} คัน` : result.message;
}

export function chooseSide(state: BusUiState, side: BusStopSide | null): BusUiState { return { ...state, side }; }
export function undoStop(state: BusUiState): BusUiState { return { ...state, draft: { ...state.draft, stopIds: state.draft.stopIds.slice(0, -1) } }; }
export function clearDraft(state: BusUiState): BusUiState { return { ...state, draft: { ...emptyBusUi().draft, depotId: state.draft.depotId, busCount: state.draft.busCount, busLevel: state.draft.busLevel } }; }
export function setDraftDepot(state: BusUiState, depotId: number): BusUiState { return { ...state, draft: { ...state.draft, depotId } }; }
export function setDraftCount(state: BusUiState, busCount: number): BusUiState {
  if (!Number.isSafeInteger(busCount) || busCount < 0) return state;
  return { ...state, draft: { ...state.draft, busCount } };
}
export function beginLineEdit(host: BusHost, state: BusUiState, lineId: number): BusUiState {
  const line = lineById(host, lineId); if (!line) return state;
  return { ...state, draft: { stopIds: [], depotId: line.depotId, busCount: line.busCount, busLevel: line.busLevel, editing: lineId } };
}

export function placeBusDepot(city: City, cell: number, enabled = busEnabled()): Result { return buildBusDepot(city, cell, enabled); }
export function placeBusStop(city: City, cell: number, side: BusStopSide | null, enabled = busEnabled()): Result {
  return buildBusStop(city, cell, side ?? undefined, enabled);
}
/** Append a stop. Adjacent duplicates are refused with the createBusLine message and not stored. */
export function tapLineStop(host: BusHost, state: BusUiState, cell: number, enabled = busEnabled()): { state: BusUiState; message: string; ok: boolean } {
  if (!enabled) return { state, message: OFF, ok: false };
  const stop = host.bus?.stops.find(item => item.cell === cell);
  if (!stop) return { state, message: 'แตะป้ายรถเมล์ตามลำดับที่รถจะจอด', ok: false };
  const stopIds = [...state.draft.stopIds, stop.id];
  const next: BusUiState = { ...state, draft: { ...state.draft, stopIds } };
  if (state.draft.stopIds.at(-1) === stop.id) return { state, message: previewLine(host, next.draft).message, ok: false };
  return { state: next, message: draftHint(host, next.draft), ok: true };
}
export function commitDraft(host: BusHost, state: BusUiState, enabled = busEnabled()): { state: BusUiState; result: BusResult } {
  if (!enabled) return { state, result: { ok: false, message: OFF } };
  const spec = specOf(host, state.draft);
  const result = state.draft.editing != null ? editBusLine(host, state.draft.editing, spec) : createBusLine(host, spec);
  if (!result.ok) return { state, result };
  return { state: { ...state, draft: { ...state.draft, stopIds: [], editing: null, depotId: spec.depotId } }, result };
}
export function changeLineBuses(host: BusHost, id: number, busCount: number, enabled = busEnabled()): BusResult {
  if (!enabled) return { ok: false, message: OFF };
  return editBusLine(host, id, { busCount });
}
export function removeLine(host: BusHost, id: number, enabled = busEnabled()): BusResult {
  if (!enabled) return { ok: false, message: OFF };
  return deleteBusLine(host, id);
}
/** Writes busLevel only. The returned message is the upgrade text, including the display fare. */
export function upgradeLine(host: BusHost & { lastEvent?: string }, id: number, enabled = busEnabled()) {
  if (!enabled) return { ok: false as const, message: OFF };
  if (!host.bus) return { ok: false as const, message: 'ไม่พบสายรถเมล์' };
  const result = upgradeBusLine(host.bus, id, enabled);
  if (result.ok) host.lastEvent = result.message;
  return result;
}

export function busRemovalImpact(host: BusHost, cell: number, via: BusRemovalVia): BusRemovalImpact | null {
  const stop = busStopAt(host, cell);
  if (stop) {
    const lineIds = linesForStop(host, stop.id);
    const verb = via === 'bulldoze' ? `รื้อถนนช่อง ${coord(cell)} จะลบป้ายรถเมล์ #${stop.id}` : `ลบป้ายรถเมล์ #${stop.id}`;
    return { kind: 'stop', id: stop.id, cell, lineIds, title: `ลบป้ายรถเมล์ #${stop.id}?`, body: `${verb} · สายที่กระทบ: ${ids(lineIds)}` };
  }
  const depot = busDepotAt(host, cell);
  if (!depot) return null;
  const lineIds = linesForDepot(host, depot.id);
  const heir = (host.bus?.depots ?? []).filter(item => item.id !== depot.id).sort((a, b) => a.id - b.id)[0];
  const move = !lineIds.length ? '' : heir ? ` · สายจะย้ายไปอู่ #${heir.id}` : ' · อู่นี้เป็นอู่สุดท้ายที่ยังมีสาย ระบบจะไม่รื้อจนกว่าจะลบสายหรือสร้างอู่อื่น';
  const verb = via === 'bulldoze' ? `รื้ออู่รถเมล์ #${depot.id}` : `รื้ออู่รถเมล์ #${depot.id}`;
  return { kind: 'depot', id: depot.id, cell, lineIds, title: `รื้ออู่รถเมล์ #${depot.id}?`, body: `${verb} · สายที่กระทบ: ${ids(lineIds)}${move}` };
}
export async function bulldozeGuarded(host: BusHost, cell: number, enabled: boolean, confirm: (impact: BusRemovalImpact) => Promise<boolean>, run: (cell: number) => Result): Promise<Result | null> {
  const impact = enabled ? busRemovalImpact(host, cell, 'bulldoze') : null;
  if (impact && !await confirm(impact)) return null;
  return run(cell);
}
export function commitStopRemoval(city: City, id: number, confirmed: boolean): Result & { removed: boolean } {
  const stop = city.bus?.stops.find(item => item.id === id);
  if (!stop) return { ok: false, message: 'ไม่พบป้ายรถเมล์', removed: false };
  if (!confirmed) return { ok: false, message: busRemovalImpact(city, stop.cell, 'direct')?.body ?? 'ยังไม่ลบ', removed: false };
  const result = removeBusStop(city, id); return { ...result, removed: result.ok };
}
export function commitDepotRemoval(city: City, id: number, confirmed: boolean): Result & { removed: boolean } {
  const depot = city.bus?.depots.find(item => item.id === id);
  if (!depot) return { ok: false, message: 'ไม่พบอู่รถเมล์', removed: false };
  if (!confirmed) return { ok: false, message: busRemovalImpact(city, depot.cell, 'direct')?.body ?? 'ยังไม่รื้อ', removed: false };
  const result = removeBusDepot(city, id); return { ...result, removed: result.ok };
}

export function busPlaceCaption(host: BusHost, cell: number, enabled = busEnabled()): string | null {
  if (!enabled) return null;
  const stop = busStopAt(host, cell);
  if (stop) return `ป้ายรถเมล์ #${stop.id} · ฝั่ง${SIDE[stop.side]} · ${stop.level === 2 ? 'ศาลา' : 'ป้าย'} · สาย ${ids(linesForStop(host, stop.id))}`;
  const depot = busDepotAt(host, cell);
  if (!depot) return null;
  const load = busDepotLoad(host).find(item => item.depotId === depot.id);
  return `อู่รถเมล์ #${depot.id} · ระดับ ${depot.level} · ${depot.open ? 'เปิด' : 'ปิด'} · ใช้ ${load?.assigned ?? 0}/${load?.capacity ?? BUS_DEPOT_BUSES[depot.level]} คัน`;
}

export function busToolPreview(city: City, tool: string, hover: number | null, state: BusUiState, enabled = busEnabled()): BusPreview | null {
  if (tool !== 'bus-depot' && tool !== 'bus-stop' && tool !== 'bus-line') return null;
  if (!enabled) return { ok: false, cost: 0, label: OFF, cells: hover === null ? [] : [{ cell: hover, ok: false }] };
  if (tool === 'bus-depot') {
    if (hover === null) return { ok: false, cost: 0, label: 'แตะแปลงว่างที่ติดถนนเชื่อมประตูเมือง', cells: [] };
    const reason = busDepotReason(city, hover, true);
    return { ok: !reason, cost: 0, label: reason ?? 'วางอู่รถเมล์ได้ · รอบแรกไม่มีค่าใช้จ่าย', cells: [{ cell: hover, ok: !reason }] };
  }
  if (tool === 'bus-stop') {
    if (hover === null) return { ok: false, cost: 0, label: 'แตะถนนตรง · เลือกฝั่งให้ตรงทิศรถ', cells: [] };
    const side = state.side ?? defaultBusStopSide(city, hover);
    const reason = busStopSiteReason(city, hover, side, true);
    const label = reason ?? `วางป้ายฝั่ง${side ? SIDE[side] : ''} · ห่างป้ายอื่นอย่างน้อย 2 ช่อง`;
    return { ok: !reason, cost: 0, label, cells: [{ cell: hover, ok: !reason }] };
  }
  const draftCells = state.draft.stopIds.flatMap(id => { const stop = city.bus?.stops.find(item => item.id === id); return stop ? [{ cell: stop.cell, ok: true }] : []; });
  if (hover === null) return { ok: previewLine(city, state.draft).ok, cost: 0, label: draftHint(city, state.draft), cells: draftCells };
  const stop = city.bus?.stops.find(item => item.cell === hover);
  if (!stop) return { ok: false, cost: 0, label: 'แตะป้ายรถเมล์ตามลำดับที่รถจะจอด', cells: [...draftCells, { cell: hover, ok: false }] };
  const trial = { ...state.draft, stopIds: [...state.draft.stopIds, stop.id] };
  const repeated = state.draft.stopIds.at(-1) === stop.id;
  const result = previewLine(city, trial);
  const label = repeated || (!result.ok && new Set(trial.stopIds).size >= 2) ? result.message : draftHint(city, trial);
  return { ok: result.ok, cost: 0, label, cells: [...draftCells, { cell: hover, ok: !repeated }] };
}

export type BusDepotCard = { depotId: number; cell: number; level: number; open: boolean; capacity: number; assigned: number; free: number; lineIds: number[]; label: string };
export type BusStopCard = { id: number; cell: number; side: BusStopSide; sideLabel: string; level: number; lineIds: number[]; waiting: number | null; label: string };
export type BusLiveCard = { out: number; home: number; onboard: number; retired: number; tally: string; seen: number };
export type BusLineCard = {
  lineId: number; depotId: number; stopIds: number[]; stopsLabel: string; loop: boolean;
  status: 'running' | 'suspended'; statusLabel: string; reason: BusSuspendReason | null; reasonLabel: string | null;
  headwayMinutes: number | null; headwayLabel: string; busCount: number; runningBuses: number; busLevel: BusLevel;
  display: readonly string[]; upgradeLabel: string | null; live: BusLiveCard | null;
};
export type BusPanelModel = {
  enabled: boolean; depots: BusDepotCard[]; stops: BusStopCard[]; lines: BusLineCard[];
  totals: { accepted: number; boarded: number; completed: number; released: number } | null;
  waiting: number | null; boardNote: string | null;
};

const headwayLabel = (minutes: number | null) => minutes === null || !Number.isFinite(minutes) ? 'หัวคิว —' : `หัวคิว ${Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)} นาที`;
function displayOf(line: Pick<BusLine, 'busLevel' | 'busCount'>): readonly string[] {
  try { return busLevelDisplayLines(line); } catch { return ['ระดับรถไม่ถูกต้อง']; }
}
function upgradeLabel(line: Pick<BusLine, 'busLevel' | 'busCount'>): string | null {
  const to = nextBusLevel(line.busLevel); if (!to) return null;
  try {
    const quote = busLevelQuote(to), preview = busLevelDisplayLines({ busLevel: to, busCount: line.busCount });
    return `ยกระดับเป็นระดับ ${quote.level} · ${preview[1]} · ${preview[2]}`;
  } catch { return null; }
}
function liveOf(read: BusLiveRead, lineId: number): BusLiveCard {
  const detail = read.busesDetail().filter(bus => bus.lineId === lineId);
  const snaps = read.snapshot().filter(bus => bus.lineId === lineId);
  const counts = new Map<string, number>();
  for (const bus of detail) {
    const label = bus.retired ? 'พักสาย' : bus.returning ? 'กลับอู่' : (PHASE[bus.phase] ?? bus.phase);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return {
    out: detail.filter(bus => bus.phase !== 'home' && !bus.retired).length,
    home: detail.filter(bus => bus.phase === 'home' && !bus.retired).length,
    onboard: snaps.reduce((sum, bus) => sum + bus.persons, 0),
    retired: detail.filter(bus => bus.retired).length,
    tally: [...counts].map(([label, count]) => `${label} ${count}`).join(' · '),
    seen: detail.length,
  };
}

export function busPanelModel(host: BusHost, enabled = busEnabled(), read: BusLiveRead | null = enabled ? getBusLiveSource() : null, notes = enabled ? lastBusBoardNotes() : [], routes: readonly BusLineRoute[] = enabled ? busLineRoutes(host) : []): BusPanelModel {
  if (!enabled) return { enabled: false, depots: [], stops: [], lines: [], totals: null, waiting: null, boardNote: null };
  const routeById = new Map<number, BusLineRoute>(routes.map(route => [route.lineId, route]));
  const load = busDepotLoad(host);
  const stops = host.bus?.stops ?? [];
  const waiting = read ? stops.reduce((sum, stop) => sum + read.waitingAt(stop.id), 0) : null;
  const boarded = notes.filter(event => event.kind === 'board').reduce((sum, event) => sum + event.persons, 0);
  const alighted = notes.filter(event => event.kind === 'alight').reduce((sum, event) => sum + event.persons, 0);
  return {
    enabled: true,
    depots: load.map(depot => ({
      depotId: depot.depotId, cell: host.bus!.depots.find(item => item.id === depot.depotId)!.cell, level: depot.level, open: depot.open,
      capacity: depot.capacity, assigned: depot.assigned, free: depot.free, lineIds: linesForDepot(host, depot.depotId),
      label: `อู่ #${depot.depotId} · ระดับ ${depot.level} · ${depot.open ? 'เปิด' : 'ปิด'} · ใช้ ${depot.assigned}/${depot.capacity} คัน · ว่าง ${depot.free}`,
    })),
    stops: [...stops].sort((a, b) => a.id - b.id).map(stop => ({
      id: stop.id, cell: stop.cell, side: stop.side, sideLabel: SIDE[stop.side], level: stop.level, lineIds: linesForStop(host, stop.id),
      waiting: read ? read.waitingAt(stop.id) : null,
      label: `ป้าย #${stop.id} · ช่อง ${coord(stop.cell)} · ฝั่ง${SIDE[stop.side]} · สาย ${ids(linesForStop(host, stop.id))}`,
    })),
    lines: [...(host.bus?.lines ?? [])].sort((a, b) => a.id - b.id).map(line => {
      const route = routeById.get(line.id);
      const status = route?.status ?? 'suspended';
      const reason = route?.reason ?? null;
      return {
        lineId: line.id, depotId: line.depotId, stopIds: [...line.stopIds],
        stopsLabel: line.stopIds.map(id => `#${id}`).join(' → ') || 'ไม่มีป้าย',
        loop: route?.loop ?? false, status, statusLabel: status === 'running' ? 'วิ่ง' : 'หยุดชั่วคราว',
        reason, reasonLabel: reason ? REASON[reason] : null,
        headwayMinutes: route?.headwayMinutes ?? null, headwayLabel: headwayLabel(route?.headwayMinutes ?? null),
        busCount: line.busCount, runningBuses: route?.buses ?? 0, busLevel: line.busLevel,
        display: displayOf(line), upgradeLabel: upgradeLabel(line), live: read ? liveOf(read, line.id) : null,
      };
    }),
    totals: read ? { accepted: read.totals.accepted, boarded: read.totals.boarded, completed: read.totals.completed, released: read.totals.released } : null,
    waiting,
    boardNote: notes.length ? `เหตุการณ์ที่ส่งต่อ ${notes.length} รายการ · ขึ้น ${boarded} คน · ลง ${alighted} คน` : null,
  };
}

/** Same model, but routes come from the caller's cache so a refresh does not rebuild the graph twice. */
export function cachedPanelModel(host: BusHost, cache: BusRouteCache, enabled = busEnabled(), read: BusLiveRead | null = enabled ? getBusLiveSource() : null, notes = enabled ? lastBusBoardNotes() : []): BusPanelModel {
  if (!enabled) return busPanelModel(host, false);
  return busPanelModel(host, true, read, notes, cache.get(host));
}
