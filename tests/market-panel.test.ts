import test from 'node:test';
import assert from 'node:assert/strict';
import { depositSourceLabel, depositSourceStock, eligibleDepositFirms } from '../src/market-panel.ts';
import type { City, Firm } from '../src/sim.ts';

const firm = (patch: Partial<Firm>): Firm => ({
  id: 1, building: 1, zone: 'F', crops: { rice: 0, vegetables: 0, sugarcane: 0 }, products: { 'milled-rice': 0, 'canned-food': 0, sugar: 0 }, wallet: 'firm', workDays: {}, inventory: 0, cropInventory: 0, cropCost: 0, productionTick: 0, owner: null, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0, ...patch,
});
const city = (...firms: Firm[]) => ({ firms } as unknown as Pick<City, 'firms'>);

test('deposit source selection is item-dependent and stock-aware', () => {
  const farm = firm({ id: 1, zone: 'F', crops: { rice: 2, vegetables: 0, sugarcane: 0 } });
  const wrongFactory = firm({ id: 2, zone: 'I', recipe: 'sugar-mill', products: { 'milled-rice': 2, 'canned-food': 0, sugar: 0 } });
  const riceFactory = firm({ id: 3, zone: 'I', recipe: 'rice-mill', products: { 'milled-rice': 3, 'canned-food': 0, sugar: 0 } });
  assert.deepEqual(eligibleDepositFirms(city(farm, wrongFactory, riceFactory), 'crop:rice').map(x => x.id), [1]);
  assert.deepEqual(eligibleDepositFirms(city(farm, wrongFactory, riceFactory), 'product:milled-rice').map(x => x.id), [3]);
  assert.equal(depositSourceStock(wrongFactory, 'product:milled-rice'), 0);
  assert.equal(depositSourceLabel(farm, 'crop:rice'), 'ฟาร์ม #1 · มี 2 หน่วย');
  assert.equal(depositSourceLabel(riceFactory, 'product:milled-rice'), 'โรงงานข้าวสาร #3 · มี 3 หน่วย');
});

test('empty or invalid deposit stock is not eligible', () => {
  const emptyFarm = firm({ zone: 'F' });
  const emptyFactory = firm({ zone: 'I', recipe: 'rice-mill' });
  assert.deepEqual(eligibleDepositFirms(city(emptyFarm, emptyFactory), 'crop:rice'), []);
  assert.deepEqual(eligibleDepositFirms(city(emptyFarm, emptyFactory), 'product:milled-rice'), []);
  assert.equal(depositSourceStock(firm({ zone: 'F', crops: { rice: Number.NaN, vegetables: 0, sugarcane: 0 } }), 'crop:rice'), 0);
});
