import './owner-decision-panel.css';
import { OWNER_FACT_LABELS, OWNER_REASON_TEXT, captureOwnerSnapshot, ownerProposalForCandidate, ownerStateHash, proposeOwnerDecision, type OwnerFactKey, type OwnerProposal, type OwnerExecutionOutcome } from './owner-decision.ts';
import { replayOwnerJournal, type createOwnerDecisionSession } from './owner-decision-session.ts';
import { ownerDecisionConnectionReady, requestOwnerDecision, type OwnerDecisionConnection } from './owner-decision-client.ts';
import { createOwnerMonthlyBatch, type OwnerMonthlyStepResult } from './owner-decision-monthly.ts';
import { MONTH, isMarket, type City } from './sim.ts';
import type { OwnerSnapshot } from './owner-decision.ts';

type Session = ReturnType<typeof createOwnerDecisionSession>;
type Options = { getCity(): City; getSession(): Session; onChange(): void; connection: OwnerDecisionConnection; fetchImpl?: typeof fetch; onTyphoonAutoPending?(active: boolean): void };
const money = (value: number | null) => value === null ? 'ยังคำนวณไม่ได้' : `${(value / 100).toLocaleString('th-TH', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ฿`;
const modeLabels = { off: 'ปิด', proposal: 'รับข้อเสนอ', auto: 'กฎทำรายการเอง', 'typhoon-auto': 'Typhoon ทำรายการเอง' } as const;
const commandLabels = { hold: 'คงเดิม', contributeOwnerCapital: 'เติมทุนจากครัวเรือน', withdrawOwnerProfit: 'ถอนกำไรเข้าครัวเรือน' } as const;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
}
function button(id: string, label: string, action: () => void) {
  const node = element('button', label); node.id = id; node.type = 'button'; node.addEventListener('click', action); return node;
}

