/**
 * Touch line panel and the stop/line composer. Buttons are at least 44px.
 * Live figures are read from trafficLayer.bus when that engine exists.
 * Boarding text arrives through subscribeBusEvents (PR #134). Nothing here drains.
 */
import { cachedPanelModel, type BusPanelModel } from './player.ts';
import { subscribeBusLive } from './live.ts';
import { BusRouteCache, type BusHost } from './lines.ts';
import type { BusStopSide } from './types.ts';
import { ICONS } from '../ui-icons.ts';

export type BusPanelHandlers = {
  onUpgrade(lineId: number): void;
  onDeleteLine(lineId: number): void;
  onEditStops(lineId: number): void;
  onBusCount(lineId: number, count: number): void;
  onDeleteStop(id: number): void;
  onDeleteDepot(id: number): void;
  onFocus(cell: number): void;
  onClose(): void;
};
export type BusComposerHandlers = {
  onSide(side: BusStopSide | null): void;
  onUndo(): void;
  onClear(): void;
  onCommit(): void;
  onDepot(id: number): void;
  onCount(count: number): void;
};
export type BusComposerState = {
  mode: 'hidden' | 'depot' | 'stop' | 'line';
  message: string;
  side: BusStopSide | null;
  stops: number[];
  depots: { id: number; label: string; selected: boolean }[];
  busCount: number;
  commitLabel: string;
  /** Player-facing positions for `stops`, same order. */
  stopLabels?: string[];
};

const SIDES: readonly [BusStopSide | null, string, string][] = [[null, 'อัตโนมัติ', '◎'], ['n', 'เหนือ', '↑'], ['e', 'ออก', '→'], ['s', 'ใต้', '↓'], ['w', 'ตก', '←']];
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
/** ①, ②… for a stop's place in a line; plain numbers after twenty. */
export const stopOrdinal = (index: number) => CIRCLED[index] ?? String(index + 1);
/** Player-facing "column,row" like the place panel, never the internal cell index. */
export const busCellLabel = (cell: number) => `(${cell % 24 + 1},${Math.floor(cell / 24) + 1})`;

