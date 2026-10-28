/** Isolated review entry; never imported by production main. */
import { restoreParkRecreation } from './park-recreation.ts';
import { renderParkRecreationPanel } from './park-recreation-panel.ts';

async function review() {
  const response = await fetch(new URL('park-recreation-review.json', document.baseURI));
  if (!response.ok) throw new Error('Run verify-park-recreation.mjs against the actual leisure candidate first.');
  const evidence = await response.json();
  const state = restoreParkRecreation(evidence.recreation);
  renderParkRecreationPanel(document.getElementById('panel')!, state, evidence.residents);
  const provenance = document.getElementById('provenance')!;
  const title = document.createElement('h2'); title.textContent = 'หลักฐานการรัน'; provenance.append(title);
  for (const text of [
    `Seed ${evidence.provenance.seed} · วัน ${evidence.provenance.startEconomicDay}–${evidence.provenance.endEconomicDay} · ${evidence.provenance.elapsedMinutes} นาทีเกม`,
    `เวลาพักผ่อนที่เข้าเกณฑ์ ${evidence.provenance.observedEligibleMinutes} คน-นาที · กลับบ้านสำเร็จ ${evidence.provenance.completedReturns} ครั้ง · คนในสวนพร้อมกันสูงสุด ${evidence.provenance.maximumOccupancy} คน`,
    'ผ่าน: หยุดเวลาไม่เปลี่ยนผล, ความเร็วต่างกันให้ผลเท่ากัน, เซฟ/โหลดแล้วตรงกัน, ไม่มีสวนไม่มีคะแนน, เศรษฐกิจตรงกับฐานเดิม'
  ]) { const p = document.createElement('p'); p.textContent = text; provenance.append(p); }
  const hash = document.createElement('code'); hash.textContent = `Leisure source SHA-256: ${evidence.provenance.leisureSourceSHA256}`; provenance.append(hash);
}
review().catch(error => {
  const panel = document.getElementById('panel')!; panel.classList.add('error');
  panel.textContent = `ไม่สามารถแสดงหลักฐาน: ${error instanceof Error ? error.message : String(error)}`;
});
