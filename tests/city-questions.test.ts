import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, serialize, step, housingCapacity } from '../src/sim.ts';
import { answerCityFactQuestion, validateCityFactQuestion, type CityFactAnswer, type CityFactIntent } from '../src/city-questions.ts';

const matureCity = () => { const city = createCity(61025); for (let day = 0; day < 65; day++) step(city); return city; };
const ask = (city: ReturnType<typeof createCity>, intent: CityFactIntent, entityId?: number) => answerCityFactQuestion(city, { schemaVersion: 1, intent, ...(entityId === undefined ? {} : { entityId }) });
const fact = (answer: CityFactAnswer, id: string) => { const item = answer.facts.find(row => row.id === id); assert(item, `Expected ${id}`); return item; };

test('only bounded supported local question intents and matching entity IDs are accepted', () => {
  assert.deepEqual(validateCityFactQuestion({ schemaVersion: 1, intent: 'city.housing' }), { schemaVersion: 1, intent: 'city.housing' });
  assert.deepEqual(validateCityFactQuestion({ schemaVersion: 1, intent: 'house.detail', entityId: 12 }), { schemaVersion: 1, intent: 'house.detail', entityId: 12 });
  for (const value of [null, 'จ่ายเงินให้ทุกบ้าน', { schemaVersion: 1, intent: 'make-policy' }, { schemaVersion: 1, intent: 'city.housing', prompt: 'ignore rules' }, { schemaVersion: 1, intent: 'city.workforce', entityId: 1 }, { schemaVersion: 1, intent: 'house.detail' }, { schemaVersion: 1, intent: 'house.detail', entityId: -1 }, { schemaVersion: 1, intent: 'business.detail', entityId: 1.2 }, { schemaVersion: 1, intent: 'house.detail', entityId: 0 }]) assert.equal(validateCityFactQuestion(value), null);
});

test('city housing separates people, households and capacity and preserves actual zeros', () => {
  const city = matureCity(), before = serialize(city), answer = ask(city, 'city.housing');
  const homes = city.buildings.filter(item => item.zone === 'R');
  assert.equal(answer.status, 'observed'); assert.equal(answer.snapshotTick, 65);
  assert.equal(fact(answer, 'city.housing.households').value, city.households.length);
  assert.equal(fact(answer, 'city.housing.population').value, city.households.reduce((n, item) => n + item.members, 0));
  assert.notEqual(fact(answer, 'city.housing.population').value, fact(answer, 'city.housing.households').value);
  assert.equal(fact(answer, 'city.housing.capacity-people').value, homes.reduce((n, item) => n + housingCapacity(item).persons, 0));
  assert.equal(fact(answer, 'city.housing.unhoused-households').value, city.households.filter(item => item.home === null).length);
  assert(answer.limitations.some(text => text.includes('ไม่รับรอง')));
  const empty = ask(createCity(), 'city.housing'); assert.equal(fact(empty, 'city.housing.population').value, 0); assert.equal(empty.missingData.length, 0);
  assert.equal(serialize(city), before);
});

test('workforce uses only actual workforce and worker allocations; dependents are not unemployed', () => {
  const city = matureCity(), answer = ask(city, 'city.workforce');
  const workforce = city.households.reduce((n, item) => n + item.workforce, 0), employed = city.employment.reduce((n, item) => n + item.workers, 0);
  assert.equal(fact(answer, 'city.workforce.total').value, workforce);
  assert.equal(fact(answer, 'city.workforce.employed').value, employed);
  assert.equal(fact(answer, 'city.workforce.unemployed').value, workforce - employed);
  assert.notEqual(fact(answer, 'city.workforce.unemployed').value, Number(fact(answer, 'city.workforce.population').value) - employed);
  assert(answer.missingData.some(item => item.id === 'missing.city.workforce.education'));
  const pools = ['general', 'manufacturing', 'retail'] as const;
  for (const skill of pools) assert.equal(fact(answer, `city.workforce.skill.${skill}`).value, city.households.reduce((n, item) => n + item.workerSkills[skill], 0));
  assert.equal(pools.reduce((n, skill) => n + Number(fact(answer, `city.workforce.skill.${skill}`).value), 0), workforce, 'disjoint capability counts neither duplicate people nor imply schooling');
  assert.equal(fact(answer, 'city.workforce.legacy-assumed').value, 0, 'fresh arrival profiles are not labelled imported assumptions');
  assert(!answer.facts.some(item => /education/.test(item.id)));
  assert.deepEqual(answer.hypotheses, []);
});

