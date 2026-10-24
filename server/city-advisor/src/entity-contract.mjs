/** Browser/server shared wire. No simulation, I/O, credentials, prompts or remote prose. */
export const ENTITY_KIND_LABELS = Object.freeze({ house: 'บ้าน', shop: 'ร้านพาณิชย์', market: 'ตลาด', factory: 'โรงงาน', farm: 'แปลงเกษตร', household: 'ครัวเรือน' });
const def = (label, unit, period = 'snapshot', signed = false) => Object.freeze({ label, unit, period, ...(signed ? { signed: true } : {}) });
export const ENTITY_FACT_DEFINITIONS = Object.freeze({
  'cash.current': def('เงินคงเหลือในขอบเขตที่เลือก', 'satang'),
  'cash.inflow': def('เงินเข้าระหว่างช่วงที่แสดง', 'satang', 'window'),
  'cash.outflow': def('เงินออกระหว่างช่วงที่แสดง', 'satang', 'window'),
  'cash.net': def('ผลต่างเงินเข้าและเงินออก', 'satang', 'window', true),
  'workforce.members': def('สมาชิก', 'people'), 'workforce.workforce': def('สมาชิกที่ทำงานได้', 'people'),
  'workforce.employed': def('แรงงานที่ได้รับจัดสรรงาน', 'people'),
  'workforce.employeeWorkers': def('แรงงานลูกจ้าง', 'people'), 'workforce.ownerWorkers': def('แรงงานเจ้าของทำเอง', 'people'),
  'workforce.dependents': def('ผู้พึ่งพิง', 'people'), 'workforce.unemployed': def('แรงงานที่ยังไม่ได้รับจัดสรรงาน', 'people'),
  'workforce.capacity': def('ความจุตำแหน่งงานตามกติกาปัจจุบัน', 'positions'),
  'occupancy.households': def('ครัวเรือนที่อ้างอิงบ้านนี้', 'households'), 'occupancy.persons': def('สมาชิกที่อ้างอิงบ้านนี้', 'people'),
  'occupancy.householdCapacity': def('ความจุด้านครัวเรือน', 'households'), 'occupancy.personCapacity': def('ความจุด้านคน', 'people'),
  'stocks.goods': def('สินค้าสำเร็จรูปคงคลัง', 'goods'), 'stocks.crops': def('พืชผลคงคลัง', 'crops'),
  'stocks.cropCostSatang': def('มูลค่าต้นทุนพืชผลคงคลัง', 'satang'),
  'quantities.goodsIn': def('สินค้าสำเร็จรูปเข้า', 'goods', 'window'), 'quantities.goodsOut': def('สินค้าสำเร็จรูปออก', 'goods', 'window'),
  'quantities.cropsIn': def('พืชผลเข้า', 'crops', 'window'), 'quantities.cropsOut': def('พืชผลออก', 'crops', 'window'),
  'today.cropHarvested': def('พืชผลที่เก็บเกี่ยววันนี้', 'crops', 'today'), 'today.cropProcessed': def('พืชผลที่แปรรูปวันนี้', 'crops', 'today'),
  'today.goodsProduced': def('สินค้าสำเร็จรูปที่ผลิตวันนี้', 'goods', 'today'),
  'today.cropConsumed': def('พืชผลที่บริโภควันนี้', 'crops', 'today'), 'today.goodsConsumed': def('สินค้าที่บริโภควันนี้', 'goods', 'today'),
  'price.goodsBuy': def('ราคาซื้อสินค้าที่จับคู่หลักฐานได้', 'satang/goods', 'window'), 'price.goodsSell': def('ราคาขายสินค้าที่จับคู่หลักฐานได้', 'satang/goods', 'window'),
  'price.cropsBuy': def('ราคาซื้อพืชผลที่จับคู่หลักฐานได้', 'satang/crops', 'window'), 'price.cropsSell': def('ราคาขายพืชผลที่จับคู่หลักฐานได้', 'satang/crops', 'window'),
  'access.connected': def('เชื่อมต่อถนนตามกติกาปัจจุบัน', 'boolean'),
});
const reasons = ['unavailable', 'not-modeled', 'empty-period', 'ambiguous', 'unsafe', 'non-integer'];
const MAX_BYTES = 16 * 1024;
const fail = () => { throw Object.assign(new Error('invalid_entity_snapshot'), { status: 400, code: 'invalid_entity_snapshot' }); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => { if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => count(value) && value > 0;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const bounded = value => { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BYTES) fail(); };
const clone = value => JSON.parse(JSON.stringify(value));
function core(value) {
  return { schemaVersion: value.schemaVersion, entity: value.entity, tick: value.tick, window: value.window, facts: value.facts, missing: value.missing };
}
export function makeEntitySnapshot(value) {
  return validateEntitySnapshot({ ...value, snapshotKey: canonical(core(value)) });
}
export function validateEntitySnapshot(value) {
  exact(value, ['schemaVersion', 'entity', 'tick', 'window', 'facts', 'missing', 'snapshotKey']); bounded(value);
  if (value.schemaVersion !== 1 || !count(value.tick)) fail();
  const e = value.entity; exact(e, ['kind', 'id', 'buildingId', 'firmId', 'householdId', 'cell']);
  if (typeof e.kind !== 'string' || !Object.hasOwn(ENTITY_KIND_LABELS, e.kind) || !positive(e.id)) fail();
  for (const key of ['buildingId', 'firmId', 'householdId']) if (e[key] !== null && !positive(e[key])) fail();
  if (e.cell !== null && (!count(e.cell) || e.cell >= 576)) fail();
  if (e.kind === 'household' ? e.householdId !== e.id || e.firmId !== null : e.buildingId !== e.id || e.householdId !== null) fail();
  if (e.kind === 'house' && e.firmId !== null || e.kind !== 'household' && e.cell === null) fail();
  const w = value.window; exact(w, ['fromTick', 'toTick', 'inclusive', 'maxDays', 'empty']);
  if (w.toTick !== value.tick || w.fromTick !== Math.max(0, value.tick - 29) || w.inclusive !== true || w.maxDays !== 30 || w.empty !== (value.tick === 0)) fail();
  if (!Array.isArray(value.facts) || value.facts.length > 24 || !Array.isArray(value.missing) || value.missing.length > 33) fail();
  const seen = new Set();
  for (const fact of value.facts) {
    exact(fact, ['id', 'value', 'unit', 'period']);
    if (typeof fact.id !== 'string' || !Object.hasOwn(ENTITY_FACT_DEFINITIONS, fact.id)) fail();
    const d = ENTITY_FACT_DEFINITIONS[fact.id];
    if (!d || seen.has(fact.id) || fact.unit !== d.unit || fact.period !== d.period || !Number.isSafeInteger(fact.value) || !d.signed && fact.value < 0 || d.unit === 'boolean' && ![0, 1].includes(fact.value) || w.empty && d.period !== 'snapshot') fail();
    seen.add(fact.id);
  }
  for (const missing of value.missing) {
    exact(missing, ['id', 'reason']);
    if (typeof missing.id !== 'string' || !Object.hasOwn(ENTITY_FACT_DEFINITIONS, missing.id) || seen.has(missing.id) || !reasons.includes(missing.reason)) fail();
    seen.add(missing.id);
  }
  if (typeof value.snapshotKey !== 'string' || value.snapshotKey !== canonical(core(value))) fail();
  return clone(value);
}
export function validateEntityRequest(value) {
  exact(value, ['schemaVersion', 'operation', 'locale', 'snapshot']); bounded(value);
  if (value.schemaVersion !== 2 || value.operation !== 'entity-explanation' || value.locale !== 'th') fail();
  return { schemaVersion: 2, operation: 'entity-explanation', locale: 'th', snapshot: validateEntitySnapshot(value.snapshot) };
}
const num = value => value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
const money = value => { const raw = BigInt(value), absolute = raw < 0n ? -raw : raw; return `${raw < 0n ? '-' : ''}${Number(absolute / 100n).toLocaleString('th-TH')}.${String(absolute % 100n).padStart(2, '0')}`; };
const units = { satang: 'เครดิต', 'satang/goods': 'เครดิต/หน่วยสินค้า', 'satang/crops': 'เครดิต/หน่วยพืชผล', people: 'คน', households: 'ครัวเรือน', goods: 'หน่วยสินค้า', crops: 'หน่วยพืชผล', positions: 'ตำแหน่ง', boolean: '' };
const period = (snapshot, code) => code === 'window' ? `วันที่ ${snapshot.window.fromTick}–${snapshot.window.toTick} (รวมวันต้นและปลาย)` : `วันที่ ${snapshot.tick}`;
function factValue(fact) {
  if (fact.unit === 'boolean') return fact.value === 1 ? 'เชื่อมต่อ' : 'ไม่เชื่อมต่อ';
  return `${fact.unit.startsWith('satang') ? money(fact.value) : num(fact.value)} ${units[fact.unit]}`.trim();
}
export function entityFactEvidence(snapshot, id) {
  const d = ENTITY_FACT_DEFINITIONS[id], fact = snapshot.facts.find(row => row.id === id), missing = snapshot.missing.find(row => row.id === id);
  if (!d) return 'ไม่มีรหัสหลักฐานนี้';
  if (fact) return `${d.label}: ${factValue(fact)} · ${period(snapshot, fact.period)} · ${id}`;
  const reason = { unavailable: 'ไม่มีค่าที่ตรวจสอบได้', 'not-modeled': 'แบบจำลองไม่ได้เก็บค่านี้สำหรับบริบทนี้', 'empty-period': 'ยังไม่มีช่วงวันที่สำหรับนับรายการ', ambiguous: 'การจับคู่หลักฐานกำกวม', unsafe: 'ตัวเลขไม่ปลอดภัยสำหรับการคำนวณ', 'non-integer': 'ราคาเฉลี่ยไม่ลงตัวเป็นสตางค์' }[missing?.reason] ?? 'ไม่มีหลักฐานในภาพนี้';
  return `${d.label}: ${reason} · ${id}`;
}
export function entityExplanationCandidates(raw) {
  const snapshot = validateEntitySnapshot(raw), observations = [], hypotheses = [], checks = [];
  const get = id => snapshot.facts.find(row => row.id === id)?.value;
  const row = (id, text, factRefs) => ({ id, text, factRefs });
  for (const fact of snapshot.facts) observations.push(row('observed.' + fact.id, `${ENTITY_FACT_DEFINITIONS[fact.id].label} ${factValue(fact)} · ${period(snapshot, fact.period)}`, [fact.id]));
  if (get('cash.inflow') !== undefined && get('cash.outflow') !== undefined && get('cash.outflow') > get('cash.inflow')) {
    hypotheses.push(row('possible.cash-pressure', 'เป็นไปได้ว่าเงินออกที่มากกว่าเงินเข้าในช่วงนี้เพิ่มแรงกดดันด้านเงินสด ต้องตรวจรายการประกอบ ผลต่างเงินสดไม่ใช่กำไรหรือสาเหตุที่ยืนยันแล้ว', ['cash.inflow', 'cash.outflow']));
  }
  if (get('access.connected') === 0) {
    hypotheses.push(row('possible.access', 'การไม่เชื่อมต่อถนนอาจเกี่ยวข้องกับกิจกรรมที่ทำไม่ได้ในภาพนี้ แต่ยังไม่ยืนยันสาเหตุของเหตุการณ์ก่อนหน้า', ['access.connected']));
    checks.push(row('check.access', 'ตรวจถนนจากอาคารหรือบ้านไปยังโครงข่าย แล้วจับภาพใหม่หลังเกมประเมินรอบถัดไป', ['access.connected']));
  }
  if (get('workforce.employed') === 0 && ['shop', 'market', 'factory', 'farm'].includes(snapshot.entity.kind)) {
    hypotheses.push(row('possible.no-labor', 'การไม่มีแรงงานที่ได้รับจัดสรรอาจเกี่ยวข้องกับกิจกรรมของกิจการ ตรวจความสามารถและเงื่อนไขการจ้างก่อนสรุปสาเหตุ', ['workforce.employed']));
    checks.push(row('check.labor', 'ดูแรงงานลูกจ้างและเจ้าของทำเอง แยกจากความจุตำแหน่งงาน แล้วตรวจเงื่อนไขการจัดสรรในเกม', ['workforce.employed']));
  }
  if (get('cash.current') !== undefined) checks.push(row('check.cash', 'เปิดรายการเงินของขอบเขตที่เลือก แยกยอดคงเหลือปัจจุบันออกจากเงินเข้าออกระหว่างช่วง ไม่ใช้ผลต่างเงินสดแทนกำไร', ['cash.current']));
  const stockRefs = ['stocks.goods', 'stocks.crops'].filter(id => get(id) !== undefined);
  if (stockRefs.length) checks.push(row('check.stock', 'เทียบของคงคลังกับรายการรับเข้า ส่งออก และการผลิตหรือเก็บเกี่ยวของวันที่จับภาพ ก่อนสรุปว่าขาดวัตถุดิบ', stockRefs));
  if (snapshot.missing.length) checks.push(row('check.missing', 'ตรวจรายการหลักฐานที่ขาด ค่าที่ยังไม่มีไม่ใช่ศูนย์ และยังสรุปสาเหตุจากช่องเหล่านั้นไม่ได้', snapshot.missing.slice(0, 3).map(item => item.id)));
  if (!checks.length) checks.push(row('check.capture', 'จับภาพใหม่เมื่อมีข้อมูลที่ตรวจสอบได้ แล้วอ่านข้อสังเกตก่อนพิจารณาสาเหตุ', []));
  return { observations, hypotheses, checks };
}
export function validateEntitySelection(value, snapshot) {
  exact(value, ['observationIds', 'hypothesisIds', 'checkIds']);
  const candidates = entityExplanationCandidates(snapshot);
  const groups = [['observationIds', 'observations', 6], ['hypothesisIds', 'hypotheses', 3], ['checkIds', 'checks', 3]];
  const selection = {};
  for (const [key, group, max] of groups) {
    const ids = new Set(candidates[group].map(row => row.id)), list = value[key];
    if (!Array.isArray(list) || list.length > max || new Set(list).size !== list.length || list.some(id => typeof id !== 'string' || !ids.has(id))) fail();
    selection[key] = [...list];
  }
  if (candidates.observations.length && !selection.observationIds.length || !selection.checkIds.length) fail();
  return selection;
}
export function buildEntityReport(raw, selection, mode = 'fallback') {
  const snapshot = validateEntitySnapshot(raw);
  if (!['ai', 'fallback'].includes(mode)) fail();
  return { schemaVersion: 2, operation: 'entity-explanation', mode, snapshot, report: validateEntitySelection(selection, snapshot) };
}
export function buildLocalEntityExplanation(raw) {
  const snapshot = validateEntitySnapshot(raw), c = entityExplanationCandidates(snapshot);
  const priority = ['cash.current', 'cash.net', 'workforce.employed', 'stocks.goods', 'stocks.crops', 'occupancy.persons', 'workforce.members'];
  const sorted = [...c.observations].sort((a, b) => {
    const rank = row => { const n = priority.indexOf(row.factRefs[0]); return n < 0 ? 100 : n; };
    return rank(a) - rank(b);
  });
  return buildEntityReport(snapshot, { observationIds: sorted.slice(0, 6).map(row => row.id), hypothesisIds: c.hypotheses.slice(0, 3).map(row => row.id), checkIds: c.checks.slice(0, 3).map(row => row.id) });
}
export function acceptEntityExplanation(value, local) {
  try {
    exact(value, ['schemaVersion', 'operation', 'mode', 'snapshot', 'report']);
    if (value.schemaVersion !== 2 || value.operation !== 'entity-explanation' || canonical(validateEntitySnapshot(value.snapshot)) !== canonical(local.snapshot)) return null;
    return buildEntityReport(local.snapshot, value.report, value.mode);
  } catch { return null; }
}
export function entityExplanationRows(response) {
  const c = entityExplanationCandidates(response.snapshot), s = validateEntitySelection(response.report, response.snapshot);
  return {
    observations: s.observationIds.map(id => c.observations.find(row => row.id === id)),
    hypotheses: s.hypothesisIds.map(id => c.hypotheses.find(row => row.id === id)),
    checks: s.checkIds.map(id => c.checks.find(row => row.id === id)),
  };
}
