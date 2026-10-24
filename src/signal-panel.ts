import './signal-panel.css';
import type { City } from './sim.ts';
import { captureCitySignals, requestForCapture, buildLocalSignalReport, METRIC_LABELS, UNIT_LABELS } from './signal-data.ts';
import type { SignalCapture, SignalReport, SignalRequest } from './signal-data.ts';
import { readingSignal, readingComparison, readingWindow } from './signal-reading.ts';
import { requestSignalReport, signalConnectionReady } from './signal-client.ts';
import type { SignalConnection, SignalTransportResult } from './signal-client.ts';
import { createCityQuestionsPanel } from './city-questions-panel.ts';

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
  let lastInput: SignalRequest | null = null;
  let localReport: SignalReport | null = null;
  let cancellation: AbortController | null = null;
  let revision = 0;
  host.classList.add('signal-panel');
  const controls = node('div', 'signal-controls');
  const mode = node('p', 'signal-mode', 'คำนวณในเครื่อง'); mode.id = 'signal-mode'; mode.dataset.mode = 'offline'; mode.setAttribute('role', 'status'); mode.setAttribute('aria-live', 'polite');
  const actions = node('div', 'signal-actions');
  const refreshButton = node('button', 'signal-refresh', 'จับภาพใหม่'); refreshButton.id = 'signal-refresh'; refreshButton.type = 'button';
  const cancelButton = node('button', '', 'ยกเลิก'); cancelButton.id = 'signal-cancel'; cancelButton.type = 'button'; cancelButton.hidden = true;
  const retryButton = node('button', '', 'ลอง Typhoon อีกครั้ง'); retryButton.id = 'signal-retry'; retryButton.type = 'button'; retryButton.hidden = true;
  actions.append(refreshButton, cancelButton, retryButton); controls.append(mode, actions);
  const feedback = node('p', 'signal-request-feedback'); feedback.id = 'signal-request-feedback'; feedback.hidden = true;
  const captured = node('span'); captured.id = 'signal-captured-tick';
  const present = node('span'); present.id = 'signal-current-tick';
  const stamp = node('p', 'signal-stamp'); stamp.append(captured, present);
  const stale = node('p', 'signal-stale'); stale.hidden = true;
  const content = node('div', 'signal-report');
  const questions = node('details', 'signal-questions'); questions.id = 'city-fact-questions';
  const questionHost = node('div'); questionHost.id = 'city-fact-question-content';
  questions.append(node('summary', '', 'ถามข้อเท็จจริงของเมือง บ้าน และกิจการ'), questionHost);
  host.replaceChildren(controls, feedback, stamp, stale, content, questions);
  const questionPanel = createCityQuestionsPanel(questionHost, { getCity });
  questions.addEventListener('toggle', () => { if (questions.open) questionPanel.sync(); });

  function sync() {
    const city = getCity();
    if (owner && (owner !== city || current && city.tick < current.tick)) { reset(); return; }
    present.textContent = `เมืองปัจจุบัน: วันที่ ${city.tick}`;
    present.dataset.tick = String(city.tick);
    captured.textContent = current ? `ภาพที่จับ: วันที่ ${current.tick}` : 'ยังไม่ได้จับภาพข้อมูล';
    captured.dataset.tick = current ? String(current.tick) : '';
    const isStale = current !== null && current.tick !== city.tick;
    stale.hidden = !isStale;
    if (isStale) stale.textContent = `เมืองเดินต่อแล้ว ${city.tick - current!.tick} วัน รายงานยังอ้างอิงวันที่ ${current!.tick} กดจับภาพใหม่เพื่ออ่านค่าปัจจุบัน`;
    host.dataset.stale = String(isStale);
    if (questions.open) questionPanel.sync();
  }
  function setMode(kind: 'offline' | 'pending' | 'ai' | 'fallback', text: string) {
    mode.dataset.mode = kind; mode.textContent = text;
  }
  function message(text = '') {
    feedback.textContent = text; feedback.hidden = !text;
  }
  function busy(value: boolean) {
    refreshButton.disabled = value; cancelButton.hidden = !value;
    if (value) retryButton.hidden = true;
    host.dataset.pending = String(value);
  }
  function block(title: string) {
    const section = node('section', 'signal-block'); section.append(node('h3', '', title)); return section;
  }
  function render(report: SignalReport) {
    const highlights = block('อ่านภาพเมืองอย่างไร'); highlights.id = 'signal-summary';
    highlights.append(node('p', 'signal-note', readingWindow(report)));
    const selected = report.report.summarySignalIds.map(id => report.data.signals.find(signal => signal.id === id)!).filter(Boolean);
    if (!selected.length) highlights.append(node('p', '', 'ข้อมูลยังไม่พอสร้างสัญญาณ ดูตัวเลขและรายการข้อมูลที่ขาดด้านล่าง'));
    for (const signal of selected) {
      const jump = node('button', 'signal-summary-link', readingSignal(signal, report).title);
      jump.type = 'button'; jump.dataset.signalRef = signal.id;
      jump.addEventListener('click', () => {
        const detail = Array.from(content.querySelectorAll<HTMLDetailsElement>('[data-signal-id]')).find(row => row.dataset.signalId === signal.id);
        if (detail) { detail.open = true; detail.scrollIntoView({ block: 'nearest' }); detail.querySelector('summary')?.focus(); }
      });
      highlights.append(jump);
    }
    highlights.append(node('p', 'signal-note', report.mode === 'ai' ? 'Typhoon เลือกสัญญาณสรุปจากรายการที่คำนวณได้ แตะเพื่อดูตัวเลขและที่มา' : 'สรุปจากกฎคำนวณในเครื่อง แตะเพื่อดูตัวเลขและที่มา'));

    const comparison = node('details', 'signal-comparison'); comparison.id = 'signal-comparison';
    comparison.dataset.priorTick = String(report.data.provenance.comparisonPriorTick ?? '');
    comparison.append(node('summary', '', 'เทียบภาพที่จับไว้'), node('p', 'signal-note', readingWindow(report)));
    comparison.append(node('p', 'signal-note', 'ผลต่าง = ค่าภาพล่าสุด − ค่าภาพก่อนหน้า ไม่ได้บอกค่าของทุกวันระหว่างนั้น เงินเข้า/ออกเป็นยอดของแต่ละวัน ไม่ใช่ยอดรวมตลอดช่วง'));
    for (const row of readingComparison(report)) {
      const entry = node('div', 'signal-comparison-row');
      entry.dataset.comparisonMetric = row.id; entry.dataset.current = String(row.current);
      entry.dataset.prior = row.prior === null ? '' : String(row.prior); entry.dataset.delta = row.delta === null ? '' : String(row.delta);
      entry.append(node('strong', '', `${row.label} · ${row.unit}`));
      const cells = node('div', 'signal-comparison-values');
      for (const [caption, value] of [['ก่อนหน้า', row.prior], ['ภาพล่าสุด', row.current], ['ผลต่าง', row.delta]] as const) {
        const cell = node('span'); cell.append(node('small', '', caption), node('span', '', value === null ? 'ไม่มีภาพเทียบ' : `${caption === 'ผลต่าง' && value > 0 ? '+' : ''}${valueText(value)}`)); cells.append(cell);
      }
      entry.append(cells, node('code', 'signal-id', row.id)); comparison.append(entry);
    }

    const stocks = block('ตัวเลขในภาพล่าสุด');
    const grid = node('div', 'signal-metrics');
    for (const metric of report.data.metrics) {
      const card = node('dl', 'signal-metric'); card.dataset.signalMetric = metric.id; card.dataset.value = String(metric.value);
      card.append(node('dt', '', label(metric.id)), node('dd', '', valueText(metric.value)), node('small', '', `${unit(metric.unit)} · ${windowText(metric.window)}`)); grid.append(card);
    }
    stocks.append(grid, node('p', 'signal-note', '1 tick = 1 วัน · เงินแสดงในเครดิต (100 สตางค์ = 1 เครดิต) เงินเข้า/ออกนับเฉพาะรายการคลังในวันที่จับภาพ รวมทุนเริ่มเมืองและค่าก่อสร้างถ้ามี ไม่ใช่รายรับประจำหรือยอดรวมหลายวัน'));

    const signals = block('ตรวจที่มาของสัญญาณ');
    if (!report.data.signals.length) signals.append(node('p', '', 'ยังไม่มีสัญญาณที่มีข้อมูลพอคำนวณ'));
    for (const signal of report.data.signals) {
      const reading = readingSignal(signal, report);
      const card = node('details', 'signal-observation'); card.dataset.signalId = signal.id;
      const summary = node('summary'); summary.tabIndex = 0;
      const emphasized = report.report.summarySignalIds.includes(signal.id); card.dataset.emphasized = String(emphasized);
      summary.append(node('span', 'signal-observation-title', reading.title));
      if (emphasized) summary.append(node('small', 'signal-selected', 'สรุป'));
      const detail = node('div', 'signal-observation-detail'); detail.append(node('p', 'signal-explanation', reading.explanation));
      const technical = node('details', 'signal-technical'); technical.append(node('summary', '', 'รหัสอ้างอิงและสูตรคำนวณ'));
      for (const evidence of reading.evidence) technical.append(node('p', 'signal-evidence', evidence));
      technical.append(node('code', 'signal-id', signal.id), node('p', 'signal-note', `กฎ: ${signal.source} · อ้างอิง: ${signal.metricRefs.join(', ')}`));
      detail.append(technical);
      card.append(summary, detail); signals.append(card);
    }
    signals.append(node('p', 'signal-note', 'การเปลี่ยนแปลงและเงื่อนไขเป็นข้อสังเกตจากตัวเลข ไม่ใช่ระดับความรุนแรงหรือข้อสรุปสาเหตุ ไม่มีการแก้เงิน บัญชี หรือการจำลอง'));

    const missing = node('details', 'signal-missing');
    missing.append(node('summary', '', `ข้อมูลที่ยังขาด (${report.data.missingData.length} รายการ)`));
    const missingList = node('ul');
    for (const flag of report.data.missingData) {
      const reason = flag.reason === 'prior_metric_unavailable' ? 'ยังไม่มีภาพก่อนหน้าสำหรับเปรียบเทียบ' : flag.reason === 'threshold_inputs_unavailable' ? 'ข้อมูลประกอบเงื่อนไขยังไม่ครบ' : 'เกมยังไม่มีข้อมูลที่ตรงหน่วยนี้';
      const row = node('li', '', `${flag.metricRefs.map(label).join(' / ')}: ${reason}`); row.dataset.missingId = flag.id; missingList.append(row);
    }
    missing.append(node('p', 'signal-note', 'ค่าที่ขาดไม่ถูกแทนด้วย 0 ประชากรนับสมาชิก แยกจากครัวเรือน ไม่มีค่าความสุข มลพิษ หรือจราจร ภาพก่อนหน้ามีเฉพาะที่เคยจับในครั้งนี้ ล้างเมื่อโหลดหรือเริ่มเมืองใหม่'), missingList);
    const provenance = node('details', 'signal-provenance'); provenance.append(node('summary', '', 'ที่มาและขอบเขตข้อมูล'));
    provenance.append(node('p', 'signal-note', `ข้อมูลจาก: ${report.data.provenance.input} · กฎ: ${report.data.provenance.derivation}`), node('p', 'signal-note', 'ส่งเฉพาะข้อมูลสรุปที่แสดงในรายงาน ไม่มีรายละเอียดรายครัวเรือนหรือบริษัท'));
    provenance.append(node('p', 'signal-note', 'ภาพข้อมูลมาจากเกมในเครื่อง ยังไม่ได้ตรวจรับรองกับบัญชีฝั่งเซิร์ฟเวอร์ รายงานไม่แก้การจำลองหรือยืนยันสาเหตุ'));
    content.replaceChildren(highlights, comparison, stocks, signals, missing, provenance); sync();
  }
  function showResult(result: SignalTransportResult) {
    render(result.report); retryButton.hidden = true; message();
    if (result.transport === 'offline') setMode('offline', 'คำนวณในเครื่อง · ออฟไลน์');
    else if (result.transport === 'remote' && result.report.mode === 'ai') setMode('ai', 'Typhoon จัดกลุ่มแล้ว · ตรวจอ้างอิงผ่าน');
    else {
      setMode('fallback', 'ใช้ผลคำนวณในเครื่อง');
      message(result.reason === 'timeout' ? 'รอ Typhoon ครบ 20 วินาทีแล้ว ตัวเลขยังอ่านได้ ลองส่งภาพเดิมอีกครั้งได้' : result.reason === 'invalid_report' ? 'คำตอบอ้างอิงไม่ตรงกับภาพนี้ จึงใช้สรุปในเครื่อง ลองส่งภาพเดิมอีกครั้งได้' : result.reason === 'provider_fallback' ? 'บริการส่งผลสำรองกลับมา ตัวเลขยังอ่านได้ ลองส่งภาพเดิมอีกครั้งได้' : 'ยังติดต่อ Typhoon ไม่สำเร็จ ตัวเลขยังอ่านได้ ลองส่งภาพเดิมอีกครั้งได้');
      retryButton.hidden = !signalConnectionReady(connection);
    }
  }
  function close() {
    revision++; cancellation?.abort(); cancellation = null; busy(false);
    if (mode.dataset.mode === 'pending') {
      setMode('offline', 'ยกเลิกแล้ว · ใช้ผลคำนวณในเครื่อง'); message('หยุดรอคำตอบแล้ว คำตอบที่มาทีหลังจะไม่เปลี่ยนรายงาน ลองส่งภาพเดิมอีกครั้งได้');
      retryButton.hidden = !signalConnectionReady(connection);
    }
  }
  function reset() {
    close(); owner = null; current = null; previous = undefined; lastInput = null; localReport = null;
    host.dataset.snapshotTick = ''; retryButton.hidden = true; message(); setMode('offline', 'คำนวณในเครื่อง');
    content.replaceChildren(node('p', 'signal-note', 'จับภาพข้อมูลเมืองเพื่ออ่านตัวเลขและสัญญาณ รายงานนี้อ่านอย่างเดียว')); sync();
    questionPanel.reset();
  }
  function request() {
    if (!lastInput || !localReport || !signalConnectionReady(connection)) return;
    close(); message('กำลังจัดกลุ่มภาพที่จับไว้ อ่านตัวเลขในเครื่องด้านล่างได้ทันที');
    cancellation = new AbortController(); const ownRevision = revision;
    busy(true); setMode('pending', 'กำลังรอ Typhoon…');
    void requestSignalReport(lastInput, localReport, connection, fetch, cancellation.signal).then(result => {
      if (ownRevision !== revision || owner !== getCity()) return;
      cancellation = null; busy(false); showResult(result);
    });
  }
  function refresh() {
    close(); const city = getCity();
    if (owner !== city || current && city.tick < current.tick) { current = null; previous = undefined; }
    owner = city; const next = captureCitySignals(city);
    if (current && next.tick > current.tick) previous = current;
    current = next; lastInput = requestForCapture(current, previous, 'th'); localReport = buildLocalSignalReport(lastInput);
    host.dataset.snapshotTick = String(current.tick); render(localReport); message(); retryButton.hidden = true;
    setMode('offline', 'คำนวณในเครื่อง · ออฟไลน์'); request();
  }
  refreshButton.addEventListener('click', refresh); cancelButton.addEventListener('click', close); retryButton.addEventListener('click', request);
  reset(); return { refresh, reset, close, sync };
}
