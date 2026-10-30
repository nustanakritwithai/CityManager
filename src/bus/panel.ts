/**
 * Touch line panel and the stop/line composer. Buttons are at least 44px.
 * Live figures are read from trafficLayer.bus when that engine exists.
 * Boarding text arrives through subscribeBusEvents (PR #134). Nothing here drains.
 */
import { cachedPanelModel, type BusPanelModel } from './player.ts';
import { subscribeBusLive } from './live.ts';
import { BusRouteCache, type BusHost } from './lines.ts';
import type { BusStopSide } from './types.ts';

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
};

const SIDES: readonly [BusStopSide | null, string][] = [[null, 'ฝั่งอัตโนมัติ'], ['n', 'เหนือ'], ['e', 'ออก'], ['s', 'ใต้'], ['w', 'ตก']];

function button(doc: Document, label: string, action: string, onClick: () => void, extra: Record<string, string> = {}) {
  const node = doc.createElement('button');
  node.type = 'button'; node.className = 'bus-touch'; node.textContent = label;
  node.dataset.action = action;
  for (const [key, value] of Object.entries(extra)) node.dataset[key] = value;
  node.addEventListener('click', () => { if (node.disabled) return; onClick(); });
  return node;
}

export function paintBusPanel(host: HTMLElement, model: BusPanelModel, handlers: BusPanelHandlers) {
  const doc = host.ownerDocument;
  host.replaceChildren();
  if (!model.enabled) { host.hidden = true; return; }
  host.hidden = false;
  const title = doc.createElement('div'); title.className = 'bus-head';
  title.append(Object.assign(doc.createElement('h3'), { textContent: 'สายรถเมล์' }), button(doc, 'ปิด', 'close', handlers.onClose));
  const rows: HTMLElement[] = [title];
  if (model.totals) {
    const totals = doc.createElement('p'); totals.dataset.totals = 'true';
    totals.textContent = `ทั้งระบบ · รับ ${model.totals.accepted} · ขึ้นรถ ${model.totals.boarded} · ถึงป้าย ${model.totals.completed} · กลับรถส่วนตัว ${model.totals.released}${model.waiting === null ? '' : ` · รอขึ้นรถ ${model.waiting}`}`;
    rows.push(totals);
  }
  if (model.boardNote) { const note = doc.createElement('p'); note.dataset.boardNote = 'true'; note.textContent = model.boardNote; rows.push(note); }
  const depotTitle = doc.createElement('h4'); depotTitle.textContent = 'อู่'; rows.push(depotTitle);
  if (!model.depots.length) rows.push(Object.assign(doc.createElement('p'), { textContent: 'ยังไม่มีอู่รถเมล์ · เลือกเครื่องมืออู่ แล้วแตะแปลงว่างริมถนน' }));
  for (const depot of model.depots) {
    const row = doc.createElement('div'); row.className = 'bus-row'; row.dataset.depot = String(depot.depotId);
    row.dataset.capacity = String(depot.capacity); row.dataset.assigned = String(depot.assigned); row.dataset.free = String(depot.free);
    const text = doc.createElement('p'); text.textContent = depot.label; row.append(text);
    row.append(button(doc, 'ดูบนแผนที่', 'focus', () => handlers.onFocus(depot.cell), { cell: String(depot.cell) }));
    row.append(button(doc, 'รื้ออู่', 'delete-depot', () => handlers.onDeleteDepot(depot.depotId), { depot: String(depot.depotId) }));
    rows.push(row);
  }
  const stopTitle = doc.createElement('h4'); stopTitle.textContent = 'ป้าย'; rows.push(stopTitle);
  if (!model.stops.length) rows.push(Object.assign(doc.createElement('p'), { textContent: 'ยังไม่มีป้าย · เลือกเครื่องมือป้าย แล้วแตะถนนตรง' }));
  for (const stop of model.stops) {
    const row = doc.createElement('div'); row.className = 'bus-row'; row.dataset.stop = String(stop.id);
    const text = doc.createElement('p'); text.textContent = `${stop.label}${stop.waiting === null ? '' : ` · รอ ${stop.waiting} คน`}`; row.append(text);
    row.append(button(doc, 'ดูบนแผนที่', 'focus', () => handlers.onFocus(stop.cell), { cell: String(stop.cell) }));
    row.append(button(doc, 'ลบป้าย', 'delete-stop', () => handlers.onDeleteStop(stop.id), { stop: String(stop.id) }));
    rows.push(row);
  }
  const lineTitle = doc.createElement('h4'); lineTitle.textContent = 'สาย'; rows.push(lineTitle);
  if (!model.lines.length) rows.push(Object.assign(doc.createElement('p'), { textContent: 'ยังไม่มีสาย · แตะป้ายตามลำดับแล้วกดสร้างสาย' }));
  for (const line of model.lines) {
    const card = doc.createElement('article'); card.className = 'bus-line'; card.dataset.line = String(line.lineId);
    card.dataset.status = line.status; if (line.reason) card.dataset.reason = line.reason;
    card.dataset.headway = line.headwayMinutes === null ? '' : String(line.headwayMinutes);
    card.dataset.busCount = String(line.busCount); card.dataset.runningBuses = String(line.runningBuses);
    const head = doc.createElement('p');
    head.textContent = `สาย #${line.lineId} · อู่ #${line.depotId} · ${line.statusLabel}${line.reasonLabel ? ` · ${line.reasonLabel}` : ''}${line.loop ? ' · วงกลม' : ''}`;
    const stops = doc.createElement('p'); stops.textContent = `ป้าย ${line.stopsLabel}`;
    const fleet = doc.createElement('p'); fleet.textContent = `รถในสาย ${line.busCount} คัน · จัดสรรได้ ${line.runningBuses} · ${line.headwayLabel}`;
    card.append(head, stops, fleet);
    for (const fact of line.display) { const fare = doc.createElement('p'); fare.dataset.fare = 'true'; fare.textContent = fact; card.append(fare); }
    if (line.live) {
      const live = doc.createElement('p'); live.dataset.live = 'true';
      live.textContent = `บนถนน ${line.live.out} · จอดอู่ ${line.live.home} · ผู้โดยสารบนรถ ${line.live.onboard}${line.live.tally ? ` · ${line.live.tally}` : ''}`;
      card.append(live);
    }
    const controls = doc.createElement('div'); controls.className = 'bus-actions';
    const fewer = button(doc, 'ลดรถ', 'bus-count', () => handlers.onBusCount(line.lineId, line.busCount - 1), { line: String(line.lineId), count: String(line.busCount - 1) });
    fewer.disabled = line.busCount <= 0; controls.append(fewer);
    const count = doc.createElement('span'); count.className = 'bus-count'; count.textContent = String(line.busCount); controls.append(count);
    controls.append(button(doc, 'เพิ่มรถ', 'bus-count', () => handlers.onBusCount(line.lineId, line.busCount + 1), { line: String(line.lineId), count: String(line.busCount + 1) }));
    card.append(controls);
    if (line.upgradeLabel) card.append(button(doc, line.upgradeLabel, 'upgrade', () => handlers.onUpgrade(line.lineId), { line: String(line.lineId) }));
    else { const maxed = doc.createElement('p'); maxed.textContent = 'รถเมล์สายนี้เป็นระดับสูงสุดแล้ว'; card.append(maxed); }
    const edit = doc.createElement('div'); edit.className = 'bus-actions';
    edit.append(button(doc, 'แก้ลำดับป้าย', 'edit-stops', () => handlers.onEditStops(line.lineId), { line: String(line.lineId) }));
    edit.append(button(doc, 'ลบสาย', 'delete-line', () => handlers.onDeleteLine(line.lineId), { line: String(line.lineId) }));
    card.append(edit);
    rows.push(card);
  }
  host.append(...rows);
}