function button(doc: Document, label: string, action: string, onClick: () => void, extra: Record<string, string> = {}) {
  const node = doc.createElement('button');
  node.type = 'button'; node.className = 'bus-touch'; node.textContent = label;
  node.dataset.action = action;
  for (const [key, value] of Object.entries(extra)) node.dataset[key] = value;
  node.addEventListener('click', () => { if (node.disabled) return; onClick(); });
  return node;
}
/** Inline icon built from this host's document (the panel is also painted into test documents). */
function icon(doc: Document, name: string) {
  const node = doc.createElement('span'); node.className = 'bus-icon'; node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] ?? ''}</svg>`; return node;
}
const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text = '') => {
  const node = doc.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

export function paintBusPanel(host: HTMLElement, model: BusPanelModel, handlers: BusPanelHandlers) {
  const doc = host.ownerDocument;
  host.replaceChildren();
  if (!model.enabled) { host.hidden = true; return; }
  host.hidden = false;
  const title = el(doc, 'div', 'bus-head');
  const close = button(doc, '×', 'close', handlers.onClose); close.setAttribute('aria-label', 'ปิดแผงสายรถเมล์'); close.className += ' bus-close';
  const heading = el(doc, 'div', 'bus-heading');
  heading.append(el(doc, 'h3', '', 'สายรถเมล์'), el(doc, 'p', 'bus-state', `${model.lines.length} สาย · ${model.stops.length} ป้าย · ${model.depots.length} อู่`));
  title.append(icon(doc, 'bus'), heading, close);
  const rows: HTMLElement[] = [title];
  if (model.totals) {
    // Three headline tiles; the rest of the tally stays one quiet line.
    const tiles = el(doc, 'div', 'bus-tiles'); tiles.dataset.totals = 'true';
    for (const [value, label] of [[model.waiting ?? 0, 'รอขึ้นรถ'], [model.totals.boarded, 'ขึ้นรถแล้ว'], [model.totals.completed, 'ถึงป้าย']] as const) {
      const tile = el(doc, 'div', 'bus-tile'); tile.append(el(doc, 'strong', '', String(value)), el(doc, 'span', '', label)); tiles.append(tile);
    }
    rows.push(tiles, el(doc, 'p', 'bus-note', `รับเข้าระบบ ${model.totals.accepted} · กลับไปใช้รถส่วนตัว ${model.totals.released}`));
  }
  if (model.boardNote) { const note = el(doc, 'p', 'bus-board-note', model.boardNote); note.dataset.boardNote = 'true'; rows.push(note); }
  const cellOf = new Map(model.stops.map(stop => [stop.id, stop.cell]));
  rows.push(el(doc, 'h4', '', 'สาย'));
  if (!model.lines.length) rows.push(el(doc, 'p', 'bus-empty', 'ยังไม่มีสาย · เลือกเครื่องมือสาย แตะป้ายตามลำดับ แล้วกดสร้างสาย'));
  for (const line of model.lines) {
    const card = el(doc, 'article', 'bus-line'); card.dataset.line = String(line.lineId);
    card.dataset.status = line.status; if (line.reason) card.dataset.reason = line.reason;
    card.dataset.headway = line.headwayMinutes === null ? '' : String(line.headwayMinutes);
    card.dataset.busCount = String(line.busCount); card.dataset.runningBuses = String(line.runningBuses);
    const head = el(doc, 'div', 'bus-line-head');
    const name = el(doc, 'strong', '', `สาย ${line.lineId}`);
    const pill = el(doc, 'span', 'bus-pill', `${line.statusLabel}${line.reasonLabel ? ` · ${line.reasonLabel}` : ''}`); pill.dataset.status = line.status;
    head.append(name, pill, el(doc, 'span', 'bus-meta', `${line.headwayLabel}${line.loop ? ' · วงกลม' : ''}`));
    // Route strip: each stop in order with its grid position.
    const route = el(doc, 'ol', 'bus-route'); route.setAttribute('aria-label', `ป้ายตามลำดับ ${line.stopsLabel}`);
    line.stopIds.forEach((id, index) => {
      const cell = cellOf.get(id), item = el(doc, 'li', '', `${stopOrdinal(index)} ${cell === undefined ? `#${id}` : busCellLabel(cell)}`);
      item.dataset.stop = String(id); route.append(item);
    });
    card.append(head, route);
    const fleet = el(doc, 'p', 'bus-meta', `อู่ ${line.depotId} · รถ ${line.busCount} คัน · วิ่งได้ ${line.runningBuses}`);
    card.append(fleet);
    for (const fact of line.display) { const fare = el(doc, 'p', 'bus-meta', fact); fare.dataset.fare = 'true'; card.append(fare); }
    if (line.live) {
      const live = el(doc, 'p', 'bus-live', `บนถนน ${line.live.out} · จอดอู่ ${line.live.home} · ผู้โดยสารบนรถ ${line.live.onboard}${line.live.tally ? ` · ${line.live.tally}` : ''}`);
      live.dataset.live = 'true'; card.append(live);
    }
    const controls = el(doc, 'div', 'bus-actions bus-stepper');
    const fewer = button(doc, '−', 'bus-count', () => handlers.onBusCount(line.lineId, line.busCount - 1), { line: String(line.lineId), count: String(line.busCount - 1) });
    fewer.setAttribute('aria-label', 'ลดรถ'); fewer.disabled = line.busCount <= 0; controls.append(fewer);
    controls.append(el(doc, 'span', 'bus-count', `${line.busCount} คัน`));
    const more = button(doc, '+', 'bus-count', () => handlers.onBusCount(line.lineId, line.busCount + 1), { line: String(line.lineId), count: String(line.busCount + 1) });
    more.setAttribute('aria-label', 'เพิ่มรถ'); controls.append(more);
    if (line.upgradeLabel) { const up = button(doc, line.upgradeLabel, 'upgrade', () => handlers.onUpgrade(line.lineId), { line: String(line.lineId) }); up.className += ' bus-upgrade'; controls.append(up); }
    else controls.append(el(doc, 'span', 'bus-meta', 'ระดับสูงสุดแล้ว'));
    card.append(controls);
    const edit = el(doc, 'div', 'bus-actions');
    edit.append(button(doc, 'แก้ลำดับป้าย', 'edit-stops', () => handlers.onEditStops(line.lineId), { line: String(line.lineId) }));
    const drop = button(doc, 'ลบสาย', 'delete-line', () => handlers.onDeleteLine(line.lineId), { line: String(line.lineId) }); drop.className += ' bus-danger'; edit.append(drop);
    card.append(edit);
    rows.push(card);
  }
  const compact = (kind: 'depot' | 'stop', iconName: string, text: string, cell: number, focusLabel: string, del: () => void, delAction: string, delLabel: string, extra: Record<string, string>) => {
    const row = el(doc, 'div', 'bus-row'); for (const [k, v] of Object.entries(extra)) row.dataset[k] = v;
    const copy = el(doc, 'p', '', text);
    const focus = button(doc, 'ดู', 'focus', () => handlers.onFocus(cell), { cell: String(cell) }); focus.setAttribute('aria-label', focusLabel);
    const remove = button(doc, 'ลบ', delAction, del, { [kind]: extra[kind] }); remove.setAttribute('aria-label', delLabel); remove.className += ' bus-danger';
    row.append(icon(doc, iconName), copy, focus, remove); return row;
  };
  rows.push(el(doc, 'h4', '', 'ป้าย'));
  if (!model.stops.length) rows.push(el(doc, 'p', 'bus-empty', 'ยังไม่มีป้าย · เลือกเครื่องมือป้าย แล้วแตะถนนตรง'));
  for (const stop of model.stops) rows.push(compact('stop', 'bus-stop', `ป้าย ${busCellLabel(stop.cell)} · ฝั่ง${stop.sideLabel}${stop.waiting === null ? '' : ` · รอ ${stop.waiting} คน`}`, stop.cell, 'ดูป้ายบนแผนที่', () => handlers.onDeleteStop(stop.id), 'delete-stop', 'ลบป้าย', { stop: String(stop.id) }));
  rows.push(el(doc, 'h4', '', 'อู่'));
  if (!model.depots.length) rows.push(el(doc, 'p', 'bus-empty', 'ยังไม่มีอู่รถเมล์ · เลือกเครื่องมืออู่ แล้วแตะแปลงว่างริมถนน'));
  for (const depot of model.depots) {
    const row = compact('depot', 'bus-depot', `อู่ ${depot.depotId} ${busCellLabel(depot.cell)} · ระดับ ${depot.level} · ${depot.open ? 'เปิด' : 'ปิด'} · ใช้ ${depot.assigned}/${depot.capacity} คัน`, depot.cell, 'ดูอู่บนแผนที่', () => handlers.onDeleteDepot(depot.depotId), 'delete-depot', 'รื้ออู่', { depot: String(depot.depotId) });
    row.dataset.capacity = String(depot.capacity); row.dataset.assigned = String(depot.assigned); row.dataset.free = String(depot.free);
    rows.push(row);
  }
  host.append(...rows);
}

export function paintBusComposer(host: HTMLElement, view: BusComposerState, handlers: BusComposerHandlers) {
  const doc = host.ownerDocument;
  host.hidden = view.mode === 'hidden';
  host.replaceChildren();
  if (view.mode === 'hidden') return;
  host.dataset.mode = view.mode;
  const message = el(doc, 'p', 'bus-message', view.message); message.dataset.message = 'true';
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  host.append(message);
  if (view.mode === 'depot') return;
  const actions = el(doc, 'div', 'bus-actions');
  if (view.mode === 'stop') {
    for (const [side, label, arrow] of SIDES) {
      const node = button(doc, `${arrow} ${label}`, 'side', () => handlers.onSide(side), { side: side ?? 'auto' });
      node.setAttribute('aria-label', side ? `ฝั่ง${label}` : 'เลือกฝั่งอัตโนมัติ');
      node.setAttribute('aria-pressed', String(view.side === side));
      if (view.side === side) node.className += ' is-selected';
      actions.append(node);
    }
    host.append(actions); return;
  }
  // Chosen stops as numbered chips in order.
  const order = el(doc, 'ol', 'bus-route'); order.dataset.order = view.stops.join(',');
  if (!view.stops.length) order.append(el(doc, 'li', 'bus-route-empty', 'ยังไม่ได้เลือกป้าย'));
  view.stops.forEach((id, index) => order.append(el(doc, 'li', '', `${stopOrdinal(index)} ${view.stopLabels?.[index] ?? `#${id}`}`)));
  host.append(order);
  for (const depot of view.depots) {
    const node = button(doc, depot.label, 'depot', () => handlers.onDepot(depot.id), { depot: String(depot.id) });
    node.setAttribute('aria-pressed', String(depot.selected));
    if (depot.selected) node.className += ' is-selected';
    actions.append(node);
  }
  const fewer = button(doc, '−', 'draft-count', () => handlers.onCount(view.busCount - 1)); fewer.setAttribute('aria-label', 'ลดรถ'); actions.append(fewer);
  actions.append(el(doc, 'span', 'bus-count', `${view.busCount} คัน`));
  const more = button(doc, '+', 'draft-count', () => handlers.onCount(view.busCount + 1)); more.setAttribute('aria-label', 'เพิ่มรถ'); actions.append(more);
  const undo = button(doc, '↶', 'undo', handlers.onUndo); undo.setAttribute('aria-label', 'ย้อนป้ายล่าสุด'); actions.append(undo);
  const clear = button(doc, '✕', 'clear', handlers.onClear); clear.setAttribute('aria-label', 'ล้างลำดับป้าย'); actions.append(clear);
  const commit = button(doc, view.commitLabel, 'commit', handlers.onCommit); commit.className += ' bus-primary'; commit.disabled = view.stops.length < 2; actions.append(commit);
  host.append(actions);
}

export function confirmBusRemoval(copy: { title: string; body: string }): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.className = 'bus-confirm'; dialog.setAttribute('aria-label', copy.title);
  const title = document.createElement('h3'); title.textContent = copy.title; dialog.dataset.tone = 'danger';
  const body = document.createElement('p'); body.textContent = copy.body;
  const actions = document.createElement('div'); actions.className = 'bus-actions';
  const cancel = document.createElement('button'); const ok = document.createElement('button');
  let settled = false;
  const finish = (accepted: boolean) => { if (settled) return; settled = true; dialog.close(); resolve(accepted); };
  let resolve: (value: boolean) => void = () => {};
  cancel.type = 'button'; cancel.className = 'bus-touch'; cancel.dataset.action = 'cancel-removal'; cancel.textContent = 'ยังไม่ลบ'; cancel.autofocus = true;
  ok.type = 'button'; ok.className = 'bus-touch bus-danger'; ok.dataset.action = 'confirm-removal'; ok.textContent = 'ลบตามนี้';
  cancel.addEventListener('click', () => finish(false)); ok.addEventListener('click', () => finish(true));
  actions.append(cancel, ok); dialog.append(title, body, actions);
  return new Promise(done => {
    resolve = done;
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => { if (!settled) { settled = true; done(false); } dialog.remove(); });
    document.body.append(dialog); dialog.showModal();
  });
}

export function installBusPanel(host: HTMLElement, handlers: BusPanelHandlers, readCity: () => BusHost, enabled: () => boolean) {
  const cache = new BusRouteCache();
  let open = false, key = '';
  const refresh = () => {
    if (!open || !enabled()) { host.hidden = true; return; }
    const model = cachedPanelModel(readCity(), cache, true);
    const next = JSON.stringify(model);
    if (next === key && !host.hidden) return;
    key = next; paintBusPanel(host, model, handlers);
  };
  const stop = subscribeBusLive(refresh);
  return {
    refresh, stop,
    isOpen: () => open,
    open() { if (!enabled()) return; open = true; refresh(); },
    close() { open = false; key = ''; host.hidden = true; host.replaceChildren(); },
    toggle() { if (open) this.close(); else this.open(); },
  };
}
