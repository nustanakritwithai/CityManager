/**
 * Wires the bus dock, composer and line panel into the city screen.
 * The screen passes a confirm callback; deletion does not run until it resolves true.
 */
import type { City } from '../sim.ts';
import { installBusMenu, type BusToolName } from './menu.ts';
import { confirmBusRemoval, installBusPanel, paintBusComposer, type BusComposerState } from './panel.ts';
import {
  beginLineEdit, busPlaceCaption, busRemovalImpact, busToolPreview, changeLineBuses, chooseSide, clearDraft, commitDepotRemoval, commitDraft, commitStopRemoval, draftHint, emptyBusUi, placeBusDepot, placeBusStop, preferredDepot, removeLine, setDraftCount, setDraftDepot, tapLineStop, undoStop, upgradeLine, type BusPreview, type BusRemovalImpact, type BusUiState,
} from './player.ts';
import type { BusStopSide } from './types.ts';

export type BusNotice = { ok: boolean; message: string; mutated: boolean };

export function createBusController(options: {
  anchor: HTMLButtonElement;
  composer: HTMLElement;
  panel: HTMLElement;
  help: HTMLElement;
  enabled: () => boolean;
  getCity: () => City;
  getTool: () => string;
  getHover: () => number | null;
  setTool: (tool: string) => void;
  beforeChange: () => void;
  notice: (notice: BusNotice) => void;
  focusCell: (cell: number) => void;
  confirm?: (impact: BusRemovalImpact) => Promise<boolean>;
}) {
  let state: BusUiState = emptyBusUi();
  let message = '';
  let toolSeen = '';
  let composerKey = '';
  const confirm = options.confirm ?? confirmBusRemoval;
  let asking = false;
  const ask = async (impact: BusRemovalImpact) => {
    if (asking) return false;
    asking = true;
    try { return await confirm(impact); }
    finally { asking = false; }
  };
  const city = () => options.getCity();
  const report = (ok: boolean, text: string, mutated: boolean) => { message = text; options.notice({ ok, message: text, mutated }); refresh(); };
  const panel = installBusPanel(options.panel, {
    onClose: () => panel.close(),
    onFocus: cell => options.focusCell(cell),
    onUpgrade: id => { options.beforeChange(); const result = upgradeLine(city(), id, true); report(result.ok, result.message, result.ok); },
    onDeleteLine: id => { options.beforeChange(); const result = removeLine(city(), id, true); report(result.ok, result.message, result.ok); },
    onEditStops: id => {
      state = beginLineEdit(city(), state, id);
      const hint = draftHint(city(), state.draft);
      if (options.getTool() !== 'bus-line') options.setTool('bus-line');
      report(true, hint, false);
    },
    onBusCount: (id, count) => { options.beforeChange(); const result = changeLineBuses(city(), id, count, true); report(result.ok, result.message, result.ok); },
    onDeleteStop: id => { void removeStop(id); },
    onDeleteDepot: id => { void removeDepot(id); },
  }, city, options.enabled);
  const menu = installBusMenu(options.anchor, tool => options.setTool(tool), () => panel.open(), options.enabled);

  function shownMessage(mode: BusComposerState['mode'], fallback: string) {
    const hover = options.getHover();
    if (hover !== null && mode !== 'hidden') {
      const preview = busToolPreview(city(), options.getTool(), hover, state, true);
      if (preview) return preview.label;
    }
    return message || fallback;
  }
  function composerView(): BusComposerState {
    const tool = options.getTool();
    const mode = options.enabled() && (tool === 'bus-depot' || tool === 'bus-stop' || tool === 'bus-line') ? tool.slice(4) as BusComposerState['mode'] : 'hidden';
    if (mode === 'hidden' || mode === 'depot') return { mode, message: shownMessage(mode, mode === 'depot' ? 'แตะแปลงว่างที่ติดถนนเชื่อมประตูเมือง' : ''), side: state.side, stops: [], depots: [], busCount: state.draft.busCount, commitLabel: '' };
    if (mode === 'stop') return { mode, message: shownMessage(mode, 'เลือกฝั่ง แล้วแตะถนนตรงที่ไม่ใช่ทางแยกหรือหัวมุม'), side: state.side, stops: [], depots: [], busCount: 1, commitLabel: '' };
    const chosen = state.draft.depotId ?? preferredDepot(city(), state.draft.busCount);
    return {
      mode, message: shownMessage(mode, draftHint(city(), state.draft)), side: state.side, stops: [...state.draft.stopIds], busCount: state.draft.busCount,
      commitLabel: state.draft.editing != null ? `บันทึกสาย #${state.draft.editing}` : 'สร้างสาย',
      depots: (city().bus?.depots ?? []).map(depot => ({ id: depot.id, label: `อู่ #${depot.id}`, selected: depot.id === chosen })),
    };
  }
  function refresh() {
    const on = options.enabled();
    options.anchor.hidden = !on;
    if (!on) { panel.close(); options.composer.hidden = true; return; }
    const view = composerView();
    const key = JSON.stringify(view);
    if (key !== composerKey) {
      composerKey = key;
      paintBusComposer(options.composer, view, {
      onSide: (side: BusStopSide | null) => { state = chooseSide(state, side); message = side ? `ฝั่ง${{ n: 'เหนือ', e: 'ตะวันออก', s: 'ใต้', w: 'ตะวันตก' }[side]}` : 'ใช้ฝั่งที่กฎอนุญาต'; refresh(); options.help.textContent = message; },
      onUndo: () => { state = undoStop(state); message = draftHint(city(), state.draft); refresh(); options.help.textContent = message; },
      onClear: () => { state = clearDraft(state); message = draftHint(city(), state.draft); refresh(); options.help.textContent = message; },
      onDepot: id => { state = setDraftDepot(state, id); message = draftHint(city(), state.draft); refresh(); options.help.textContent = message; },
      onCount: count => { state = setDraftCount(state, count); message = draftHint(city(), state.draft); refresh(); options.help.textContent = message; },
      onCommit: () => { options.beforeChange(); const committed = commitDraft(city(), state, true); state = committed.state; report(committed.result.ok, committed.result.message, committed.result.ok); if (committed.result.ok) panel.open(); },
    });
    }
    if (view.mode !== 'hidden') options.help.textContent = view.message;
    if (panel.isOpen()) panel.refresh();
  }
  async function removeStop(id: number) {
    const stop = city().bus?.stops.find(item => item.id === id);
    const impact = stop ? busRemovalImpact(city(), stop.cell, 'direct') : null;
    const accepted = impact ? await ask(impact) : false;
    options.beforeChange();
    const result = commitStopRemoval(city(), id, accepted);
    report(result.ok, result.removed ? result.message : (accepted ? result.message : 'ยังไม่ลบป้าย'), result.removed);
  }
  async function removeDepot(id: number) {
    const depot = city().bus?.depots.find(item => item.id === id);
    const impact = depot ? busRemovalImpact(city(), depot.cell, 'direct') : null;
    const accepted = impact ? await ask(impact) : false;
    options.beforeChange();
    const result = commitDepotRemoval(city(), id, accepted);
    report(result.ok, result.removed ? result.message : (accepted ? result.message : 'ยังไม่รื้ออู่'), result.removed);
  }

  return {
    handles: (tool: string) => options.enabled() && (tool === 'bus-depot' || tool === 'bus-stop' || tool === 'bus-line'),
    preview(tool: string, hover: number | null): BusPreview | null { return busToolPreview(city(), tool, hover, state, options.enabled()); },
    caption: (cell: number) => busPlaceCaption(city(), cell, options.enabled()),
    confirm: ask,
    tap(tool: BusToolName, cell: number) {
      if (tool === 'bus-depot') { const result = placeBusDepot(city(), cell, true); report(result.ok, result.message, result.ok); return; }
      if (tool === 'bus-stop') { const result = placeBusStop(city(), cell, state.side, true); report(result.ok, result.message, result.ok); return; }
      const next = tapLineStop(city(), state, cell, true); state = next.state; report(next.ok, next.message, false);
    },
    sync(tool: string) {
      if (tool !== toolSeen) message = '';
      toolSeen = tool; menu.sync(tool); refresh();
    },
    refresh,
    consumeCancel() {
      if (menu.isOpen()) { menu.close(true); return true; }
      if (options.getTool() === 'bus-line' && state.draft.stopIds.length) { state = undoStop(state); message = draftHint(city(), state.draft); refresh(); return true; }
      if (panel.isOpen()) { panel.close(); return true; }
      return false;
    },
  };
}
