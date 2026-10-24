import './owner-decision-panel.css';
import { OWNER_FACT_LABELS, OWNER_REASON_TEXT, ownerStateHash, type OwnerFactKey, type OwnerProposal, type OwnerExecutionOutcome } from './owner-decision.ts';
import { replayOwnerJournal, type createOwnerDecisionSession } from './owner-decision-session.ts';
import type { City } from './sim.ts';

type Session = ReturnType<typeof createOwnerDecisionSession>;
type Options = { getCity(): City; getSession(): Session; onChange(): void };
const money = (value: number | null) => value === null ? 'ยังคำนวณไม่ได้' : `${(value / 100).toLocaleString('th-TH', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} เครดิต`;
const modeLabels = { off: 'ปิด', proposal: 'รับข้อเสนอ', auto: 'กฎทำรายการเอง' } as const;
const commandLabels = { hold: 'คงเดิม', contributeOwnerCapital: 'เติมทุนจากครัวเรือน', withdrawOwnerProfit: 'ถอนกำไรเข้าครัวเรือน' } as const;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
}
function button(id: string, label: string, action: () => void) {
  const node = element('button', label); node.id = id; node.type = 'button'; node.addEventListener('click', action); return node;
}

/** Local rules only: no fetch, provider, credentials or model-written balances. */
export function createOwnerDecisionPanel(host: HTMLDetailsElement, options: Options) {
  host.id = 'owner-decisions';
  const summary = element('summary'); summary.id = 'owner-decisions-toggle';
  summary.append(element('span', 'เจ้าของตลาด'), element('span', 'กฎในเครื่อง', 'owner-summary-note'));
  const body = element('section', undefined, 'owner-body');
  body.append(element('h3', 'ข้อเสนอเจ้าของตลาดทั้งเมือง'));
  body.append(element('p', 'ประเมินหลังจบรอบเดือนด้วยกฎในเกมรุ่นนี้ ยังไม่ใช่คำตอบจาก Typhoon', 'owner-note'));
  const modes = element('div', undefined, 'owner-modes'); modes.setAttribute('aria-label', 'โหมดเจ้าของตลาดทั้งเมือง');
  const processed = new Set<string>();
  let lastCity = options.getCity(), lastStatus = 'ready', resultText = '', busy = false, signature = '', revision = 0;
  const modeButtons = Object.entries(modeLabels).map(([mode, label]) => {
    const node = button(`owner-mode-${mode}`, label, () => {
      options.getSession().setMode(mode as keyof typeof modeLabels);
      lastStatus = 'mode-changed';
      resultText = mode === 'auto' ? 'เปิดกฎทำรายการเองในเมืองที่เปิดอยู่นี้ ตรวจทุกสิ้นเดือนและบันทึกผล โหลดหรือเริ่มใหม่จะกลับโหมดเสนอ' : mode === 'off' ? 'ปิดการประเมินเจ้าของตลาดแล้ว' : 'แสดงข้อเสนอให้เลือกทำเอง กฎยังไม่ย้ายเงิน';
      signature = ''; sync(); options.onChange();
    });
    node.dataset.ownerMode = mode; modes.append(node); return node;
  });
  const schedule = element('p', '', 'owner-schedule');
  const controls = element('div', undefined, 'owner-controls');
  const evaluate = button('owner-evaluate', 'ประเมินตอนนี้', () => {
    options.getSession().evaluate(options.getCity()); processed.clear(); lastStatus = 'evaluated';
    resultText = 'รับภาพข้อมูลปัจจุบันแล้ว ตรวจจำนวนเงินและเงินกันไว้ก่อนทำตามข้อเสนอ'; signature = ''; sync(); options.onChange();
  });
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
  controls.append(evaluate, verify, download);
  const status = element('p', '', 'owner-status'); status.id = 'owner-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = element('div', undefined, 'owner-proposals'); list.id = 'owner-proposals';
  const journal = element('p', '', 'owner-journal-summary'); journal.id = 'owner-journal-summary';
  const retention = element('p', 'ประวัตินี้อยู่เฉพาะรอบที่เปิดเมือง เก็บ checkpoint และหน้าต่างรายการล่าสุด ส่งออกเก็บก่อนโหลดหรือเริ่มใหม่ เซฟเมืองยังเป็น v6', 'owner-note');
  body.append(modes, schedule, controls, status, list, journal, retention); host.append(summary, body);
  host.addEventListener('toggle', () => { signature = ''; sync(); });

  function proposalRow(proposal: OwnerProposal, stale: boolean): HTMLElement {
    const row = element('article', undefined, 'owner-proposal');
    const { snapshot, command } = proposal;
    row.dataset.ownerProposalId = proposal.proposalId; row.dataset.firmId = String(snapshot.firmId); row.dataset.actorId = String(snapshot.actorId);
    row.dataset.command = command.type; row.dataset.tick = String(snapshot.tick); row.dataset.amountSatang = String(command.amountSatang); row.dataset.stale = String(stale);
    row.dataset.status = processed.has(proposal.proposalId) ? 'processed' : stale ? 'stale' : 'pending';
    row.append(element('h4', `ตลาด #${snapshot.firmId} · ครัวเรือนเจ้าของ #${snapshot.actorId}`));
    row.append(element('p', `${commandLabels[command.type]}${command.type === 'hold' ? '' : ` ${money(command.amountSatang)}`} · ภาพวันที่ ${snapshot.tick}`, 'owner-command'));
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
    if (city !== lastCity) { lastCity = city; processed.clear(); resultText = ''; lastStatus = 'ready'; signature = ''; }
    const stats = session.getStats();
    const proposals = session.getProposals();
    host.dataset.mode = session.mode; host.dataset.tick = String(city.tick); host.dataset.lastStatus = lastStatus;
    host.dataset.coverageStartTick = String(stats.coverageStartTick); host.dataset.journalEvents = String(stats.activeEvents);
    modeButtons.forEach(node => { node.setAttribute('aria-pressed', String(node.dataset.ownerMode === session.mode)); node.disabled = busy || node.dataset.ownerMode === 'auto' && !stats.recording; });
    evaluate.disabled = session.mode !== 'proposal' || busy || !stats.recording; verify.disabled = download.disabled = busy;
    schedule.textContent = session.mode === 'off' ? 'ปิดอยู่ ไม่มีการประเมินหรือทำรายการจากกฎ' : `รอบเดือนถัดไปวันที่ ${(Math.floor(city.tick / 30) + 1) * 30} · ${session.mode === 'auto' ? 'กฎทำรายการหลังตรวจเงินกันไว้ทั้งสองกระเป๋า' : 'เสนอให้เลือกทำเอง เงินยังไม่ย้าย'}`;
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
  function reset() { revision++; busy = false; processed.clear(); signature = ''; resultText = ''; lastStatus = 'ready'; sync(); }
  function noteOutcomes(outcomes: OwnerExecutionOutcome[]) {
    if (!outcomes.length) return;
    for (const outcome of outcomes) if (outcome.ok && outcome.proposalId) processed.add(outcome.proposalId);
    lastStatus = 'monthly-evaluated'; resultText = 'จบรอบกฎเจ้าของตลาดแล้ว ผลแต่ละรายการอยู่ในประวัติ'; signature = '';
  }
  sync(); return { sync, reset, noteOutcomes };
}
