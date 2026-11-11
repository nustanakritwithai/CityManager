import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TAX_RATES, scheduleCityTaxes, taxRatesAt, taxSatang } from '../src/city-tax-policy.ts';
import { buildPark, bulldoze, createCity, deserialize, firmWage, ownerFinance, serialize, step, withdrawOwnerProfit, type City } from '../src/sim.ts';

const advance = (city: City, day: number) => { while (city.tick < day) step(city); };
const wageTax = 'Monthly household wage tax';
const profitTax = 'Monthly firm profit tax';

test('defaults preserve old saves, and one pending change can be replaced or canceled', () => {
  const city = createCity(42);
  const old = serialize(city);
  assert.equal(JSON.parse(old).version, 27);
  scheduleCityTaxes(city, { wage: 1, profit: 2 });
  scheduleCityTaxes(city, { wage: 3, profit: 4 });
  assert.deepEqual(city.taxPolicy, [{ fromDay: 1, wage: 3, profit: 4 }]);
  assert.deepEqual(taxRatesAt(city.taxPolicy, 0), DEFAULT_TAX_RATES);
  const pending = serialize(city);
  assert.equal(JSON.parse(pending).taxBaseVersion, 27);
  assert.equal(serialize(deserialize(pending)), pending);
  scheduleCityTaxes(city, DEFAULT_TAX_RATES);
  assert.equal(serialize(city), old);

  advance(city, 12);
  scheduleCityTaxes(city, { wage: 5, profit: 7 });
  advance(city, 30);
  assert.deepEqual(taxRatesAt(city.taxPolicy, city.tick), DEFAULT_TAX_RATES);
  advance(city, 31);
  assert.deepEqual(taxRatesAt(city.taxPolicy, city.tick), { fromDay: 31, wage: 5, profit: 7 });
});

test('invalid percentages and malformed versioned schedules fail before replay', () => {
  const city = createCity(42);
  assert.throws(() => scheduleCityTaxes(city, { wage: 31, profit: 20 }), /tax rates/);
  assert.throws(() => scheduleCityTaxes(city, { wage: 0, profit: 20.5 }), /tax rates/);
  assert.equal(city.taxPolicy, undefined);
  scheduleCityTaxes(city, { wage: 0, profit: 0 });
  const raw = JSON.parse(serialize(city));
  assert.equal(raw.version, 29);
  for (const policy of [[], null, [{ fromDay: 2, wage: 0, profit: 0 }], [{ fromDay: 31, wage: 0, profit: 0 }],
    [{ fromDay: 1, wage: -1, profit: 0 }], [{ fromDay: 1, wage: 0, profit: 41 }], [raw.taxPolicy[0], raw.taxPolicy[0]]]) {
    assert.throws(() => deserialize(JSON.stringify({ ...raw, taxPolicy: policy })), /Invalid city tax policy/);
  }
  assert.throws(() => deserialize(JSON.stringify({ ...raw, taxBaseVersion: 26 })), /tax policy save version/);
  assert.throws(() => deserialize(JSON.stringify({ ...raw, version: 27, rulesVersion: 'chain-22' })), /requires save v29/);
});

test('firm and park wages and settled profits use the rate on the payment day', () => {
  const city = createCity(42);
  assert.ok(buildPark(city, 0).ok);
  scheduleCityTaxes(city, { wage: 17, profit: 33 });
  advance(city, 15);
  scheduleCityTaxes(city, { wage: 0, profit: 0 });
  advance(city, 30);
  const rows = city.ledger.filter(entry => entry.tick === 30);
  assert.ok(rows.some(entry => entry.reason === 'Monthly wages'));
  assert.ok(rows.some(entry => entry.reason.startsWith('Monthly park wages #')));
  for (const [i, entry] of rows.entries()) {
    if (entry.reason !== 'Monthly wages' && !entry.reason.startsWith('Monthly park wages #')) continue;
    assert.deepEqual(rows[i + 1], { tick: 30, from: entry.to, to: 'treasury', amount: Math.floor(entry.amount * 17 / 100), reason: wageTax });
  }
  const taxes = rows.filter(entry => entry.reason === profitTax);
  assert.ok(taxes.length);
  for (const entry of taxes) {
    const firm = city.firms.find(firm => firm.wallet === entry.from)!;
    assert.equal(entry.amount, Math.floor(firm.lastMonthProfit * 33 / 100));
  }
  advance(city, 60);
  assert.ok(city.ledger.some(entry => entry.tick === 60 && entry.reason === 'Monthly wages'));
  assert.ok(city.firms.some(firm => firm.lastMonthProfit > 0));
  assert.ok(city.ledger.every(entry => entry.tick <= 30 || ![wageTax, profitTax].includes(entry.reason)));
  assert.equal(taxSatang(-1, 40), 0);
  assert.equal(taxSatang(199, 33), 65);
  assert.equal(taxSatang(Number.MAX_SAFE_INTEGER, 39), 3_512_807_709_348_986);
  assert.equal(serialize(deserialize(serialize(city))), serialize(city));
});

test('owner withdrawal replay retains its old rate while later reserves and closure use the new rate', () => {
  const city = createCity(42);
  scheduleCityTaxes(city, { wage: 0, profit: 0 });
  advance(city, 98);
  const firm = city.firms.find(firm => firm.owner && ownerFinance(city, firm.id)!.withdrawAvailable > 0)!;
  assert.ok(firm);
  const old = ownerFinance(city, firm.id)!;
  assert.equal(old.taxReserve, 0);
  assert.ok(withdrawOwnerProfit(city, firm.id, old.withdrawAvailable).ok);
  scheduleCityTaxes(city, { wage: 30, profit: 40 });
  advance(city, 125);

  const raw = serialize(city);
  assert.equal(serialize(deserialize(raw)), raw);
  const payroll = Object.values(firm.workDays).reduce((total, days) => total + days * firmWage(firm) / 30, 0);
  const profit = firm.monthlyRevenue - firm.monthlyExpense - payroll;
  assert.ok(profit > 0);
  assert.equal(ownerFinance(city, firm.id)!.taxReserve, Math.floor(profit * 40 / 100));
  const closureTax = Math.floor((profit - firm.cropCost) * 40 / 100);
  assert.ok(closureTax > 0);
  assert.ok(bulldoze(city, city.buildings.find(building => building.id === firm.building)!.cell).ok);
  assert.equal(city.ledger.find(entry => entry.from === firm.wallet && entry.reason === 'Closing firm profit tax')?.amount, closureTax);
  assert.equal(serialize(deserialize(serialize(city))), serialize(city));
});
