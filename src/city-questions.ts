import { housingCapacity, householdWorkerCount, firmWorkerCount, isMarket, isRetail, type City } from './sim.ts';

/** Local read-only questions. This contract is not sent to the Typhoon report endpoint. */
export const CITY_FACT_QUESTIONS = [
  { intent: 'city.housing', label: 'ที่อยู่อาศัยมีเท่าไร' },
  { intent: 'city.workforce', label: 'แรงงานในเมืองเป็นอย่างไร' },
  { intent: 'city.businesses', label: 'มีสถานประกอบการอะไรบ้าง' },
  { intent: 'house.detail', label: 'ดูข้อเท็จจริงของบ้าน' },
  { intent: 'business.detail', label: 'ดูข้อเท็จจริงของสถานประกอบการ' },
] as const;
export type CityFactIntent = typeof CITY_FACT_QUESTIONS[number]['intent'];
export type CityFactQuestion = { schemaVersion: 1; intent: CityFactIntent; entityId?: number };
export type CityFact = { id: string; label: string; value: number | string; unit: string; source: string; entityRefs: string[] };
export type CityFactAnswer = {
  schemaVersion: 1; snapshotTick: number; intent: CityFactIntent | null;
  status: 'observed' | 'missing' | 'unsupported'; summary: string;
  facts: CityFact[]; missingData: { id: string; text: string }[]; hypotheses: never[]; limitations: string[];
};
const limitations = [
  'เป็นข้อเท็จจริง ณ วันที่จับภาพ ไม่ใช่ประวัติย้อนหลังหรือคำทำนาย',
  'ไม่สรุปสาเหตุหรือระดับความรุนแรง และไม่เปลี่ยนเงิน บัญชี หรือการจำลอง',
  'คำนวณในเครื่อง ไม่ส่งข้อมูลเพิ่มไปยัง API',
];
const entityIntents = new Set<CityFactIntent>(['house.detail', 'business.detail']);
const businessKinds = { C: 'พาณิชย์ (C)', I: 'อุตสาหกรรม (I)', F: 'ฟาร์ม (F)' } as const;
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0;

export function validateCityFactQuestion(value: unknown): CityFactQuestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const question = value as Record<string, unknown>;
  if (Object.keys(question).some(key => !['schemaVersion', 'intent', 'entityId'].includes(key)) || question.schemaVersion !== 1 || !CITY_FACT_QUESTIONS.some(item => item.intent === question.intent)) return null;
  const intent = question.intent as CityFactIntent;
  if (entityIntents.has(intent) ? !validNumber(question.entityId) || question.entityId === 0 : question.entityId !== undefined) return null;
  return { schemaVersion: 1, intent, ...(entityIntents.has(intent) ? { entityId: question.entityId as number } : {}) };
}

