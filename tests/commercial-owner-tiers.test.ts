import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEducation, educationGate, credentialPosts, type EducationBuilding, type EducationPeople, type EducationPost, type EducationView } from '../src/education.ts';
import { commercialPresentation } from '../src/commercial-visuals.ts';
import { createCity, step, serialize, deserialize, commercialGrowthStatus, firmCredentialCounts, isCommercial, MONTH, type City, type Firm } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';
import { legacyIndustry } from './legacy-sizes.ts';

const person = (householdId: number, basic: number, higher = 0): EducationPeople => ({ householdId, basic, higher, school: 0, university: 0, teacher: 0, professor: 0, campusId: null, progress: 0 });
/** A shop (building 10, firm 20) whose next level is `next`, with the given posts and diplomas, every gate held for 30 days. */
function gate(next: number, posts: EducationPost[], people: EducationPeople[], ownerTiers = true) {
  const state = createEducation('new-city'), b: EducationBuilding = { id: 10, zone: 'C', level: next - 1, firmId: 20 };
  state.people = people; state.residentBasic = people.reduce((n, p) => n + p.basic, 0); state.residentHigher = people.reduce((n, p) => n + p.higher, 0);
  state.sustain = [{ buildingId: 10, days: 30 }];
  const view: EducationView = { tick: 30, households: [1, 2].map(id => ({ id, workforce: 2, wallet: `household:${id}`, ownsFirm: id === 1 })), buildings: [b], posts, road: () => true, sparePower: 10, spareWater: 10, treasury: 0, ownerTiers };
  return { state, view, result: educationGate(state, view, b) };
}
const owner: EducationPost = { firmId: 20, householdId: 1, workers: 0, owner: true }, clerk: EducationPost = { firmId: 20, householdId: 2, workers: 1, owner: false };

test('a shop grows to level 3 with no diploma, a market needs an owner with a school diploma and a mall one with a university degree', () => {
  for (const next of [2, 3]) assert.equal(gate(next, [owner], []).result.need, 0, `shop level ${next}`);
  for (const next of [4, 5, 6]) {
    assert.deepEqual(gate(next, [owner], [person(1, 1)]).result.blocked, [], `market level ${next} with an owner who finished school`);
    assert.deepEqual(gate(next, [owner], []).result.blocked, ['มี 0/1 · ขาดเจ้าของกิจการที่ถือวุฒิพื้นฐาน']);
  }
  for (const next of [7, 8, 9]) {
    assert.deepEqual(gate(next, [owner], [person(1, 1)]).result.blocked, ['มี 0/1 · ขาดเจ้าของกิจการที่ถือวุฒิขั้นสูง'], `mall level ${next} needs a graduate owner`);
    assert.deepEqual(gate(next, [owner], [person(1, 1, 1)]).result.blocked, []);
  }
  assert.deepEqual([3, 4, 6, 7, 9].map(level => commercialPresentation(level).title), ['ร้านค้า', 'ตลาด', 'ตลาด', 'ห้าง', 'ห้าง']);
});

test("the owner's own diploma counts, not a clerk's; a shop with no owner at work goes by its staff", () => {
  assert.deepEqual(gate(4, [owner, clerk], [person(2, 1)]).result.blocked, ['มี 0/1 · ขาดเจ้าของกิจการที่ถือวุฒิพื้นฐาน'], 'a clerk who finished school does not make the owner one');
  assert.deepEqual(gate(4, [owner, clerk], [person(1, 1), person(2, 0)]).result.blocked, []);
  // Investors outside the town own it and nobody owns-and-works it: the staff need the diploma.
  assert.deepEqual(gate(4, [clerk], []).result.blocked, ['มี 0/1 · ขาดคนทำงานร้านที่ถือวุฒิพื้นฐาน 1 คน']);
  assert.deepEqual(gate(4, [clerk], [person(2, 1)]).result.blocked, []);
});

