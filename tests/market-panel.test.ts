import test from 'node:test';
import assert from 'node:assert/strict';
import { activeMarketListings, canBuyListing, depositSourceLabel, depositSourceStock, eligibleDepositFirms, mergeMarketListings } from '../src/market-panel.ts';
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
  assert.equal(depositSourceLabel(farm, 'crop:rice'), 'ฟาร์มข้าว #1 · มี 2 ล็อต', 'crops count in lots');
  assert.equal(depositSourceLabel(riceFactory, 'product:milled-rice'), 'โรงสีข้าว #3 · มี 3 หน่วย', 'a factory is named by its recipe');
});

test('empty or invalid deposit stock is not eligible', () => {
  const emptyFarm = firm({ zone: 'F' });
  const emptyFactory = firm({ zone: 'I', recipe: 'rice-mill' });
  assert.deepEqual(eligibleDepositFirms(city(emptyFarm, emptyFactory), 'crop:rice'), []);
  assert.deepEqual(eligibleDepositFirms(city(emptyFarm, emptyFactory), 'product:milled-rice'), []);
  assert.equal(depositSourceStock(firm({ zone: 'F', crops: { rice: Number.NaN, vegetables: 0, sugarcane: 0 } }), 'crop:rice'), 0);
});

test('buy controls fail closed for empty, invalid, or unaffordable listings', () => {
  assert.equal(canBuyListing(1, 10n, '10'), true);
  assert.equal(canBuyListing(0, 100n, '1'), false);
  assert.equal(canBuyListing(-1, 100n, '1'), false);
  assert.equal(canBuyListing(Number.NaN, 100n, '1'), false);
  assert.equal(canBuyListing(1, 9n, '10'), false);
  assert.equal(canBuyListing(1, 100n, '0'), false);
  assert.equal(canBuyListing(1, 100n, '-1'), false);
  assert.equal(canBuyListing(1, 100n, Number.NaN), false);
  assert.equal(canBuyListing(1, 100n, Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(canBuyListing(1, 100n, 'not-a-price'), false);
});

test('central market includes own listings once and marks them non-buyable', () => {
  const rows = mergeMarketListings([{ id: 'a', item_code: 'crop:rice', status: 'open' }], [{ id: 'a', item_code: 'crop:rice', status: 'open' }, { id: 'b', item_code: 'crop:sugarcane', status: 'open' }]);
  assert.deepEqual(rows, [{ id: 'a', item_code: 'crop:rice', status: 'open', own: true }, { id: 'b', item_code: 'crop:sugarcane', status: 'open', own: true }]);
  assert.equal(rows.find(x => x.id === 'b')?.own, true);
});

test('closed listings are hidden from both market sources while open rows remain', () => {
  const publicRows = [{ id: 'open-public', status: 'open' }, { id: 'cancelled-public', status: 'cancelled' }, { id: 'expired-public', status: 'expired' }];
  const ownRows = [{ id: 'open-own', status: 'open' }, { id: 'cancelled-own', status: 'cancelled' }, { id: 'expired-own', status: 'expired' }];
  assert.deepEqual(activeMarketListings([...publicRows, ...ownRows]).map(row => row.id), ['open-public', 'open-own']);
  assert.deepEqual(mergeMarketListings(publicRows, ownRows).map(row => row.id), ['open-public', 'open-own']);
});

test('closed own listing suppresses a stale open public duplicate', () => {
  const rows = mergeMarketListings([{ id: 'same', status: 'open' }], [{ id: 'same', status: 'cancelled' }]);
  assert.deepEqual(rows, []);
});