/** Build copied scalars only; never retain mutable city records, wallets, balances or ledger text. */
export function answerCityFactQuestion(city: City, rawQuestion: unknown): CityFactAnswer {
  const question = validateCityFactQuestion(rawQuestion);
  const answer: CityFactAnswer = {
    schemaVersion: 1, snapshotTick: city.tick, intent: question?.intent ?? null,
    status: question ? 'observed' : 'unsupported',
    summary: question ? '' : 'คำถามนี้ยังไม่รองรับ เลือกคำถามข้อเท็จจริงที่มีในรายการ',
    facts: [], missingData: [], hypotheses: [], limitations: [...limitations],
  };
  if (!question) return answer;
  function missing(id: string, text: string) { answer.missingData.push({ id, text }); }
  function fact(id: string, label: string, value: unknown, unit: string, source: string, entityRefs: string[] = []) {
    if (typeof value === 'number' && !validNumber(value) || typeof value !== 'string' && typeof value !== 'number') {
      missing(`missing.${id}`, `${label}: ไม่มีค่าที่ตรวจสอบได้ จึงไม่แทนด้วย 0`); return;
    }
    answer.facts.push({ id, label, value: value as string | number, unit, source, entityRefs: [...entityRefs] });
  }
  const sum = <T>(items: T[], get: (item: T) => number): number => items.reduce((total, item) => total + get(item), 0);
  const countPeople = () => sum(city.households, item => item.members);
  const countWorkforce = () => sum(city.households, item => item.workforce);
  const countEmployed = () => sum(city.households, item => householdWorkerCount(city, item.id));
  if (question.intent === 'city.housing') {
    const homes = city.buildings.filter(item => item.zone === 'R');
    const unhoused = city.households.filter(item => item.home === null);
    answer.summary = 'แยกจำนวนอาคาร ครัวเรือน และคน พร้อมความจุรวมที่อยู่อาศัย ณ ภาพนี้';
    fact('city.housing.buildings', 'อาคารที่อยู่อาศัย', homes.length, 'อาคาร', 'buildings[zone=R]');
    fact('city.housing.households', 'ครัวเรือนทั้งหมด', city.households.length, 'ครัวเรือน', 'households.length');
    fact('city.housing.population', 'ประชากรทั้งหมด', countPeople(), 'คน', 'sum(households.members)');
    fact('city.housing.capacity-households', 'ความจุรวมด้านครัวเรือน', sum(homes, item => housingCapacity(item).households), 'ครัวเรือน', 'sum(housingCapacity(buildings[zone=R]).households)');
    fact('city.housing.capacity-people', 'ความจุรวมด้านคน', sum(homes, item => housingCapacity(item).persons), 'คน', 'sum(housingCapacity(buildings[zone=R]).persons)');
    fact('city.housing.unhoused-households', 'ครัวเรือนที่ไม่มีบ้านอ้างอิง', unhoused.length, 'ครัวเรือน', 'households[home=null].length');
    fact('city.housing.unhoused-people', 'คนในครัวเรือนที่ไม่มีบ้านอ้างอิง', sum(unhoused, item => item.members), 'คน', 'sum(households[home=null].members)');
    answer.limitations.push('ความจุรวมไม่รับรองว่าทุกครัวเรือนย้ายเข้าได้ การจัดสรรยังขึ้นกับความจุของแต่ละบ้านและกติกาเกม');
  } else if (question.intent === 'city.workforce') {
    const workforce = countWorkforce(), employed = countEmployed();
    answer.summary = 'นับสมาชิกที่ทำงานได้และการจัดสรรงานจริง ผู้พึ่งพิงไม่ถูกนับเป็นแรงงานว่างงาน';
    fact('city.workforce.population', 'ประชากรทั้งหมด', countPeople(), 'คน', 'sum(households.members)');
    fact('city.workforce.total', 'แรงงานทั้งหมด', workforce, 'คน', 'sum(households.workforce)');
    fact('city.workforce.dependents', 'ผู้พึ่งพิง', sum(city.households, item => item.dependents), 'คน', 'sum(households.dependents)');
    fact('city.workforce.employed', 'แรงงานที่ได้รับจัดสรรงาน', employed, 'คน', 'sum(householdWorkerCount(city,households.id)) [employment + ownerLabor]');
    fact('city.workforce.unemployed', 'แรงงานที่ยังไม่ได้รับจัดสรรงาน', workforce - employed, 'คน', 'sum(households.workforce)-sum(householdWorkerCount(city,households.id)) [employment + ownerLabor]');
    for (const [skill, name] of [['general', 'งานทั่วไป'], ['manufacturing', 'การผลิต'], ['retail', 'การค้าปลีก']] as const) {
      fact(`city.workforce.skill.${skill}`, `แรงงานกลุ่มความสามารถ${name}`, sum(city.households, item => item.workerSkills[skill]), 'คน', `sum(households.workerSkills.${skill})`);
    }
    fact('city.workforce.legacy-assumed', 'แรงงานที่ความสามารถมาจากสมมติฐานตอนย้ายเซฟเดิม', sum(city.households.filter(item => item.skillSource === 'legacy-assumed'), item => item.workforce), 'คน', 'sum(households[skillSource=legacy-assumed].workforce)');
    missing('missing.city.workforce.education', 'ยังไม่มีข้อมูลระดับการศึกษาหรือประวัติฝึกอบรม จึงไม่อนุมานจากกลุ่มความสามารถหรืองานที่ได้รับ');
    answer.limitations.push('กลุ่มความสามารถเป็นจำนวนคนที่แยกกัน ไม่ใช่การศึกษา รายบุคคล หรือจำนวนคนที่ได้รับจ้างในอาชีพนั้น');
  } else if (question.intent === 'city.businesses') {
    answer.summary = 'นับสถานประกอบการจาก firm records ไม่ใช่นับช่องโซนหรืออาคารทั้งหมด';
    fact('city.businesses.total', 'สถานประกอบการทั้งหมด', city.firms.length, 'แห่ง', 'firms.length');
    fact('city.businesses.commercial', 'สถานประกอบการพาณิชย์', city.firms.filter(item => item.zone === 'C').length, 'แห่ง', 'firms[zone=C].length');
    fact('city.businesses.industrial', 'สถานประกอบการอุตสาหกรรม', city.firms.filter(item => item.zone === 'I').length, 'แห่ง', 'firms[zone=I].length');
    fact('city.businesses.farms', 'ฟาร์ม', city.firms.filter(item => item.zone === 'F').length, 'แห่ง', 'firms[zone=F].length');
    fact('city.businesses.raw-markets', 'ตลาด · พาณิชย์ระดับ 1', city.firms.filter(isMarket).length, 'แห่ง', 'firms[zone=C,commercialKind=market].length');
    fact('city.businesses.workers', 'แรงงานที่ได้รับจัดสรรงาน', countEmployed(), 'คน', 'sum(householdWorkerCount(city,households.id)) [employment + ownerLabor]');
    missing('missing.city.businesses.history', 'คำตอบนี้ไม่มีข้อมูลเปรียบเทียบก่อนหน้า จึงยังสรุปการเปิดเพิ่ม ปิดกิจการ หรือแนวโน้มไม่ได้');
  } else if (question.intent === 'house.detail') {
    const home = city.buildings.find(item => item.id === question.entityId && item.zone === 'R');
    if (!home) {
      answer.status = 'missing'; answer.summary = `ไม่พบบ้านรหัส ${question.entityId} ในภาพนี้`;
      missing('missing.house.entity', 'รหัสอาจไม่มีอยู่ เป็นอาคารประเภทอื่น หรือถูกนำออกจากเมืองแล้ว'); return answer;
    }
    const refs = [`building:${home.id}`], residents = city.households.filter(item => item.home === home.id), capacity = housingCapacity(home);
    answer.summary = `บ้านรหัส ${home.id}: แสดงความจุและผู้อยู่อาศัยตามรหัสบ้านจริง`;
    fact('house.id', 'รหัสอาคาร', home.id, 'รหัส', 'buildings.id', refs);
    fact('house.cell', 'ช่องแผนที่', home.cell, 'ช่อง (เริ่มที่ 0)', 'buildings.cell', refs);
    fact('house.level', 'ระดับอาคาร', home.level, 'ระดับ', 'buildings.level', refs);
    fact('house.age', 'อายุอาคาร', home.age, 'วัน', 'buildings.age', refs);
    fact('house.capacity-households', 'ความจุครัวเรือน', capacity.households, 'ครัวเรือน', 'housingCapacity(building).households', refs);
    fact('house.capacity-people', 'ความจุคน', capacity.persons, 'คน', 'housingCapacity(building).persons', refs);
    fact('house.occupied-households', 'ครัวเรือนที่อ้างอิงบ้านนี้', residents.length, 'ครัวเรือน', 'households[home=building.id].length', refs);
    fact('house.occupied-people', 'สมาชิกที่อ้างอิงบ้านนี้', sum(residents, item => item.members), 'คน', 'sum(households[home=building.id].members)', refs);
    answer.limitations.push('จำนวนผู้อยู่อาศัยนี้อ้างอิง home ID ของครัวเรือน ไม่ได้อ้างว่ามีคนอยู่ในตำแหน่งภาพสามมิติจริง');
  } else {
    const firm = city.firms.find(item => item.id === question.entityId);
    if (!firm) {
      answer.status = 'missing'; answer.summary = `ไม่พบสถานประกอบการรหัส ${question.entityId} ในภาพนี้`;
      missing('missing.business.entity', 'รหัสสถานประกอบการอาจไม่มีอยู่หรือถูกนำออกจากเมืองแล้ว'); return answer;
    }
    const refs = [`firm:${firm.id}`, `building:${firm.building}`], building = city.buildings.find(item => item.id === firm.building);
    answer.summary = `สถานประกอบการรหัส ${firm.id}: ข้อมูลปัจจุบันจากกิจการและอาคารที่อ้างอิง`;
    fact('business.id', 'รหัสสถานประกอบการ', firm.id, 'รหัส', 'firms.id', refs);
    fact('business.building', 'รหัสอาคารที่อ้างอิง', firm.building, 'รหัส', 'firms.building', refs);
    fact('business.zone', 'ประเภทสถานประกอบการ', businessKinds[firm.zone], '', 'firms.zone', refs);
    fact('business.workers', 'แรงงานที่ได้รับจัดสรรงาน', firmWorkerCount(city, firm.id), 'คน', 'firmWorkerCount(city,firm.id) [employment + ownerLabor]', refs);
    fact('business.inventory', 'สินค้าคงคลังปัจจุบัน', firm.inventory, 'หน่วยสินค้า', 'firms.inventory', refs);
    if (!isRetail(firm)) {
      fact('business.crop-inventory', 'พืชผลคงคลัง', firm.cropInventory, 'ล็อตพืชผล', 'firms.cropInventory', refs);
      fact('business.crop-cost', 'ต้นทุนบัญชีพืชผลคงคลัง', firm.cropCost, 'สตางค์', 'firms.cropCost', refs);
    }
    if (isMarket(firm) && firm.owner !== null) {
      fact('business.owner-workers', 'แรงงานเจ้าของที่ลงมือทำงาน', sum(city.ownerLabor.filter(item => item.firmId === firm.id), item => item.workers), 'คน', 'sum(ownerLabor[firmId=firm.id].workers)', refs);
    }
    if (building) {
      fact('business.level', 'ระดับอาคาร', building.level, 'ระดับ', 'buildings.level', refs);
      fact('business.cell', 'ช่องแผนที่', building.cell, 'ช่อง (เริ่มที่ 0)', 'buildings.cell', refs);
    } else missing('missing.business.building', 'ไม่พบอาคารที่สถานประกอบการอ้างอิง จึงไม่อนุมานระดับหรือตำแหน่ง');
    missing('missing.business.profit-explanation', 'คำถามนี้ไม่จัดทำงบการเงินหรือสรุปสาเหตุกำไรขาดทุนจากข้อมูลบางส่วน');
  }
  return answer;
}
