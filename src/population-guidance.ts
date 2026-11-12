/** A narrow diagnosis of the funded-job/capital bottleneck, derived from current simulator state. */
import { industryGrowthStatus, type City } from './sim.ts';
import { GOAL_POPULATION, type CityGoals } from './city-goals.ts';
import { GOAL_LARGE_CITY_POPULATION } from './main-goal-network.ts';

export type PopulationGuidance = { reason: string; capital: string; action: string };
const baht = (satang: number) => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** No prediction is made: other conditions can change while a business saves. */
export function populationGuidance(city: City, goals: CityGoals): PopulationGuidance | null {
  const target = goals.next?.id === 'city' ? GOAL_POPULATION
    : goals.next?.id === 'self-reliant' && city.goalRulesVersion === 2 ? GOAL_LARGE_CITY_POPULATION : null;
  const population = city.households.reduce((total, household) => total + household.members, 0);
  if (target === null || population >= target || city.migration.arrivals < 2) return null;
  const growth = industryGrowthStatus(city);
  if (growth.code !== 'growth.saving-capital' || growth.fundedVacancies !== 0 || growth.sponsorFirmId === null) return null;
  return {
    reason: 'งานว่างในกิจการที่สำรองค่าจ้างได้มี 0 ตำแหน่ง หลังสองครัวเรือนแรก การรับครัวเรือนใหม่ต้องมีงานประเภทนี้',
    capital: `โรงงาน #${growth.sponsorFirmId} มีทุนที่ใช้ขยายได้ ${baht(growth.availableCapital)} / ${baht(growth.requiredCapital)} บาท หลังกันภาระและเงินหมุนเวียน ทุนนี้เป็นเงินของกิจการ ไม่ใช่คลังเมือง`,
    action: 'ตรวจฟาร์มและโรงงานเดิมให้มีแรงงาน วัตถุดิบ น้ำ ไฟ และถนนเชื่อมกัน แล้วติดตามทุนที่กิจการสะสม เงื่อนไขอาจเปลี่ยนได้ ดูรายละเอียดที่ ประชากรและงาน → งานใหม่และทุนขยายโรงงาน',
  };
}
