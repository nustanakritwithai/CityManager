import './city-questions-panel.css';
import type { City } from './sim.ts';
import { CITY_FACT_QUESTIONS, answerCityFactQuestion, type CityFactAnswer, type CityFactIntent } from './city-questions.ts';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** Explicit local fact queries. No provider call, history reconstruction or simulation writes. */
export function createCityQuestionsPanel(host: HTMLElement, { getCity }: { getCity: () => City }) {
  let owner: City | null = null;
  let captured: CityFactAnswer | null = null;
  let entitySignature = '';
  host.classList.add('city-questions-panel');
  const title = node('h3', '', 'ข้อเท็จจริงในเกม');
  const intro = node('p', 'city-question-note', 'คำนวณในเครื่อง ไม่ส่งข้อมูลเพิ่ม · เลือกคำถามแล้วอ่านข้อมูล ณ วันที่จับภาพ ไม่ใช่ช่องแชต Typhoon');
  const form = node('form', 'city-question-form');
  const questionLabel = node('label', '', 'อยากดูข้อเท็จจริงเรื่องใด');
  const question = node('select'); question.id = 'city-question-intent'; questionLabel.htmlFor = question.id;
  for (const item of CITY_FACT_QUESTIONS) {
    const option = node('option', '', item.label); option.value = item.intent; question.append(option);
  }
  const entityLabel = node('label', '', 'เลือกรหัสในเมืองปัจจุบัน');
  const entity = node('select'); entity.id = 'city-question-entity'; entityLabel.htmlFor = entity.id;
  const entityGroup = node('div', 'city-question-entity-group'); entityGroup.append(entityLabel, entity);
  const ask = node('button', '', 'อ่านข้อเท็จจริง'); ask.id = 'city-question-ask'; ask.type = 'submit';
  form.append(questionLabel, question, entityGroup, ask);
  const stamp = node('p', 'city-question-stamp'); stamp.id = 'city-question-stamp'; stamp.setAttribute('role', 'status'); stamp.setAttribute('aria-live', 'polite');
  const stale = node('p', 'city-question-stale'); stale.id = 'city-question-stale'; stale.hidden = true;
  const content = node('div', 'city-question-answer'); content.id = 'city-question-answer';
  host.replaceChildren(title, intro, form, stamp, stale, content);

  function populateEntities() {
    const city = getCity(), intent = question.value as CityFactIntent, selected = entity.value;
    entityGroup.hidden = intent !== 'house.detail' && intent !== 'business.detail';
    const entities = intent === 'house.detail'
      ? city.buildings.filter(building => building.zone === 'R').map(building => ({ id: building.id, label: `บ้าน ${building.id} · ช่อง ${building.cell}` }))
      : intent === 'business.detail'
        ? city.firms.map(firm => ({ id: firm.id, label: `กิจการ ${firm.id} · อาคาร ${firm.building}` })) : [];
    const signature = JSON.stringify([intent, entities]);
    if (entitySignature === signature) return;
    entitySignature = signature;
    const selectionRemoved = selected !== '' && !entityGroup.hidden && !entities.some(item => String(item.id) === selected);
    entity.replaceChildren();
    for (const item of entities) { const option = node('option', '', item.label); option.value = String(item.id); entity.append(option); }
    if (entities.some(item => String(item.id) === selected)) entity.value = selected;
    if (!entities.length && !entityGroup.hidden) {
      const option = node('option', '', intent === 'house.detail' ? 'ยังไม่มีบ้านในเมืองนี้' : 'ยังไม่มีสถานประกอบการในเมืองนี้'); option.value = ''; entity.append(option);
    }
    ask.disabled = !entityGroup.hidden && entity.value === '';
    if (selectionRemoved && captured) {
      captured = null; content.dataset.status = 'empty'; content.dataset.snapshotTick = '';
      content.replaceChildren(node('p', 'city-question-note', 'รายการที่เลือกไม่อยู่ในเมืองแล้ว เลือกรายการปัจจุบันแล้วกดอ่านข้อเท็จจริงใหม่'));
    }
  }
  function render(answer: CityFactAnswer) {
    content.dataset.status = answer.status; content.dataset.snapshotTick = String(answer.snapshotTick);
    content.replaceChildren(node('h4', '', answer.summary));
    for (const fact of answer.facts) {
      const row = node('section', 'city-question-fact'); row.dataset.factId = fact.id;
      const value = typeof fact.value === 'number' ? fact.value.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : fact.value;
      row.append(node('p', 'city-question-fact-label', fact.label), node('p', 'city-question-fact-value', `${value}${fact.unit ? ` ${fact.unit}` : ''}`));
      const evidence = node('details', 'city-question-evidence');
      evidence.append(node('summary', '', 'ตรวจรหัสและที่มา'), node('code', '', fact.id), node('p', '', `ที่มา: ${fact.source}`));
      if (fact.entityRefs.length) evidence.append(node('p', '', `อ้างอิง: ${fact.entityRefs.join(', ')}`));
      row.append(evidence); content.append(row);
    }
    const missing = node('details', 'city-question-missing'); missing.open = answer.status !== 'observed';
    missing.append(node('summary', '', `ข้อมูลที่ยังไม่มี (${answer.missingData.length})`));
    for (const flag of answer.missingData) { const item = node('p', '', flag.text); item.dataset.missingId = flag.id; missing.append(item); }
    if (!answer.missingData.length) missing.append(node('p', '', 'ไม่มีช่องข้อมูลที่ขาดสำหรับคำถามที่เลือก ไม่ได้หมายความว่าเกมจำลองทุกเรื่องแล้ว'));
    const scope = node('details', 'city-question-scope'); scope.append(node('summary', '', 'ขอบเขตและสมมติฐาน'));
    scope.append(node('p', '', 'คำตอบนี้มีเฉพาะข้อสังเกต ไม่มีสมมติฐานหรือข้อสรุปสาเหตุ'));
    for (const limitation of answer.limitations) scope.append(node('p', '', limitation));
    content.append(missing, scope);
  }
  function sync() {
    const city = getCity();
    if (owner && (owner !== city || captured && city.tick < captured.snapshotTick)) { reset(); return; }
    populateEntities();
    stamp.textContent = captured ? `ภาพที่จับ: วันที่ ${captured.snapshotTick} · เมืองปัจจุบัน: วันที่ ${city.tick}` : `เมืองปัจจุบัน: วันที่ ${city.tick} · ยังไม่ได้อ่านข้อเท็จจริง`;
    stale.hidden = !captured || captured.snapshotTick === city.tick;
    if (!stale.hidden) stale.textContent = `เมืองเดินต่อแล้ว ${city.tick - captured!.snapshotTick} วัน กดอ่านข้อเท็จจริงเพื่อจับข้อมูลปัจจุบัน`;
    host.dataset.stale = String(!stale.hidden);
  }
  function reset() {
    owner = getCity(); captured = null; populateEntities();
    content.dataset.status = 'empty'; content.dataset.snapshotTick = '';
    content.replaceChildren(node('p', 'city-question-note', 'ยังไม่มีคำตอบ เลือกคำถามที่มีข้อมูลรองรับแล้วกดอ่านข้อเท็จจริง')); sync();
  }
  function refresh() {
    const city = getCity();
    if (owner !== city) reset();
    owner = city;
    const intent = question.value as CityFactIntent;
    captured = answerCityFactQuestion(city, { schemaVersion: 1, intent, ...(!entityGroup.hidden ? { entityId: Number(entity.value) } : {}) });
    render(captured); sync();
  }
  question.addEventListener('change', reset);
  entity.addEventListener('change', reset);
  form.addEventListener('submit', event => { event.preventDefault(); refresh(); });
  reset(); return { refresh, reset, sync };
}