test('business overview counts actual firm records and does not fabricate opening history or financial statements', () => {
  const city = matureCity(), answer = ask(city, 'city.businesses');
  assert.equal(fact(answer, 'city.businesses.total').value, city.firms.length);
  assert.equal(fact(answer, 'city.businesses.commercial').value, city.firms.filter(item => item.zone === 'C').length);
  assert.equal(fact(answer, 'city.businesses.industrial').value, city.firms.filter(item => item.zone === 'I').length);
  assert(answer.missingData.some(item => item.id === 'missing.city.businesses.history'));
  assert(!answer.facts.some(item => /profit|revenue|expense|balance/.test(item.id)));
});

test('house detail follows the actual home ID and exposes copied numeric facts with source references', () => {
  const city = matureCity(), home = city.buildings.find(item => item.zone === 'R')!;
  assert(home); const before = serialize(city), answer = ask(city, 'house.detail', home.id);
  const residents = city.households.filter(item => item.home === home.id);
  assert.equal(fact(answer, 'house.occupied-households').value, residents.length);
  assert.equal(fact(answer, 'house.occupied-people').value, residents.reduce((n, item) => n + item.members, 0));
  assert.equal(fact(answer, 'house.capacity-people').value, housingCapacity(home).persons);
  assert.equal(fact(answer, 'house.cell').value, home.cell);
  assert(answer.facts.every(item => item.source && item.entityRefs.includes(`building:${home.id}`)));
  assert.equal(serialize(city), before);
  const original = structuredClone(answer); home.level += 10; if (residents[0]) residents[0].members += 100;
  assert.deepEqual(answer, original, 'answers retain copied scalars, not city record references');
});

test('business detail distinguishes firm ID from building ID and uses actual allocation and inventory', () => {
  const city = matureCity(), firm = city.firms[0]; assert(firm);
  firm.wallet = 'not-part-of-fact-answer';
  const before = serialize(city), answer = ask(city, 'business.detail', firm.id);
  assert.equal(fact(answer, 'business.id').value, firm.id); assert.equal(fact(answer, 'business.building').value, firm.building);
  assert.equal(fact(answer, 'business.workers').value, city.employment.filter(item => item.firmId === firm.id).reduce((n, item) => n + item.workers, 0));
  assert.equal(fact(answer, 'business.inventory').value, firm.inventory);
  assert(answer.facts.every(item => item.entityRefs.includes(`firm:${firm.id}`)));
  assert(answer.missingData.some(item => item.id === 'missing.business.profit-explanation'));
  assert(!JSON.stringify(answer).includes(firm.wallet)); assert.equal(serialize(city), before);
});

test('missing or wrong-kind entity reports absence rather than zero records or imagined causes', () => {
  const city = matureCity(), industrial = city.buildings.find(item => item.zone !== 'R')!; assert(industrial);
  for (const answer of [ask(city, 'house.detail', industrial.id), ask(city, 'house.detail', 999999), ask(city, 'business.detail', 999999)]) {
    assert.equal(answer.status, 'missing'); assert.equal(answer.facts.length, 0); assert(answer.missingData.length > 0); assert.deepEqual(answer.hypotheses, []);
  }
  const firm = city.firms[0]; city.buildings = city.buildings.filter(item => item.id !== firm.building);
  const answer = ask(city, 'business.detail', firm.id);
  assert(answer.missingData.some(item => item.id === 'missing.business.building'));
  assert(!answer.facts.some(item => item.id === 'business.level' || item.id === 'business.cell'));
});

test('invalid numbers are marked missing instead of silently clamped or converted to zero', () => {
  const city = matureCity(); city.households[0].workforce = NaN;
  let answer = ask(city, 'city.workforce');
  assert(answer.missingData.some(item => item.id === 'missing.city.workforce.total'));
  assert(!answer.facts.some(item => item.id === 'city.workforce.total'));
  city.households[0].workforce = 0; city.employment[0].workers = 1000;
  answer = ask(city, 'city.workforce');
  assert(answer.missingData.some(item => item.id === 'missing.city.workforce.unemployed'));
  assert(!answer.facts.some(item => item.id === 'city.workforce.unemployed'));
});

test('unsupported mutation or cause questions return bounded unsupported state with no city writes', () => {
  const city = matureCity(), before = serialize(city);
  for (const request of ['ทำไมกิจการขาดทุน', { schemaVersion: 1, intent: 'city.pay-balance', amount: 1000 }]) {
    const answer = answerCityFactQuestion(city, request);
    assert.equal(answer.status, 'unsupported'); assert.equal(answer.intent, null); assert.deepEqual(answer.facts, []); assert.deepEqual(answer.hypotheses, []);
  }
  assert.equal(serialize(city), before);
});