/** Owner rules remain local; Typhoon is a one-shot, optional selector for a manual proposal. */
export function createOwnerDecisionPanel(host: HTMLDetailsElement, options: Options) {
  host.id = 'owner-decisions';
  const summary = element('summary'); summary.id = 'owner-decisions-toggle';
  summary.append(element('span', 'เจ้าของตลาด'), element('span', 'กฎในเครื่อง · Typhoon เมื่อกด', 'owner-summary-note'));
  const body = element('section', undefined, 'owner-body');
  body.append(element('h3', 'ข้อเสนอเจ้าของตลาดทั้งเมือง'));
  body.append(element('p', 'ข้อเสนอพื้นฐานมาจากกฎในเกม การขอ Typhoon เป็นการกดแยกแต่ละครั้ง และต้องตรวจพร้อมยืนยันก่อนย้ายเงินจริง', 'owner-note'));
  const modes = element('div', undefined, 'owner-modes'); modes.setAttribute('aria-label', 'โหมดเจ้าของตลาดทั้งเมือง');
  const processed = new Set<string>();
  let lastCity = options.getCity(), lastStatus = 'ready', resultText = '', busy = false, signature = '', revision = 0;
  let activeRequest: { controller: AbortController; city: City; snapshot: OwnerSnapshot; stateHash: string; generation: number; automatic: boolean } | null = null;
  let activeAutoBatch = false, batchRevision = 0, lastBatchStatus = 'idle';
  const monthlyBatch = createOwnerMonthlyBatch({
    getContext: () => ({ city: options.getCity(), mode: options.getSession().mode }),
    getFirmIds: city => [...city.firms].filter(isMarket).map(firm => firm.id),
    processFirm: async (city, firmId, controller) => {
      const [proposal] = options.getSession().evaluateTyphoonAutoMonthly(city, firmId);
      return proposal ? requestTyphoon(proposal, true, batchRevision, controller) : 'skipped';
    },
    onChange: state => {
      if (state.status === 'running' && lastBatchStatus !== 'running') batchRevision = ++revision;
      lastBatchStatus = state.status;
      activeAutoBatch = state.status === 'running'; busy = activeAutoBatch || activeRequest !== null;
      options.onTyphoonAutoPending?.(activeAutoBatch);
      if (state.status === 'running') {
        lastStatus = 'typhoon-auto-pending'; resultText = `Typhoon กำลังตรวจ ${state.completedFirmIds.length}/${state.total} กิจการ`;
      } else if (state.status === 'paused') {
        lastStatus = 'typhoon-auto-paused'; resultText = `หยุดหลังตรวจ ${state.completedFirmIds.length}/${state.total} กิจการ กดโหมด Typhoon auto เพื่อทำรายการที่เหลือต่อ`;
      } else if (state.status === 'stale') {
        lastStatus = 'typhoon-stale'; resultText = 'เมืองหรือตาของเกมเปลี่ยนแล้ว จึงไม่ใช้ผล Typhoon ที่ค้างอยู่';
      } else if (state.status === 'complete') {
        lastStatus = 'typhoon-auto-complete'; resultText = `Typhoon ตรวจครบ ${state.total} กิจการแล้ว ผลถูกบันทึกใน replay`;
      }
      signature = ''; sync(); options.onChange();
    },
  });
  const modeButtons = Object.entries(modeLabels).map(([mode, label]) => {
    const node = button(`owner-mode-${mode}`, label, () => {
      if (activeAutoBatch && mode !== 'typhoon-auto') stopTyphoonAuto();
      options.getSession().setMode(mode as keyof typeof modeLabels);
      lastStatus = 'mode-changed';
      resultText = mode === 'auto' ? 'กฎในเกมทำรายการเดือนละครั้งในเมืองนี้ โหลดหรือเริ่มใหม่จะกลับโหมดเสนอ' : mode === 'typhoon-auto' ? 'Typhoon จะเลือกเดือนละครั้ง ใช้เฉพาะคำสั่งเจ้าของตลาดที่ผ่านการตรวจ และกลับไปใช้กฎในเกมเมื่อเรียกไม่ได้' : mode === 'off' ? 'ปิดการประเมินเจ้าของตลาดแล้ว' : 'แสดงข้อเสนอให้เลือกทำเอง กฎและ Typhoon ยังไม่ย้ายเงินจนกดใช้';
      signature = ''; sync(); options.onChange();
      const pausedBatch = monthlyBatch.getState();
      if (mode !== 'typhoon-auto' && pausedBatch.status === 'paused') {
        lastStatus = 'typhoon-auto-paused'; resultText = `หยุดหลังตรวจ ${pausedBatch.completedFirmIds.length}/${pausedBatch.total} กิจการ กดโหมด Typhoon auto เพื่อทำรายการที่เหลือต่อ`;
        signature = ''; sync(); options.onChange();
      }
      if (mode === 'typhoon-auto') startTyphoonAutoMonth();
    });
    node.dataset.ownerMode = mode; modes.append(node); return node;
  });
  const schedule = element('p', '', 'owner-schedule');
  const controls = element('div', undefined, 'owner-controls');
  const evaluate = button('owner-evaluate', 'ประเมินตอนนี้', () => {
    options.getSession().evaluate(options.getCity()); processed.clear(); lastStatus = 'evaluated';
    resultText = 'รับภาพข้อมูลปัจจุบันแล้ว ตรวจจำนวนเงินและเงินกันไว้ก่อนทำตามข้อเสนอ'; signature = ''; sync(); options.onChange();
  });
  const cancelTyphoon = button('owner-typhoon-cancel', 'ยกเลิกคำขอ Typhoon', () => {
    if (activeAutoBatch) {
      stopTyphoonAuto(); options.getSession().setMode('proposal');
      const progress = monthlyBatch.getState();
      lastStatus = 'typhoon-auto-paused'; resultText = `หยุดหลังตรวจ ${progress.completedFirmIds.length}/${progress.total} กิจการ กดโหมด Typhoon auto เพื่อทำรายการที่เหลือต่อ`;
    } else if (activeRequest) {
      const request = activeRequest; activeRequest = null; request.controller.abort(); revision++; busy = false;
      lastStatus = 'typhoon-cancelled'; resultText = 'ยกเลิกคำขอแล้ว ข้อเสนอเดิมยังอยู่และเมืองไม่เปลี่ยน';
    } else return;
    signature = ''; sync(); options.onChange();
  });
  cancelTyphoon.hidden = true;
  const verify = button('owner-verify', 'ตรวจ replay', () => {
    if (busy) return;
    let captured: ReturnType<Session['exportJournal']>;
    try { captured = options.getSession().exportJournal(); }
    catch { lastStatus = 'verify-failed'; resultText = 'ยังอ่าน checkpoint ไม่ได้ เมืองปัจจุบันไม่เปลี่ยน'; sync(); return; }
    busy = true; lastStatus = 'verifying'; resultText = 'กำลังตรวจจาก checkpoint ในสำเนาเมือง'; sync();
    const generation = revision;
    setTimeout(() => {
      if (generation !== revision) return;
      try {
        const result = replayOwnerJournal(captured);
        lastStatus = result.ok ? 'verified' : 'verify-failed';
        resultText = result.ok ? 'Replay ตรงกับรายการและสถานะที่บันทึก เมืองปัจจุบันไม่เปลี่ยน' : 'Replay ยังตรวจไม่ผ่าน เก็บไฟล์ประกอบเพื่อตรวจต่อ';
      } catch { lastStatus = 'verify-failed'; resultText = 'ยังตรวจ replay ไม่ได้ เมืองปัจจุบันไม่เปลี่ยน'; }
      busy = false; signature = ''; sync();
    }, 0);
  });
  const download = button('owner-export', 'ส่งออก replay', () => {
    try {
      const blob = new Blob([JSON.stringify(options.getSession().exportJournal(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = `citymanager-owner-replay-v1-day-${options.getCity().tick}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      lastStatus = 'exported'; resultText = 'ส่งออกไฟล์ประกอบพร้อม snapshot เมืองสำหรับ replay ในเครื่องแล้ว';
    } catch { lastStatus = 'export-failed'; resultText = 'ยังส่งออกไม่ได้ ประวัติรอบนี้ยังอยู่ในหน้านี้'; }
    sync();
  });
  controls.append(evaluate, cancelTyphoon, verify, download);
  const status = element('p', '', 'owner-status'); status.id = 'owner-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = element('div', undefined, 'owner-proposals'); list.id = 'owner-proposals';
  const journal = element('p', '', 'owner-journal-summary'); journal.id = 'owner-journal-summary';
  const retention = element('p', 'ประวัตินี้อยู่เฉพาะรอบที่เปิดเมือง เก็บ checkpoint และหน้าต่างรายการล่าสุด ส่งออกเก็บก่อนโหลดหรือเริ่มใหม่ เซฟเมืองยังเป็น v6', 'owner-note');
  body.append(modes, schedule, controls, status, list, journal, retention); host.append(summary, body);
  host.addEventListener('toggle', () => { signature = ''; sync(); });

  function stopTyphoonAuto() {
    revision++;
    if (activeRequest?.automatic) activeRequest = null;
    monthlyBatch.cancel(); activeAutoBatch = false; busy = activeRequest !== null; signature = '';
    options.onTyphoonAutoPending?.(false);
  }

  function startTyphoonAutoMonth() {
    void monthlyBatch.start();
  }
  async function requestTyphoon(proposal: OwnerProposal, automatic = false, batchGeneration?: number, batchController?: AbortController): Promise<OwnerMonthlyStepResult> {
    const mode = options.getSession().mode;
    if (activeRequest || !ownerDecisionConnectionReady(options.connection) || (automatic ? !activeAutoBatch || mode !== 'typhoon-auto' || batchGeneration !== revision : busy || mode !== 'proposal')) return 'retry';
    const city = options.getCity(), snapshot = captureOwnerSnapshot(city, proposal.snapshot.firmId);
    if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(proposal.snapshot)) {
      lastStatus = 'typhoon-stale'; resultText = 'ภาพข้อมูลของข้อเสนอนี้เปลี่ยนแล้ว กดประเมินใหม่ก่อนขอ Typhoon'; signature = ''; sync(); return 'stale';
    }
    const controller = batchController ?? new AbortController(), stateHash = ownerStateHash(city), generation = automatic ? batchGeneration! : ++revision;
    activeRequest = { controller, city, snapshot, stateHash, generation, automatic }; busy = true;
    lastStatus = automatic ? 'typhoon-auto-pending' : 'typhoon-pending'; resultText = automatic ? 'Typhoon กำลังเลือกจากข้อเสนอของกิจการ ระบบพักเวลาไว้จนกว่าจะตรวจครบ' : 'กำลังขอให้ Typhoon เลือกจากข้อเสนอที่ผ่านกฎเดิม'; signature = ''; sync();
    let automaticResult: OwnerMonthlyStepResult = 'completed';
    try {
      const result = await requestOwnerDecision(snapshot, options.connection, options.fetchImpl ?? fetch, controller.signal);
      if (controller.signal.aborted || result.reason === 'cancelled') return 'cancelled';
      if (generation !== revision || activeRequest?.controller !== controller) return 'cancelled';
      const latestCity = options.getCity();
      let latestHash: string | null = null;
      try { latestHash = ownerStateHash(latestCity); } catch { /* The answer is discarded below. */ }
      if (latestCity !== city || latestCity.tick !== snapshot.tick || latestHash !== stateHash || options.getSession().mode !== (automatic ? 'typhoon-auto' : 'proposal')) {
        if (automatic) automaticResult = 'stale';
        lastStatus = 'typhoon-stale'; resultText = 'เมืองเปลี่ยนระหว่างรอ Typhoon จึงไม่นำผลเก่ามาใช้';
      } else if (!result.response) {
        if (automatic) {
          const outcome = options.getSession().applyTyphoonAuto(latestCity, proposal.proposalId, 'typhoon-fallback-auto');
          if (outcome.ok && outcome.proposalId) processed.add(outcome.proposalId);
          lastStatus = outcome.ok ? 'typhoon-fallback-applied' : 'typhoon-auto-rejected'; resultText = outcome.ok ? 'ข้อมูล Typhoon ใช้ไม่ได้ จึงทำตามกฎสำรองในเกม' : 'กฎสำรองไม่ผ่านการตรวจซ้ำ จึงไม่มีการย้ายเงินจริง';
        } else { lastStatus = 'typhoon-fallback'; resultText = 'ข้อมูลคำขอไม่ผ่านการตรวจ ข้อเสนอเดิมยังอยู่และเมืองไม่เปลี่ยน'; }
      } else if (result.transport === 'remote' && result.response.mode === 'ai') {
        const selected = ownerProposalForCandidate(snapshot, result.response.selection.candidateId);
        if (!options.getSession().registerTyphoonProposal(latestCity, selected)) {
          lastStatus = 'typhoon-stale'; resultText = 'ข้อเสนอไม่ผ่านการตรวจซ้ำ จึงไม่ถูกเพิ่มและเมืองไม่เปลี่ยน';
        } else {
          if (automatic) {
            const outcome = options.getSession().applyTyphoonAuto(latestCity, selected.proposalId, 'typhoon-auto');
            if (outcome.ok) { if (outcome.proposalId) processed.add(outcome.proposalId); lastStatus = 'typhoon-auto-applied'; resultText = `Typhoon เลือก ${selected.command.type === 'hold' ? 'พักรายการ' : selected.command.type === 'contributeOwnerCapital' ? 'เติมทุน' : 'ถอนกำไร'} · ${outcome.status === 'held' ? 'ไม่ย้ายเงินจริง' : 'ตรวจซ้ำและบันทึกรายการแล้ว'}`; }
            else { lastStatus = 'typhoon-auto-rejected'; resultText = 'คำสั่งจาก Typhoon ไม่ผ่านการตรวจซ้ำ จึงไม่มีการย้ายเงินจริง'; }
          } else {
            lastStatus = 'typhoon-proposal'; resultText = `Typhoon เลือก “${selected.command.type === 'hold' ? 'ยังไม่ย้ายเงิน' : selected.command.type === 'contributeOwnerCapital' ? 'เสนอเติมทุน' : 'เสนอถอนกำไร'}” จากตัวเลือกที่ปลอดภัย ตรวจตัวเลขและยืนยันแยกก่อนทำรายการ`;
          }
        }
      } else {
        const local = proposeOwnerDecision(snapshot), expected = local.command.type === 'hold' ? 'hold' : 'safe-transfer';
        if (result.response.selection.candidateId !== expected) {
          lastStatus = 'typhoon-fallback'; resultText = 'ผลสำรองไม่ตรงกับกฎในเกม จึงเก็บข้อเสนอเดิมไว้โดยไม่เปลี่ยนเมือง';
        } else {
          if (automatic) {
            const outcome = options.getSession().applyTyphoonAuto(latestCity, proposal.proposalId, 'typhoon-fallback-auto');
            if (outcome.ok) { if (outcome.proposalId) processed.add(outcome.proposalId); lastStatus = 'typhoon-fallback-applied'; resultText = 'Typhoon ไม่พร้อม จึงทำตามกฎสำรองในเกมและบันทึกผล'; }
            else { lastStatus = 'typhoon-auto-rejected'; resultText = 'กฎสำรองไม่ผ่านการตรวจซ้ำ จึงไม่มีการย้ายเงินจริง'; }
          } else { lastStatus = 'typhoon-fallback'; resultText = 'Typhoon ไม่พร้อมใช้ จึงคงข้อเสนอจากกฎในเกมไว้ ไม่มีการย้ายเงินจริง'; }
        }
      }
    } catch {
      if (generation === revision && activeRequest?.controller === controller) {
        if (automatic && options.getSession().mode === 'typhoon-auto' && options.getCity() === city && ownerStateHash(city) === stateHash) {
          const outcome = options.getSession().applyTyphoonAuto(city, proposal.proposalId, 'typhoon-fallback-auto');
          if (outcome.ok && outcome.proposalId) processed.add(outcome.proposalId);
          lastStatus = outcome.ok ? 'typhoon-fallback-applied' : 'typhoon-auto-rejected'; resultText = outcome.ok ? 'Typhoon ไม่พร้อม จึงทำตามกฎสำรองในเกมและบันทึกผล' : 'กฎสำรองไม่ผ่านการตรวจซ้ำ จึงไม่มีการย้ายเงินจริง';
        } else { lastStatus = 'typhoon-fallback'; resultText = 'ยังเชื่อม Typhoon ไม่ได้ ข้อเสนอจากกฎในเกมยังอยู่ และเมืองไม่เปลี่ยน'; }
      }
    } finally {
      if (generation === revision && activeRequest?.controller === controller) {
        activeRequest = null; busy = activeAutoBatch; signature = ''; sync(); options.onChange();
      }
    }
    if (automatic && lastStatus === 'typhoon-stale') automaticResult = 'stale';
    else if (automatic && (lastStatus === 'typhoon-auto-rejected' || lastStatus === 'typhoon-fallback')) automaticResult = 'retry';
    return automatic ? automaticResult : 'completed';
  }

  function proposalRow(proposal: OwnerProposal, stale: boolean): HTMLElement {
    const row = element('article', undefined, 'owner-proposal');
    const { snapshot, command } = proposal;
    row.dataset.ownerProposalId = proposal.proposalId; row.dataset.firmId = String(snapshot.firmId); row.dataset.actorId = String(snapshot.actorId);
    row.dataset.command = command.type; row.dataset.tick = String(snapshot.tick); row.dataset.amountSatang = String(command.amountSatang); row.dataset.stale = String(stale);
    row.dataset.status = processed.has(proposal.proposalId) ? 'processed' : stale ? 'stale' : 'pending';
    row.append(element('h4', `ตลาด #${snapshot.firmId} · ครัวเรือนเจ้าของ #${snapshot.actorId}`));
    row.append(element('p', `${commandLabels[command.type]}${command.type === 'hold' ? '' : ` ${money(command.amountSatang)}`} · ภาพวันที่ ${snapshot.tick}`, 'owner-command'));
    row.append(element('p', options.getSession().getProposalSource(proposal.proposalId) === 'typhoon' ? 'ผู้เลือก: Typhoon · ตรวจซ้ำด้วยกฎเกม' : 'ผู้เลือก: กฎในเกม', 'owner-source'));
    row.append(element('p', OWNER_REASON_TEXT[proposal.reason], 'owner-reason'));
    const facts = element('dl', undefined, 'owner-budget');
    for (const key of ['householdCash', 'householdEssentialReserve', 'firmCash', 'firmTotalReserve'] as OwnerFactKey[]) {
      const pair = element('div'); pair.append(element('dt', OWNER_FACT_LABELS[key]), element('dd', money(snapshot.facts[key]))); facts.append(pair);
    }
    row.append(facts);
    if (!snapshot.budgetKnown) row.append(element('p', 'งบยังไม่ครบ จึงคงเดิม ไม่มีจำนวนเงินที่สมมติแทนข้อมูลขาด', 'owner-warning'));
    if (stale) row.append(element('p', 'เมืองเปลี่ยนจากภาพนี้แล้ว กดประเมินใหม่ก่อนทำรายการ', 'owner-warning'));
    const apply = button('', processed.has(proposal.proposalId) ? 'บันทึกผลแล้ว' : command.type === 'hold' ? 'ยืนยันคงเดิม' : 'ทำตามข้อเสนอ', () => {
      const result = options.getSession().apply(options.getCity(), proposal.proposalId);
      if (result.ok) processed.add(proposal.proposalId);
      lastStatus = result.ok ? result.status : 'rejected';
      resultText = result.ok ? command.type === 'hold' ? 'บันทึกการคงเดิมแล้ว เงินไม่เปลี่ยน' : 'ทำรายการผ่านคำสั่งเกมแล้ว ตรวจซ้ำเงินกันไว้ก่อนโอน' : 'ข้อเสนอนี้ไม่ผ่านการตรวจซ้ำ เมืองไม่เปลี่ยน กดประเมินใหม่';
      signature = ''; sync(); options.onChange();
    });
    apply.dataset.ownerApply = proposal.proposalId; apply.disabled = stale || processed.has(proposal.proposalId) || options.getSession().mode !== 'proposal' || !options.getSession().getStats().recording || busy;
    row.append(apply);
    const askTyphoon = button('', ownerDecisionConnectionReady(options.connection) ? 'ขอข้อเสนอจาก Typhoon' : 'Typhoon ยังไม่เปิดใช้', () => { void requestTyphoon(proposal); });
    askTyphoon.dataset.ownerTyphoon = proposal.proposalId;
    askTyphoon.disabled = stale || !ownerDecisionConnectionReady(options.connection) || options.getSession().mode !== 'proposal' || !options.getSession().getStats().recording || busy;
    askTyphoon.title = ownerDecisionConnectionReady(options.connection) ? 'ส่งข้อมูลตัวเลขของกิจการนี้เพื่อเลือก hold หรือข้อเสนอที่ผ่านกฎเดิม' : 'การเชื่อมต่อ Typhoon สำหรับเจ้าของกิจการยังปิดอยู่ในรุ่นนี้';
    row.append(askTyphoon);

    const details = element('details', undefined, 'owner-evidence'); details.append(element('summary', 'ตัวเลขและรหัสอ้างอิง'));
    const evidence = element('dl');
    for (const [key, value] of Object.entries(snapshot.facts) as [OwnerFactKey, number | null][]) {
      const pair = element('div'); pair.dataset.ownerFact = key; if (value !== null) pair.dataset.value = String(value);
      pair.append(element('dt', OWNER_FACT_LABELS[key]), element('dd', money(value))); evidence.append(pair);
    }
    details.append(evidence, element('p', 'เงินกันไว้เป็นนโยบายล่วงหน้า 30 วันตามกติกาเกม ไม่ใช่งบการเงินเต็มรูปแบบ', 'owner-note'));
    details.append(element('code', `${proposal.policyVersion} · ${snapshot.rulesVersion} · ${proposal.proposalId}`));
    if (snapshot.missing.length) details.append(element('code', snapshot.missing.join(', ')));
    row.append(details); return row;
  }

  function sync() {
    const city = options.getCity(), session = options.getSession();
    if (activeRequest) {
      let currentHash: string | null = null;
      if (city === activeRequest.city) { try { currentHash = ownerStateHash(city); } catch { /* Discard if state cannot be checked. */ } }
      if (city !== activeRequest.city || city.tick !== activeRequest.snapshot.tick || currentHash !== activeRequest.stateHash) {
        const request = activeRequest, wasAuto = activeAutoBatch; activeRequest = null; request.controller.abort(); revision++; busy = false;
        if (wasAuto) { monthlyBatch.invalidate(); activeAutoBatch = false; options.onTyphoonAutoPending?.(false); }
        lastStatus = 'typhoon-stale'; resultText = 'เมืองเปลี่ยนระหว่างรอ Typhoon จึงยกเลิกผลเพื่อไม่ใช้ภาพข้อมูลเก่า'; signature = '';
      }
    }
    if (city !== lastCity) { lastCity = city; processed.clear(); resultText = ''; lastStatus = 'ready'; signature = ''; }
    const stats = session.getStats();
    const proposals = session.getProposals();
    host.dataset.mode = session.mode; host.dataset.tick = String(city.tick); host.dataset.lastStatus = lastStatus;
    host.dataset.coverageStartTick = String(stats.coverageStartTick); host.dataset.journalEvents = String(stats.activeEvents);
    modeButtons.forEach(node => {
      node.setAttribute('aria-pressed', String(node.dataset.ownerMode === session.mode));
      const stopAutoAllowed = activeAutoBatch && node.dataset.ownerMode !== 'typhoon-auto';
      node.disabled = busy && !stopAutoAllowed || node.dataset.ownerMode === 'auto' && !stats.recording || node.dataset.ownerMode === 'typhoon-auto' && (!stats.recording || !ownerDecisionConnectionReady(options.connection));
    });
    evaluate.disabled = session.mode !== 'proposal' || busy || !stats.recording; verify.disabled = download.disabled = busy;
    cancelTyphoon.hidden = activeRequest === null && !activeAutoBatch; cancelTyphoon.disabled = activeRequest === null && !activeAutoBatch;
    cancelTyphoon.textContent = activeAutoBatch ? 'หยุด Typhoon ทำรายการเอง' : 'ยกเลิกคำขอ Typhoon';
    schedule.textContent = session.mode === 'off' ? 'ปิดอยู่ ไม่มีการประเมินหรือทำรายการจากกฎ' : `รอบเดือนถัดไปวันที่ ${(Math.floor(city.tick / MONTH) + 1) * MONTH} · ${session.mode === 'auto' ? 'กฎในเกมทำรายการอัตโนมัติ' : session.mode === 'typhoon-auto' ? 'Typhoon เลือกและทำรายการอัตโนมัติ' : 'เสนอให้เลือกทำเอง เงินยังไม่ย้าย'}`;
    status.textContent = !stats.recording ? 'ยังเก็บหลักฐาน replay ไม่ได้ จึงพักการทำรายการจากกฎ เมืองยังจำลองต่อได้' : resultText || 'ค่าเริ่มต้นรับข้อเสนอ โหลดหรือเริ่มเมืองใหม่จะกลับโหมดนี้เสมอ';
    journal.textContent = `ประวัติจากวันที่ ${stats.coverageStartTick} · ${stats.activeEvents} รายการในหน้าต่างนี้ · ทำรายการ ${stats.applied} · คงเดิม ${stats.held} · ปฏิเสธ ${stats.rejected} · เปลี่ยน checkpoint ${stats.checkpointRotations}`;
    if (!host.open) return;
    const token = `${city.tick}|${session.mode}|${stats.activeEvents}|${stats.applied}|${stats.held}|${stats.rejected}|${[...processed].join(',')}|${proposals.map(p => p.proposalId).join(',')}`;
    if (token === signature) return;
    signature = token;
    const needsHash = proposals.some(p => p.snapshot.tick === city.tick && !processed.has(p.proposalId));
    let currentHash: string | null = null;
    if (needsHash) { try { currentHash = ownerStateHash(city); } catch { /* Every unresolved capture stays non-executable. */ } }
    list.replaceChildren(...proposals.map(p => proposalRow(p, !processed.has(p.proposalId) && (p.snapshot.tick !== city.tick || p.snapshot.stateHash !== currentHash))));
    if (!proposals.length) list.append(element('p', 'ยังไม่มีข้อเสนอในรอบนี้ ตลาดต้องมีครัวเรือนเจ้าของจริง แล้วรอรอบเดือนหรือกดประเมินตอนนี้', 'owner-empty'));
  }
  function reset() { if (activeAutoBatch) options.onTyphoonAutoPending?.(false); activeAutoBatch = false; activeRequest?.controller.abort(); activeRequest = null; monthlyBatch.reset(); revision++; busy = false; processed.clear(); signature = ''; resultText = ''; lastStatus = 'ready'; sync(); }
  function noteOutcomes(outcomes: OwnerExecutionOutcome[]) {
    if (!outcomes.length) {
      const city = options.getCity();
      if (options.getSession().mode === 'typhoon-auto' && city.tick > 0 && city.tick % MONTH === 0) startTyphoonAutoMonth();
      return;
    }
    for (const outcome of outcomes) if (outcome.ok && outcome.proposalId) processed.add(outcome.proposalId);
    lastStatus = 'monthly-evaluated'; resultText = 'จบรอบกฎเจ้าของตลาดแล้ว ผลแต่ละรายการอยู่ในประวัติ'; signature = '';
  }
  sync(); return { sync, reset, noteOutcomes, isAutoPending: () => activeAutoBatch };
}
