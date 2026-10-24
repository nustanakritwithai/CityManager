import './entity-explanation-panel.css';
import type { City } from './sim.ts';
import {
  captureEntityExplanation, buildLocalEntityExplanation, entityExplanationRows,
  entityFactEvidence, ENTITY_KIND_LABELS,
} from './entity-explanation-data.ts';
import type { EntitySelection, EntitySnapshot, EntityRequest, EntityResponse } from './entity-explanation-data.ts';
import { entityConnectionReady, requestEntityExplanation } from './entity-explanation-client.ts';
import type { EntityConnection } from './entity-explanation-client.ts';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const selectionKey = (selection: EntitySelection | null): string => !selection ? '' : selection.kind === 'building'
  ? `building:${selection.buildingId}`
  : `household:${selection.householdId}:${selection.sourceBuildingId}:${selection.sourceCell}`;

type PanelOptions = {
  getCity: () => City;
  getSelection: () => EntitySelection | null;
  connection?: EntityConnection;
  fetchImpl?: typeof fetch;
};

/** A captured explanation never changes the simulation or starts analysis from a clock update. */
export function createEntityExplanationPanel(host: HTMLElement, { getCity, getSelection, connection, fetchImpl = fetch }: PanelOptions) {
  let owner: City | null = null;
  let scope = '';
  let current: EntitySnapshot | null = null;
  let local: EntityResponse | null = null;
  let input: EntityRequest | null = null;
  let controller: AbortController | null = null;
  let revision = 0;

  host.classList.add('entity-explanation-panel');
  const heading = node('h3', '', 'อธิบายข้อมูลที่เลือก');
  const introduction = node('p', 'entity-explain-note', 'จับภาพรายการนี้เพื่ออ่านข้อสังเกตและสิ่งที่ควรตรวจต่อ ข้อมูลอ่านอย่างเดียว');
  const controls = node('div', 'entity-explain-controls');
  const mode = node('p', 'entity-explain-mode', 'คำนวณในเครื่อง'); mode.id = 'entity-explain-mode'; mode.dataset.mode = 'local'; mode.setAttribute('role', 'status'); mode.setAttribute('aria-live', 'polite');
  const actions = node('div', 'entity-explain-actions');
  const captureButton = node('button', '', 'อ่านข้อมูลรายการนี้'); captureButton.id = 'entity-explain-capture'; captureButton.type = 'button';
  const cancelButton = node('button', '', 'ยกเลิก'); cancelButton.id = 'entity-explain-cancel'; cancelButton.type = 'button'; cancelButton.hidden = true;
  const retryButton = node('button', '', 'ลองภาพเดิมอีกครั้ง'); retryButton.id = 'entity-explain-retry'; retryButton.type = 'button'; retryButton.hidden = true;
  actions.append(captureButton, cancelButton, retryButton); controls.append(mode, actions);
  const status = node('p', 'entity-explain-status'); status.id = 'entity-explain-status'; status.hidden = true;
  const stamp = node('p', 'entity-explain-stamp'); stamp.id = 'entity-explain-stamp';
  const stale = node('p', 'entity-explain-stale'); stale.id = 'entity-explain-stale'; stale.hidden = true;
  const content = node('div', 'entity-explain-content'); content.id = 'entity-explain-content';
  host.replaceChildren(heading, introduction, controls, status, stamp, stale, content);

  function setMode(kind: 'local' | 'pending' | 'ai' | 'fallback', text: string) {
    mode.dataset.mode = kind; mode.textContent = text;
  }
  function message(text = '') { status.textContent = text; status.hidden = !text; }
  function busy(value: boolean) {
    captureButton.disabled = value; cancelButton.hidden = !value;
    if (value) retryButton.hidden = true;
    host.dataset.pending = String(value);
  }
  function cancelPending() {
    revision++; controller?.abort(); controller = null; busy(false);
  }
  function clearCapture() {
    cancelPending(); current = null; local = null; input = null;
    for (const name of ['snapshotKey', 'entityId', 'entityKind', 'snapshotTick']) host.dataset[name] = '';
    host.dataset.stale = 'false'; stale.hidden = true; retryButton.hidden = true;
    message(); setMode('local', 'คำนวณในเครื่อง');
    content.replaceChildren(node('p', 'entity-explain-note', 'ยังไม่มีภาพข้อมูล กดอ่านข้อมูลรายการนี้เมื่อพร้อม'));
  }
  function section(title: string, id: string) {
    const result = node('section', 'entity-explain-section'); result.id = id; result.append(node('h4', '', title)); return result;
  }
  function render(report: EntityResponse, snapshot: EntitySnapshot) {
    const rows = entityExplanationRows(report);
    const observations = section('สิ่งที่เห็นจากข้อมูล', 'entity-explain-observations');
    const hypotheses = section('ข้อสันนิษฐานที่ต้องตรวจต่อ', 'entity-explain-hypotheses');
    const checks = section('ควรตรวจอะไรต่อ', 'entity-explain-checks');
    for (const [target, records] of [[observations, rows.observations], [hypotheses, rows.hypotheses], [checks, rows.checks]] as const) {
      for (const row of records) {
        const line = node('p', 'entity-explain-row', row.text);
        line.dataset.entityRecordId = row.id;
        line.dataset.entityEvidenceId = row.factRefs[0] ?? '';
        line.dataset.entityFactRefs = row.factRefs.join(' ');
        target.append(line);
      }
    }
    if (!rows.observations.length) observations.append(node('p', 'entity-explain-note', 'หลักฐานที่มีในภาพนี้ยังไม่พอสรุปข้อสังเกต'));
    if (!rows.hypotheses.length) hypotheses.append(node('p', 'entity-explain-note', 'ยังไม่มีข้อสันนิษฐานที่มีหลักฐานพอให้แสดง'));
    else hypotheses.append(node('p', 'entity-explain-note', 'รายการนี้เป็นเพียงความเป็นไปได้ ไม่ใช่ข้อยืนยันสาเหตุ'));
    if (!rows.checks.length) checks.append(node('p', 'entity-explain-note', 'ตรวจตัวเลขต้นทางและจับภาพใหม่เมื่อมีข้อมูลเพิ่ม'));

    const evidence = node('details', 'entity-explain-evidence'); evidence.id = 'entity-explain-evidence';
    evidence.append(node('summary', '', 'ตรวจตัวเลขและรหัสอ้างอิง'));
    const facts = node('ul');
    for (const fact of snapshot.facts) {
      const line = node('li', '', entityFactEvidence(snapshot, fact.id));
      line.dataset.entityFactId = fact.id; line.dataset.value = String(fact.value); line.dataset.unit = fact.unit; line.dataset.period = fact.period;
      line.append(node('code', '', fact.id)); facts.append(line);
    }
    evidence.append(facts);
    const missing = node('details', 'entity-explain-missing'); missing.id = 'entity-explain-missing';
    missing.append(node('summary', '', `ข้อมูลที่ยังไม่พอ (${snapshot.missing.length} รายการ)`));
    if (!snapshot.missing.length) missing.append(node('p', 'entity-explain-note', 'ไม่มีช่องข้อมูลที่ขาดสำหรับภาพนี้'));
    for (const flag of snapshot.missing) {
      const line = node('p', '', entityFactEvidence(snapshot, flag.id)); line.dataset.entityMissingId = flag.id; missing.append(line);
    }
    const note = node('p', 'entity-explain-note', 'ยอดเงินเข้า/ออกเป็นการเคลื่อนไหวของกระเป๋าในช่วงที่แสดง ข้อมูลที่ขาดไม่ถูกแทนด้วยศูนย์ คำอธิบายนี้ไม่เปลี่ยนเงินหรือการจำลอง');
    content.replaceChildren(observations, hypotheses, checks, evidence, missing, note);
  }
  function sync() {
    const city = getCity(), selection = getSelection(), nextScope = selectionKey(selection);
    if (owner !== city || scope !== nextScope) {
      clearCapture(); owner = city; scope = nextScope;
    }
    host.hidden = !selection;
    host.dataset.selectionKey = scope;
    if (!selection) { stamp.textContent = ''; return; }
    if (!current) {
      stamp.textContent = `เมืองปัจจุบัน: วันที่ ${city.tick} · ยังไม่ได้จับภาพรายการนี้`;
      return;
    }
    // A read-only probe detects changed facts without replacing the captured report or sending it.
    const present = captureEntityExplanation(city, selection);
    if (!present) {
      clearCapture();
      stamp.textContent = `เมืองปัจจุบัน: วันที่ ${city.tick}`;
      message('ภาพนี้ยังไม่มีหลักฐานของรายการในบริบทที่เลือก กดอ่านข้อมูลอีกครั้งเมื่อข้อมูลพร้อม หรือเลือกรายการปัจจุบันใหม่');
      return;
    }
    const changed = present.snapshotKey !== current.snapshotKey;
    const type = ENTITY_KIND_LABELS[current.entity.kind];
    const window = current.window.empty ? 'ยังไม่มีงวดเงินที่เริ่มแล้ว' : `เงินเข้า/ออกวันที่ ${current.window.fromTick}–${current.window.toTick}`;
    stamp.textContent = `${type} #${current.entity.id} · ภาพวันที่ ${current.tick} · ${window} · เมืองปัจจุบันวันที่ ${city.tick}`;
    host.dataset.stale = String(changed); stale.hidden = !changed;
    if (changed) stale.textContent = city.tick === current.tick
      ? 'ข้อมูลรายการนี้เปลี่ยนแล้วในวันเดียวกัน คำอธิบายยังใช้ภาพเดิม กดอ่านข้อมูลรายการนี้เพื่อจับภาพใหม่'
      : `เมืองเดินต่อแล้ว ${city.tick - current.tick} วัน คำอธิบายยังอ้างอิงภาพวันที่ ${current.tick} กดอ่านข้อมูลรายการนี้เพื่อจับภาพใหม่`;
  }
  function close() {
    const wasPending = mode.dataset.mode === 'pending'; cancelPending();
    if (wasPending) {
      setMode('local', 'ยกเลิกแล้ว · ใช้ผลในเครื่อง');
      message('หยุดรอคำตอบแล้ว คำตอบที่มาทีหลังจะไม่เปลี่ยนภาพนี้');
      retryButton.hidden = !current || !entityConnectionReady(connection);
    }
  }
  function reset() { clearCapture(); owner = getCity(); scope = selectionKey(getSelection()); sync(); }
  function requestCaptured() {
    sync();
    if (!current || !local || !input || !entityConnectionReady(connection)) return;
    close();
    const captured = current, ownInput = input, ownLocal = local, ownCity = owner, ownScope = scope;
    controller = new AbortController(); const ownRevision = revision;
    busy(true); setMode('pending', 'กำลังรอ Typhoon…'); message('กำลังอ่านภาพที่จับไว้ ผลคำนวณในเครื่องยังอ่านได้ด้านล่าง');
    void requestEntityExplanation(ownInput, ownLocal, connection, fetchImpl, controller.signal).then(result => {
      if (ownRevision !== revision || ownCity !== getCity() || ownScope !== selectionKey(getSelection()) || current !== captured) return;
      const selection = getSelection();
      if (!selection || !captureEntityExplanation(getCity(), selection)) { sync(); return; }
      controller = null; busy(false); render(result.report, captured); retryButton.hidden = true; message();
      if (result.transport === 'remote' && result.report.mode === 'ai') setMode('ai', 'Typhoon เลือกประเด็นแล้ว · อ้างอิงตรงกับภาพ');
      else if (result.transport === 'offline') setMode('local', 'คำนวณในเครื่อง');
      else {
        setMode('fallback', 'ใช้คำอธิบายในเครื่อง');
        message(result.reason === 'timeout' ? 'รอครบ 20 วินาทีแล้ว ข้อมูลในเครื่องยังอ่านได้ ลองส่งภาพเดิมอีกครั้งได้' : result.reason === 'invalid_report' ? 'คำตอบไม่ตรงกับภาพหรือหลักฐานนี้ จึงใช้คำอธิบายในเครื่อง' : 'ยังไม่ได้คำตอบที่ตรวจสอบได้ จึงใช้คำอธิบายในเครื่อง');
        retryButton.hidden = false;
      }
      sync();
    });
  }
  function capture() {
    sync(); close();
    const city = getCity(), selection = getSelection();
    const snapshot = captureEntityExplanation(city, selection);
    if (!snapshot) { clearCapture(); message('ยังไม่มีหลักฐานของรายการที่เลือก เลือกอาคารหรือครัวเรือนปัจจุบันใหม่'); return; }
    owner = city; scope = selectionKey(selection); current = snapshot; local = buildLocalEntityExplanation(snapshot);
    input = { schemaVersion: 2, operation: 'entity-explanation', locale: 'th', snapshot };
    host.dataset.snapshotKey = snapshot.snapshotKey; host.dataset.entityId = String(snapshot.entity.id);
    host.dataset.entityKind = snapshot.entity.kind; host.dataset.snapshotTick = String(snapshot.tick);
    render(local, snapshot); retryButton.hidden = true; message(); setMode('local', 'คำนวณในเครื่อง'); sync();
    if (entityConnectionReady(connection)) requestCaptured();
    else message('คำอธิบายจากข้อมูลในเครื่อง · Typhoon สำหรับรายการนี้ยังไม่เปิดใช้งาน');
  }
  captureButton.addEventListener('click', capture); cancelButton.addEventListener('click', close); retryButton.addEventListener('click', requestCaptured);
  reset(); return { sync, close, reset };
}
