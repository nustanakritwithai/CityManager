/** Read-only UI contribution. This is recreation benefit, not whole-person happiness. */
import type { ParkRecreationState } from './park-recreation.ts';

export function parkRecreationPanelData(state: ParkRecreationState, residentIds: readonly string[]) {
  const rows = [...new Set(residentIds)].sort().map(citizenId => {
    const citizen = state.citizens[citizenId];
    return { citizenId, score: (citizen?.scoreUnits ?? 0) / 1000,
      gainedToday: (citizen?.day === Math.floor(state.minute / 1440) ? citizen.dailyGainedUnits : 0) / 1000,
      earnedMinutes: citizen?.earnedMinutes ?? 0, lastBenefitMinute: citizen?.lastBenefitMinute ?? null,
      lastCreditedParkId: citizen?.lastCreditedParkId ?? null, lastGain: (citizen?.lastGainUnits ?? 0) / 1000,
      lastCrowdingPercent: citizen ? citizen.lastCrowdingPermille / 10 : null,
      lastQualityPercent: citizen ? citizen.lastQualityPermille / 10 : null };
  });
  return { minute: state.minute, rows, population: rows.length,
    average: rows.length ? rows.reduce((n, row) => n + row.score, 0) / rows.length : 0,
    withBenefit: rows.filter(row => row.score > 0).length,
    maximum: 100, proposed: { gainPerMinute: state.tuning.gainUnitsPerMinute / 1000,
      dailyCap: state.tuning.dailyCapUnits / 1000, decayPerDay: state.tuning.decayUnitsPerDay / 1000 } };
}

export function renderParkRecreationPanel(host: HTMLElement, state: ParkRecreationState, residentIds: readonly string[]): void {
  const data = parkRecreationPanelData(state, residentIds), doc = host.ownerDocument;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node;
  };
  const section = element('section'); section.setAttribute('aria-label', 'ความพึงพอใจจากการพักผ่อนในสวน');
  section.append(element('h2', 'ความพึงพอใจจากการพักผ่อนในสวน'));
  section.append(element('p', 'วัดเฉพาะประโยชน์ที่ได้รับจากเวลาพักผ่อนจริงในสวน ไม่ใช่ความสุขโดยรวมของประชาชน'));
  section.append(element('p', `เฉลี่ย ${data.average.toFixed(2)} / 100 · มีผลคงเหลือ ${data.withBenefit} จาก ${data.population} คน`));
  section.append(element('p', `ค่าทดลอง: สูงสุด ${data.proposed.gainPerMinute} คะแนน/นาที · รับได้ไม่เกิน ${data.proposed.dailyCap} คะแนน/วัน · ลดลง ${data.proposed.decayPerDay} คะแนน/วันตามเวลาเกม`));
  section.append(element('p', 'คุณภาพสวนและความแออัดลดอัตราที่ได้รับ โดยคนหนึ่งได้รับจากสวนได้เพียงแห่งเดียวต่อนาที การเดินทางไม่นับเป็นเวลาพักผ่อน'));
  section.append(element('p', 'ไม่มีคะแนนติดลบหรือบทลงโทษเมื่อยังไม่เคยใช้สวน และไม่มีผลต่อรายได้ ภาษี การเติบโตประชากร หรือผลผลิต'));
  const details = element('details'), summary = element('summary', 'ดูคะแนนรายบุคคลและที่มาของผลล่าสุด'); details.append(summary);
  const table = element('table'), caption = element('caption', `ข้อมูลถึงนาทีเกม ${state.minute} · คุณภาพและความแออัดเป็นค่าตอนรับผลล่าสุด`);
  table.append(caption);
  const head = element('thead'), header = element('tr');
  for (const label of ['ประชาชน', 'คะแนน / 100', 'ได้รับวันนี้', 'นาทีที่รับผลสะสม', 'สวนล่าสุด', 'คุณภาพล่าสุด', 'ตัวคูณความแออัดล่าสุด']) {
    const th = element('th', label); th.scope = 'col'; header.append(th);
  }
  head.append(header); table.append(head);
  const body = element('tbody');
  for (const row of data.rows) {
    const tr = element('tr'), who = element('th', row.citizenId); who.scope = 'row'; tr.append(who);
    for (const value of [row.score.toFixed(2), row.gainedToday.toFixed(2), String(row.earnedMinutes),
      row.lastCreditedParkId === null ? 'ยังไม่มี' : `#${row.lastCreditedParkId}`,
      row.lastQualityPercent === null ? '—' : `${row.lastQualityPercent}%`,
      row.lastCrowdingPercent === null ? '—' : `${row.lastCrowdingPercent}%`]) tr.append(element('td', value));
    body.append(tr);
  }
  table.append(body); details.append(table); section.append(details); host.replaceChildren(section);
}