export function paintBusComposer(host: HTMLElement, view: BusComposerState, handlers: BusComposerHandlers) {
  const doc = host.ownerDocument;
  host.hidden = view.mode === 'hidden';
  host.replaceChildren();
  if (view.mode === 'hidden') return;
  const message = doc.createElement('p'); message.className = 'bus-message'; message.dataset.message = 'true'; message.textContent = view.message;
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  host.append(message);
  if (view.mode === 'depot') return;
  const actions = doc.createElement('div'); actions.className = 'bus-actions';
  if (view.mode === 'stop') {
    for (const [side, label] of SIDES) {
      const node = button(doc, label, 'side', () => handlers.onSide(side), { side: side ?? 'auto' });
      node.setAttribute('aria-pressed', String(view.side === side));
      if (view.side === side) node.className += ' is-selected';
      actions.append(node);
    }
    host.append(actions); return;
  }
  const order = doc.createElement('p'); order.dataset.order = view.stops.join(',');
  order.textContent = view.stops.length ? `ลำดับ ${view.stops.map(id => `#${id}`).join(' → ')}` : 'ยังไม่ได้เลือกป้าย';
  host.append(order);
  for (const depot of view.depots) {
    const node = button(doc, depot.label, 'depot', () => handlers.onDepot(depot.id), { depot: String(depot.id) });
    node.setAttribute('aria-pressed', String(depot.selected));
    if (depot.selected) node.className += ' is-selected';
    actions.append(node);
  }
  actions.append(button(doc, 'ลด', 'draft-count', () => handlers.onCount(view.busCount - 1)));
  const count = doc.createElement('span'); count.className = 'bus-count'; count.textContent = `${view.busCount} คัน`; actions.append(count);
  actions.append(button(doc, 'เพิ่ม', 'draft-count', () => handlers.onCount(view.busCount + 1)));
  actions.append(button(doc, 'ย้อน', 'undo', handlers.onUndo));
  actions.append(button(doc, 'ล้าง', 'clear', handlers.onClear));
  actions.append(button(doc, view.commitLabel, 'commit', handlers.onCommit));
  host.append(actions);
}

export function confirmBusRemoval(copy: { title: string; body: string }): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.className = 'bus-confirm'; dialog.setAttribute('aria-label', copy.title);
  const title = document.createElement('h3'); title.textContent = copy.title;
  const body = document.createElement('p'); body.textContent = copy.body;
  const actions = document.createElement('div'); actions.className = 'bus-actions';
  const cancel = document.createElement('button'); const ok = document.createElement('button');
  let settled = false;
  const finish = (accepted: boolean) => { if (settled) return; settled = true; dialog.close(); resolve(accepted); };
  let resolve: (value: boolean) => void = () => {};
  cancel.type = 'button'; cancel.className = 'bus-touch'; cancel.dataset.action = 'cancel-removal'; cancel.textContent = 'ยังไม่ลบ'; cancel.autofocus = true;
  ok.type = 'button'; ok.className = 'bus-touch'; ok.dataset.action = 'confirm-removal'; ok.textContent = 'ลบตามนี้';
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
