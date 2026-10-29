import type { Campus } from './education.ts';
import type { City } from './sim.ts';
import { educationPanelData } from './education-panel-data.ts';

const money = (value: number) => `฿${(value / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
const paragraph = (text: string) => Object.assign(document.createElement('p'), { textContent: text });

export function installEducationPanel(actions: HTMLElement) {
  const details = document.createElement('section'); details.id = 'education-details';
  const feedback = document.createElement('p'); feedback.id = 'campus-feedback'; feedback.hidden = true;
  feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); feedback.setAttribute('aria-atomic', 'true');
  actions.before(details); actions.prepend(feedback);
  for (const button of actions.querySelectorAll('button')) button.setAttribute('aria-describedby', feedback.id);
  let selectedCity: City | null = null, selectedId: number | null = null, key = '';
  return {
    update(city: City, campus: Campus | undefined) {
      details.hidden = !campus; actions.hidden = !campus;
      if (selectedCity !== city || selectedId !== (campus?.id ?? null)) {
        selectedCity = city; selectedId = campus?.id ?? null; key = ''; feedback.textContent = ''; feedback.hidden = true;
      }
      if (!campus) return;
      const data = educationPanelData(city, campus), nextKey = JSON.stringify([data, campus.open]);
      const toggle = actions.querySelector<HTMLButtonElement>('#toggle-campus')!;
      const upgrade = actions.querySelector<HTMLButtonElement>('#upgrade-campus')!;
      toggle.textContent = campus.open ? 'พักบริการ' : 'เปิดบริการ';
      upgrade.disabled = !data.next;
      upgrade.textContent = data.next ? `ขยายระดับ 2 · ${money(data.upgrade)}` : 'ถึงระดับสูงสุดแล้ว';
      if (key === nextKey) return; key = nextKey;
      const title = Object.assign(document.createElement('h3'), { textContent: 'ค่าใช้จ่ายและการเรียน' });
      const rows: HTMLElement[] = [title,
        paragraph(`ค่าก่อสร้าง ${money(data.build)} · ค่าบำรุง ${money(data.upkeep)}/เดือน`),
        paragraph(`บุคลากรในเมือง ${data.localStaff} คน · ค่าจ้าง ${money(data.localDaily)}/คน/วัน (จ่ายสิ้นเดือน) · ค่าจ้างสะสม ${money(data.accruedWages)}`),
        paragraph(`บุคลากรสัญญาภายนอก ${data.contract} คน · ${money(data.contractDaily)}/คน/วัน (จ่ายรายวัน)`),
        paragraph(`ความจุสูงสุดระดับนี้: ${data.current.seats} ที่นั่ง · บุคลากรเต็มกำลัง ${data.current.staff} คน · ไฟ ${data.current.power} · น้ำ ${data.current.water}`),
        paragraph(`เปิดรับจริง ${data.operatingSeats}/${data.current.seats} ที่นั่ง · ลงทะเบียน ${data.enrolled} คน · ได้เรียนวันนี้ ${data.progressing} คน`),
        paragraph(campus.kind === 'school'
          ? `รับแรงงานที่ยังไม่มีวุฒิพื้นฐานและมีสิทธิเรียน · ต้องเรียน ${data.studyDays} วันที่ให้บริการได้`
          : `รับแรงงานที่มีวุฒิพื้นฐานและมีสิทธิเรียน · ต้องเรียน ${data.studyDays} วันที่ให้บริการได้`),
      ];
      if (data.cohorts.length) {
        const list = document.createElement('ul'); list.className = 'education-cohorts';
        for (const cohort of data.cohorts) {
          const item = document.createElement('li');
          item.textContent = `ครัวเรือน #${cohort.householdId} · ผู้เรียน ${cohort.learners} คน · เรียนแล้ว ${cohort.days}/${data.studyDays} วัน`;
          list.append(item);
        }
        rows.push(list);
      } else rows.push(paragraph('ยังไม่มีผู้เรียนในสถานศึกษานี้'));
      rows.push(paragraph('เป็นความก้าวหน้าที่สะสมจริง ไม่ใช่วันนัดจบ: เมื่อพักบริการหรือกำลังบริการไม่พอ การเรียนอาจหยุดหรือรอที่นั่ง'));
      if (data.next) rows.push(
        paragraph(`ขยายระดับ 2 ใช้ ${money(data.upgrade)} · ความจุสูงสุด ${data.current.seats} → ${data.next.seats} ที่นั่ง · บุคลากรเต็มกำลัง ${data.next.staff} คน ไฟ ${data.next.power} น้ำ ${data.next.water}`),
        paragraph(`เงื่อนไขขยาย: ${data.upgradeRequirements.join(' · ')} · ค่าบำรุงยัง ${money(data.upkeep)}/เดือน ค่าจ้างขึ้นกับบุคลากรจริง`),
      );
      details.replaceChildren(...rows);
    },
    showResult(result: { ok: boolean; message: string }) {
      feedback.hidden = false; feedback.dataset.ok = String(result.ok);
      // Keep a persistent result beside the action, including repeated refusals.
      feedback.replaceChildren(document.createTextNode(result.message));
      feedback.scrollIntoView({ block: 'nearest' });
    },
  };
}
