import './signal-panel.css';
import type { City } from './sim.ts';
import { captureCitySignals, requestForCapture, buildLocalSignalReport, METRIC_LABELS, UNIT_LABELS } from './signal-data.ts';
import type { SignalCapture, SignalReport } from './signal-data.ts';
import { requestSignalReport, signalConnectionReady } from './signal-client.ts';
import type { SignalConnection, SignalTransportResult } from './signal-client.ts';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const valueText = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
const label = (id: string) => METRIC_LABELS[id as keyof typeof METRIC_LABELS] || id;
const unit = (id: string) => UNIT_LABELS[id as keyof typeof UNIT_LABELS] || id;
const windowText = (window: { startTick: number; endTick: number }) => window.startTick === window.endTick ? `วันที่ ${window.endTick}` : `วันที่ ${window.startTick} ถึง ${window.endTick}`;

/** Read-only captured reports. History lives only in this panel, never in the game save. */
export function createSignalPanel(host: HTMLElement, { getCity, connection }: { getCity: () => City; connection?: SignalConnection }) {
  let owner: City | null = null;
  let current: SignalCapture | null = null;
  let previous: SignalCapture | undefined;
  let cancellation: AbortController | null = null;
  let revision = 0;
  host.classList.add('signal-panel');
  const controls = node('div', 'signal-controls');
  const mode = node('p', 'signal-mode', 'คำนวณในเกม · ออฟไลน์'); mode.id = 'signal-mode'; mode.dataset.mode = 'offline'; mode.setAttribute('role', 'status');
  const refreshButton = node('button', 'signal-refresh', 'จับภาพใหม่'); refreshButton.id = 'signal-refresh'; refreshButton.type = 'button';
  controls.append(mode, refreshButton);
  const captured = node('span'); captured.id = 'signal-captured-tick';
  const present = node('span'); present.id = 'signal-current-tick';
  const stamp = node('p', 'signal-stamp'); stamp.append(captured, present);
  const stale = node('p', 'signal-stale', 'เมืองเดินต่อแล้ว รายงานนี้ยังเป็นภาพที่จับไว้ กดจับภาพใหม่เพื่อดูค่าปัจจุบัน'); stale.hidden = true;
  const content = node('div', 'signal-report');
  host.replaceChildren(controls, stamp, stale, content);

  function sync() {
    const city = getCity();
    if (owner && (owner !== city || current && city.tick < current.tick)) { reset(); return; }
    present.textContent = `เมืองปัจจุบัน: วันที่ ${city.tick}`;
    present.dataset.tick = String(city.tick);
    captured.textContent = current ? `ข้อมูลที่จับไว้: วันที่ ${current.tick}` : 'ยังไม่ได้จับภาพข้อมูล';
    captured.dataset.tick = current ? String(current.tick) : '';
    const isStale = current !== null && current.tick !== city.tick;
    stale.hidden = !isStale;
    host.dataset.stale = String(isStale);
  }
  function setMode(kind: 'offline' | 'pending' | 'ai' | 'fallback', text: string) {
    mode.dataset.mode = kind; mode.textContent = text;
  }
  function block(title: string) {
    const section = node('section', 'signal-block'); section.append(node('h3', '', title)); return section;
  }
  function render(report: SignalReport) {
    const stocks = block('ข้อมูลที่วัดได้');
    const grid = node('div', 'signal-metrics');
    for (const metric of report.data.metrics) {
      const card = node('dl', 'signal-metric'); card.dataset.signalMetric = metric.id; card.dataset.value = String(metric.value);
      card.append(node('dt', '', label(metric.id)), node('dd', '', valueText(metric.value)), node('small', '', `${unit(metric.unit)} · ${windowText(metric.window)}`));
      grid.append(card);
    }
    stocks.append(grid, node('p', 'signal-note', '1 tick = 1 วัน · เงินแสดงเป็นเครดิตเกม (100 สตางค์ = 1 เครดิต) เงินเข้าออกนับเฉพาะรายการคลังในวันที่จับภาพ รวมทุนตั้งเมืองและค่าก่อสร้างถ้ามี ไม่ใช่รายได้ประจำหรือยอดรวมหลายวัน'));

    const signals = block('สัญญาณจากกฎคำนวณ');
    if (!report.data.signals.length) signals.append(node('p', '', 'ยังไม่มีสัญญาณที่มีข้อมูลพอคำนวณ'));
    for (const signal of report.data.signals) {
      const card = node('details', 'signal-observation'); card.dataset.signalId = signal.id;
      const summary = node('summary');
      const observation = report.report.observations.find(item => item.signalRefs.includes(signal.id));
      card.dataset.emphasized = String(observation?.emphasized === true);
      const refs = signal.metricRefs.map(label).join(' / ');
      const title = signal.kind === 'trend'
        ? `${refs}: ${signal.direction === 'up' ? 'เพิ่มขึ้น' : signal.direction === 'down' ? 'ลดลง' : 'เท่าเดิม'} ${valueText(Math.abs(signal.delta))} ${unit(signal.unit)}`
        : signal.id === 'threshold.net-flow-negative'
          ? `เงินออกมากกว่าเงินเข้าในวันข้อมูล: ${signal.conditionMet ? 'เป็นจริง' : 'ไม่เป็นจริง'}`
          : signal.id === 'threshold.treasury-negative'
            ? `เงินคลังต่ำกว่า 0: ${signal.conditionMet ? 'เป็นจริง' : 'ไม่เป็นจริง'}`
            : `${refs}: เงื่อนไข${signal.conditionMet ? 'เป็นจริง' : 'ไม่เป็นจริง'}`;
      summary.append(node('span', 'signal-observation-title', title));
      if (observation?.emphasized) summary.append(node('small', 'signal-selected', 'ในสรุป'));
      const detail = node('div', 'signal-observation-detail');
      if (observation) detail.append(node('p', '', observation.text));
      detail.append(node('p', 'signal-note', `${windowText(signal.window)} · ${unit(signal.unit)}`), node('code', 'signal-id', signal.id), node('p', 'signal-note', `กฎ: ${signal.source} · อ้างอิง: ${signal.metricRefs.join(', ')}`));
      card.append(summary, detail); signals.append(card);
    }
    if (report.report.groups.length) signals.append(node('p', 'signal-note', `กลุ่มสัญญาณ: ${report.report.groups.map(group => ({ population: 'ครัวเรือน', economy: 'เศรษฐกิจ', wellbeing: 'คุณภาพชีวิต', environment: 'สิ่งแวดล้อม', mobility: 'การเดินทาง' })[group.category] + ` (${group.signalIds.length})`).join(' · ')}`));
    signals.append(node('p', 'signal-note', 'การเปลี่ยนแปลงและเงื่อนไขเป็นข้อสังเกตจากตัวเลข ไม่ใช่ระดับความรุนแรงหรือข้อสรุปสาเหตุ ไม่มีการแก้ไขเงิน บัญชี หรือการจำลอง'));

    const missing = node('details', 'signal-missing');
    missing.append(node('summary', '', `ข้อมูลที่ยังขาด (${report.data.missingData.length} รายการ)`));
    const missingList = node('ul');
    for (const flag of report.data.missingData) {
      const reason = flag.reason === 'prior_metric_unavailable' ? 'ยังไม่มีภาพก่อนหน้าสำหรับเปรียบเทียบ' : flag.reason === 'threshold_inputs_unavailable' ? 'ข้อมูลประกอบเงื่อนไขยังไม่ครบ' : 'เกมยังไม่มีข้อมูลที่ตรงหน่วยนี้';
      const row = node('li', '', `${flag.metricRefs.map(label).join(' / ')}: ${reason}`); row.dataset.missingId = flag.id; missingList.append(row);
    }
    missing.append(node('p', 'signal-note', 'ข้อมูลที่ไม่มีจะไม่ถูกแทนด้วย 0 เกมรุ่นนี้นับครัวเรือน ไม่ได้วัดจำนวนคน ความสุข มลพิษ หรือการจราจร ภาพก่อนหน้าจะเริ่มสะสมเมื่อจับภาพในคนละวัน และล้างเมื่อโหลดหรือเริ่มเมืองใหม่'), missingList);
    const provenance = node('details', 'signal-provenance'); provenance.append(node('summary', '', 'ที่มาและขอบเขตข้อมูล'));
    provenance.append(node('p', 'signal-note', `ข้อมูลจาก: ${report.data.provenance.input} · กฎ: ${report.data.provenance.derivation}`), node('p', 'signal-note', 'เป็นข้อมูลสรุปที่เบราว์เซอร์รายงาน ยังไม่ได้ตรวจรับรองกับบัญชีฝั่งเซิร์ฟเวอร์ ไม่มีข้อมูลรายครัวเรือนหรือรายบริษัทถูกส่งไป'));
    for (const limitation of report.report.limitations) provenance.append(node('p', 'signal-note', limitation));
    content.replaceChildren(stocks, signals, missing, provenance);
    sync();
  }
  function showResult(result: SignalTransportResult) {
    render(result.report);
    if (result.transport === 'offline') setMode('offline', 'คำนวณในเกม · ออฟไลน์ · ยังไม่เปิด API');
    else if (result.transport === 'remote' && result.report.mode === 'ai') setMode('ai', 'Typhoon จัดกลุ่มสัญญาณ · อ้างอิงผ่านการตรวจสอบ');
    else if (result.transport === 'remote') setMode('fallback', 'เซิร์ฟเวอร์ใช้ผลคำนวณสำรอง · ไม่ใช้คำตอบที่ตรวจสอบไม่ได้');
    else setMode('fallback', 'เชื่อมต่อไม่ได้หรือคำตอบไม่ผ่านตรวจสอบ · แสดงผลคำนวณในเกม');
  }
  function close() {
    revision++; cancellation?.abort(); cancellation = null; refreshButton.disabled = false;
    if (mode.dataset.mode === 'pending') setMode('offline', 'ยกเลิกการเชื่อมต่อ · แสดงผลคำนวณในเกม');
  }
  function reset() {
    close(); owner = null; current = null; previous = undefined;
    host.dataset.snapshotTick = ''; setMode('offline', 'คำนวณในเกม · ออฟไลน์');
    content.replaceChildren(node('p', 'signal-note', 'จับภาพข้อมูลเมืองเพื่ออ่านตัวเลขและสัญญาณ รายงานนี้อ่านอย่างเดียว'));
    sync();
  }
  function refresh() {
    close(); const city = getCity();
    if (owner !== city || current && city.tick < current.tick) { current = null; previous = undefined; }
    owner = city;
    const next = captureCitySignals(city);
    if (current && next.tick > current.tick) previous = current;
    current = next;
    const input = requestForCapture(current, previous, 'th');
    const local = buildLocalSignalReport(input);
    host.dataset.snapshotTick = String(current.tick);
    render(local); setMode('offline', 'คำนวณในเกม · ออฟไลน์ · ยังไม่เปิด API');
    if (!signalConnectionReady(connection)) return;
    cancellation = new AbortController();
    const ownRevision = revision;
    refreshButton.disabled = true; setMode('pending', 'กำลังตรวจกลุ่มสัญญาณ · ผลคำนวณในเกมแสดงอยู่ด้านล่าง');
    void requestSignalReport(input, local, connection, fetch, cancellation.signal).then(result => {
      if (ownRevision !== revision || owner !== getCity()) return;
      cancellation = null; refreshButton.disabled = false; showResult(result);
    });
  }
  refreshButton.addEventListener('click', refresh);
  reset();
  return { refresh, reset, close, sync };
}