test("a household's diploma goes to its own business before its other jobs, in new cities only", () => {
  // Household 1 owns shop 20 and also works at firm 5; its one diploma holder runs the shop.
  const posts: EducationPost[] = [owner, { firmId: 5, householdId: 1, workers: 1, owner: false }], people = [person(1, 1)];
  const { state, view } = gate(4, posts, people);
  assert.equal(credentialPosts(state, view, 20, 'basic', true), 1);
  assert.equal(credentialPosts(state, view, 5, 'basic'), 0, 'the same person is not counted twice');
  const old = gate(4, posts, people, false);
  assert.equal(credentialPosts(old.state, old.view, 5, 'basic'), 1, 'a city saved before allocates in firm order');
  // A city saved before keeps the old bands: no diploma to level 4, a school diploma for 5–6 from anyone at work there.
  assert.equal(gate(4, [owner], [], false).result.need, 0);
  assert.deepEqual(gate(5, [owner, clerk], [person(2, 1)], false).result.blocked, []);
});

const toEve = (c: City) => { while ((c.tick + 1) % MONTH !== 0) { step(c); keepSupplied(c); } };
/** The shop's owner holds a school diploma (and a university degree when `higher`), held for the 30 days the gate asks. */
function ownerDiploma(c: City, f: Firm, higher: boolean) {
  const state = c.education!, id = f.owner!.householdId, h = c.households.find(h => h.id === id)!;
  state.people = [...state.people.filter(p => p.householdId !== id), person(id, 1, higher ? 1 : 0)];
  state.residentBasic = state.people.reduce((n, p) => n + p.basic, 0); state.residentHigher = state.people.reduce((n, p) => n + p.higher, 0);
  state.sustain = [...state.sustain.filter(s => s.buildingId !== f.building), { buildingId: f.building, days: 30 }];
  assert.ok(h.workforce >= 1);
}

test('in a new city the shop stops at level 3 until its owner finishes school, and becomes a mall only with a graduate owner', { timeout: 300_000 }, () => {
  const c = createCity(61025); for (let d = 0; d < 95; d++) { step(c); keepSupplied(c); }
  const f = c.firms.find(f => isCommercial(f) && f.owner)!, b = c.buildings.find(b => b.id === f.building)!;
  assert.equal(b.level, 3, 'a shop grows to level 3 with no diploma');
  assert.ok(commercialGrowthStatus(c, f).reasons.includes('มี 0/1 · ขาดเจ้าของกิจการที่ถือวุฒิพื้นฐาน'));
  // Its profit pays for growth; only the owner's schooling holds it back.
  toEve(c); step(c); keepSupplied(c);
  assert.equal(b.level, 3, 'no owner with a diploma, no market');
  assert.deepEqual(commercialGrowthStatus(c, f).reasons.filter(r => !r.includes('วุฒิ') && !r.includes('ต่อเนื่อง')), []);
  toEve(c); ownerDiploma(c, f, false); step(c); keepSupplied(c);
  assert.equal(b.level, 4, 'an owner who finished school turns the shop into a market');
  assert.equal(commercialPresentation(b.level).title, 'ตลาด');
  assert.equal(firmCredentialCounts(c, f.id).basic, 1);
  assert.deepEqual(deserialize(serialize(c)), c, 'saves accept the grown market');
  b.level = 6;
  toEve(c); ownerDiploma(c, f, false);
  assert.ok(commercialGrowthStatus(c, f).reasons.includes('มี 0/1 · ขาดเจ้าของกิจการที่ถือวุฒิขั้นสูง'), 'a mall needs an owner with a university degree');
  step(c); keepSupplied(c);
  assert.equal(b.level, 6);
  toEve(c); ownerDiploma(c, f, true); step(c); keepSupplied(c);
  assert.equal(b.level, 7, 'a graduate owner opens a mall');
  assert.equal(commercialPresentation(b.level).title, 'ห้าง');
});

test('a city saved before keeps the old commercial bands', { timeout: 300_000 }, () => {
  const c = legacyIndustry(createCity(61025)); for (let d = 0; d < 95; d++) { step(c); keepSupplied(c); }
  const f = c.firms.find(f => isCommercial(f) && f.owner)!, b = c.buildings.find(b => b.id === f.building)!;
  b.level = 3;
  assert.ok(!commercialGrowthStatus(c, f).reasons.some(r => r.includes('วุฒิ')), 'level 4 needs no diploma under the old rule');
});
