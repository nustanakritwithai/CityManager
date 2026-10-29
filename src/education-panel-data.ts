/** Read-only facts for the campus inspector. No enrollment, spending or clock changes. */
import { EDUCATION_COST, educationLevel, type Campus } from './education.ts';
import { treasurySpendable, type City } from './sim.ts';

export function educationPanelData(city: City, campus: Campus) {
  const spec = EDUCATION_COST[campus.kind];
  const current = educationLevel(campus.kind, campus.level);
  const next = campus.level < 2 ? educationLevel(campus.kind, 2) : null;
  const localDaily = campus.kind === 'school' ? EDUCATION_COST.teacherDaily : EDUCATION_COST.professorDaily;
  const contractDaily = campus.kind === 'school' ? EDUCATION_COST.contractTeacherDaily : EDUCATION_COST.contractProfessorDaily;
  const cohorts = (city.education?.people ?? []).filter(person => person.campusId === campus.id)
    .map(person => ({ householdId: person.householdId, learners: campus.kind === 'school' ? person.school : person.university, days: person.progress }))
    .filter(cohort => cohort.learners > 0);
  const available = treasurySpendable(city), higher = city.education?.residentHigher ?? 0;
  const upgradeRequirements: string[] = [];
  if (next) {
    if (campus.kind === 'university') upgradeRequirements.push(`ผู้ถือวุฒิขั้นสูงในเมือง ${higher}/1 คน`);
    upgradeRequirements.push(`เงินคลังใช้จ่ายได้ ${(available / 100).toLocaleString('th-TH')} / ${(spec.upgrade / 100).toLocaleString('th-TH')} ฿`);
  }
  return {
    build: spec.build, upgrade: spec.upgrade, upkeep: spec.upkeep, studyDays: spec.studyDays,
    current, next, localDaily, contractDaily, cohorts, upgradeRequirements,
    localStaff: campus.report.localStaff, contract: campus.contract,
    operatingSeats: campus.report.operatingSeats, enrolled: campus.report.enrolled, progressing: campus.report.progressing,
    accruedWages: Object.values(campus.workDays).reduce((sum, days) => sum + days, 0) * localDaily,
  };
}
