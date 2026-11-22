import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, industryGrowthStatus, zoneCell, access, firmWorkerCount, INDUSTRY_STARTUP_CAPITAL, FACTORY_OWNER_RESERVE_MONTHS, MONTH, type City } from '../src/sim.ts';
import { growthStatusText } from '../src/context-data.ts';
import { growthChecklist } from '../src/overview-data.ts';
import { keepSupplied } from './plants.ts';
import { legacyIndustry } from './legacy-sizes.ts';

const run = (c: City, days: number) => { for (let d = 0; d < days; d++) { step(c); keepSupplied(c); } };
const give = (c: City, wallet: string, amount: number) => { c.accounts.outside = (c.accounts.outside ?? 0) - amount; c.accounts[wallet] = (c.accounts[wallet] ?? 0) + amount; };
/** Zone the first empty connected parcel for industry. */
function zoneFactory(c: City): number {
  const i = c.cells.findIndex((cell, i) => !cell.road && !cell.zone && cell.building === null && access(c, i));
  assert.ok(i >= 0 && zoneCell(c, i, 'I').ok); return i;
}
/** What a household paid out over the last 30 days, as the investor rule counts it. */
const spent = (c: City, wallet: string) => c.ledger.filter(e => e.tick > c.tick - MONTH && e.from === wallet && !/^(?:Owner capital contribution|Owner industry capital #\d+|Vehicle bought (?:motorcycle|car) #\d+)$/.test(e.reason)).reduce((n, e) => n + e.amount, 0);
/** A household with a home that could run a factory. */
const housed = (c: City) => c.households.find(h => h.home !== null && h.workerSkills.general + h.workerSkills.manufacturing > 0 && !c.firms.some(f => f.owner?.householdId === h.id))!;

test('a household with a home and the savings opens its own factory and a member runs it; the owner takes the profit', { timeout: 300_000 }, () => {
  const c = createCity(61025); run(c, 360);
  zoneFactory(c);
  const status = industryGrowthStatus(c);
  assert.equal(status.code, 'growth.household-investor', status.reason);
  const id = status.investorHouseholdId!, h = c.households.find(h => h.id === id)!;
  assert.ok(h.home !== null);
  assert.ok(c.accounts[h.wallet] >= INDUSTRY_STARTUP_CAPITAL + FACTORY_OWNER_RESERVE_MONTHS * spent(c, h.wallet), 'the opening capital and three months of its own spending');
  assert.match(growthStatusText(c).message, new RegExp(`ครัวเรือน #${id} มีเงินเก็บพอ`));
  assert.ok(growthChecklist(status.code).every(row => row.state !== 'fail'));
  let f = c.firms.find(f => f.zone === 'I' && f.owner);
  for (let d = 0; d < 30 && !f; d++) { step(c); keepSupplied(c); f = c.firms.find(f => f.zone === 'I' && f.owner); }
  assert.ok(f, 'the household opened a factory');
  assert.deepEqual(f.owner, { householdId: id, capitalContributed: INDUSTRY_STARTUP_CAPITAL, capitalReturned: 0, withdrawn: 0, taxPaid: 0 });
  const opening = c.ledger.filter(e => e.reason === `Owner industry capital #${f!.id}`);
  assert.equal(opening.length, 1);
  assert.deepEqual([opening[0].from, opening[0].to, opening[0].amount], [h.wallet, f.wallet, INDUSTRY_STARTUP_CAPITAL]);
  // A member left paid work to run the factory: owner labour, no wage.
  assert.deepEqual(c.ownerLabor.filter(o => o.householdId === id).map(o => o.firmId), [f.id]);
  assert.ok(firmWorkerCount(c, f.id) >= 1);
  assert.equal(c.employment.filter(e => e.householdId === id).reduce((n, e) => n + e.workers, 0) + 1, h.workforce, 'one member is the owner, the rest keep their jobs');
  assert.deepEqual(deserialize(serialize(c)), c, 'saves accept the household-owned factory');
  // A month later the owner household takes the profit after tax, less a quarter kept for growth.
  const firm = f, before = c.tick;
  run(c, MONTH - before % MONTH + 1);
  const payouts = c.ledger.filter(e => e.from === firm.wallet && e.reason === 'Owner profit distribution');
  assert.ok(payouts.length >= 1, 'the owner was paid');
  for (const e of payouts) assert.equal(e.to, h.wallet);
  assert.equal(firm.owner!.withdrawn, payouts.reduce((n, e) => n + e.amount, 0));
  const tax = c.ledger.filter(e => e.from === firm.wallet && e.reason === 'Monthly firm profit tax').reduce((n, e) => n + e.amount, 0);
  const net = firm.lastMonthProfit - tax;
  assert.ok(payouts.at(-1)!.amount <= net - Math.ceil(net / 4), 'a quarter of the profit stays in the factory');
  assert.ok(c.accounts[firm.wallet] >= 20_000, 'the factory keeps its working reserve');
  const raw = serialize(c); assert.deepEqual(deserialize(raw), c, 'saves accept the payouts');
  // Months later the opening capital has left the kept ledger for the city's history; saves still prove who paid it.
  const later = deserialize(raw); run(later, 3 * MONTH);
  assert.ok(!later.ledger.some(e => e.reason === `Owner industry capital #${firm.id}`) && later.history?.structuralProofs.some(e => e.reason === `Owner industry capital #${firm.id}`));
  assert.ok(later.firms.find(x => x.id === firm.id)?.owner?.householdId === id);
  assert.deepEqual(deserialize(serialize(later)), later, 'saves accept the factory after history compaction');
  // A factory claimed by another household, or opened with someone else's money, is not one the town saw.
  const forged = JSON.parse(raw); forged.firms.find((x: { id: number }) => x.id === firm.id).owner.householdId = c.households.find(x => x.id !== id)!.id;
  assert.throws(() => deserialize(JSON.stringify(forged)), 'a factory with the wrong owner');
  const ownerless = JSON.parse(raw); ownerless.firms.find((x: { id: number }) => x.id === firm.id).owner = null;
  assert.throws(() => deserialize(JSON.stringify(ownerless)), 'a household-funded factory with no owner');
});

test('a household invests only with three months of its own spending to spare, while the town\'s factories make money, one a month', { timeout: 300_000 }, () => {
  const c = createCity(61025); run(c, 95);
  const h = housed(c), needed = INDUSTRY_STARTUP_CAPITAL + FACTORY_OWNER_RESERVE_MONTHS * spent(c, h.wallet);
  give(c, h.wallet, needed - c.accounts[h.wallet] - 1);
  zoneFactory(c);
  let s = industryGrowthStatus(c);
  assert.notEqual(s.code, 'growth.household-investor', 'one baht short');
  assert.deepEqual(s.saver, { householdId: h.id, savings: needed - 1, needed });
  assert.match(growthStatusText(c).message, new RegExp(`ครัวเรือน #${h.id} จะลงทุนเปิดโรงงานเองเมื่อเงินเก็บครบ`));
  give(c, h.wallet, 1);
  s = industryGrowthStatus(c);
  assert.equal(s.code, 'growth.household-investor'); assert.equal(s.investorHouseholdId, h.id);
  // Only while the town's factories made money last month.
  const profits = c.firms.filter(f => f.zone === 'I').map(f => f.lastMonthProfit);
  for (const f of c.firms.filter(f => f.zone === 'I')) f.lastMonthProfit = 0;
  assert.notEqual(industryGrowthStatus(c).code, 'growth.household-investor');
  assert.match(growthStatusText(c).message, new RegExp(`ครัวเรือน #${h.id} มีเงินเก็บพอเปิดโรงงานเองแล้ว`));
  c.firms.filter(f => f.zone === 'I').forEach((f, i) => { f.lastMonthProfit = profits[i]; });
  give(c, h.wallet, 500_000); // a day's spending, or a motorcycle bought with the savings, must not take it back under the line
  let f = c.firms.find(f => f.owner?.householdId === h.id);
  for (let d = 0; d < 30 && !f; d++) { step(c); keepSupplied(c); f = c.firms.find(f => f.owner?.householdId === h.id); }
  assert.ok(f && f.zone === 'I', 'it opened its factory');
  // Another household with the savings waits for next month.
  const other = housed(c); give(c, other.wallet, 10_000_000); zoneFactory(c);
  assert.notEqual(industryGrowthStatus(c).code, 'growth.household-investor', 'one household factory a month');
});

test('cities saved before have no household factory owners', { timeout: 300_000 }, () => {
  const c = legacyIndustry(createCity(61025)); run(c, 95);
  const h = housed(c); give(c, h.wallet, 10_000_000); zoneFactory(c);
  const s = industryGrowthStatus(c);
  assert.notEqual(s.code, 'growth.household-investor');
  assert.equal(s.saver, null);
});
