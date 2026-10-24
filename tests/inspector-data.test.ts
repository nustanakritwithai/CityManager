import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, deserialize, type CropEntry } from '../src/sim.ts';
import { flowRows, cropFlowRows, walletGroups, formatMoney } from '../src/inspector-data.ts';

test('money and goods rows preserve raw journal data and original indices newest first', () => {
  const city = createCity(61025);
  city.ledger = [
    { tick: 2, from: 'outside', to: 'treasury', amount: 1, reason: 'Initial municipal grant' },
    { tick: 9, from: 'household:7', to: 'firm:9', amount: 800, reason: 'Household #7 purchase' },
    { tick: 9, from: 'firm:9', to: 'custom-sink', amount: 1234567, reason: 'Unknown future reason' },
  ];
  city.goodsLedger = [
    { tick: 2, from: 'production', to: 'firm:9', quantity: 8, reason: 'Daily worker production' },
    { tick: 9, from: 'firm:9', to: 'household:7', quantity: 1, reason: 'Household final consumption' },
    { tick: 9, from: 'firm:9', to: 'outside', quantity: 3, reason: 'Demolition stock write-off to outside' },
  ];
  for (const kind of ['money', 'goods'] as const) {
    const entries = kind === 'money' ? city.ledger : city.goodsLedger;
    const rows = flowRows(city, kind);
    assert.equal(rows.length, entries.length);
    assert.deepEqual(rows.map(row => row.index), [2, 1, 0]);
    for (const row of rows) {
      const original = entries[row.index];
      assert.equal(row.kind, kind);
      assert.equal(row.tick, original.tick);
      assert.equal(row.reason, original.reason);
      assert.equal(row.from, original.from);
      assert.equal(row.to, original.to);
      assert.equal(row.value, 'amount' in original ? original.amount : original.quantity);
      assert.ok(/[ก-๙]/.test(row.label));
    }
  }
  assert.equal(flowRows(city, 'money')[1].label, 'ครัวเรือน #7 ซื้อสินค้า');
  assert.equal(flowRows(city, 'money')[1].fromLabel, 'ครัวเรือน #7');
  assert.equal(flowRows(city, 'money')[1].toLabel, 'บริษัท #9');
  assert.equal(flowRows(city, 'money')[0].label, 'รายการอื่น: Unknown future reason');
  assert.equal(flowRows(city, 'money')[0].toLabel, 'บัญชี custom-sink');
  assert.match(flowRows(city, 'goods')[0].label, /ไม่มีรายรับ/);
});

test('wallet groups retain every signed and zero account exactly once with truthful outside semantics', () => {
  const city = createCity();
  city.accounts = { treasury: 12345, 'household:3': 0, 'firm:8': 700, outside: -15000, construction: 1000, upkeep: 0, 'unknown-source': 955, 'firm:closed': 0 };
  const groups = walletGroups(city), accounts = groups.flatMap(group => group.accounts);
  assert.deepEqual(groups.map(group => group.key), ['city', 'households', 'firms', 'outside', 'system']);
  assert.equal(accounts.length, Object.keys(city.accounts).length);
  assert.equal(new Set(accounts.map(account => account.id)).size, accounts.length);
  assert.deepEqual(Object.fromEntries(accounts.map(account => [account.id, account.balance])), city.accounts);
  for (const group of groups) assert.equal(group.total, group.accounts.reduce((sum, account) => sum + account.balance, 0));
  assert.equal(groups.reduce((sum, group) => sum + group.total, 0), Object.values(city.accounts).reduce((sum, value) => sum + value, 0));
  assert.equal(groups.find(group => group.key === 'outside')!.total, -15000);
  assert.match(groups.find(group => group.key === 'outside')!.description, /ไม่ใช่หนี้เมืองหรือเงินสดที่ใช้จ่ายได้/);
  assert.equal(groups.find(group => group.key === 'firms')!.accounts.length, 2);
  assert.ok(groups.find(group => group.key === 'system')!.accounts.some(account => account.id === 'unknown-source'));
  assert.deepEqual(walletGroups({ ...city, accounts: {} }).map(group => group.total), [0, 0, 0, 0, 0]);
});

test('presenters leave frozen simulation arrays, accounts and RNG unchanged and return independent rows', () => {
  const city = deserialize(readFileSync(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(city), rng = city.rng;
  const deepFreeze = (value: unknown): void => {
    if (value && typeof value === 'object') { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value); }
  };
  deepFreeze(city);
  const money = flowRows(city, 'money'), goods = flowRows(city, 'goods'), groups = walletGroups(city);
  money[0].reason = 'presentation edit'; goods[0].value = -999; groups[0].accounts[0].balance = -999;
  assert.equal(city.rng, rng);
  assert.equal(JSON.stringify(city), before);
  assert.notEqual(flowRows(city, 'money')[0].reason, 'presentation edit');
});

test('integer satang formatting preserves cents, signs and large amounts exactly', () => {
  assert.equal(formatMoney(0), '0.00');
  assert.equal(formatMoney(-0, true), '0.00');
  assert.equal(formatMoney(1), '0.01');
  assert.equal(formatMoney(-1), '-0.01');
  assert.equal(formatMoney(1, true), '+0.01');
  assert.equal(formatMoney(-1, true), '-0.01');
  assert.equal(formatMoney(123456789), '1,234,567.89');
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER), '90,071,992,547,409.91');
  assert.equal(formatMoney(-Number.MAX_SAFE_INTEGER, true), '-90,071,992,547,409.91');
  for (const invalid of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => formatMoney(invalid), RangeError);
});

test('crop rows retain their own immutable IDs, lot units, book values and cash without merging generic history', () => {
  const city = createCity(61025);
  const entry = (id: number, kind: CropEntry['kind'], overrides: Partial<CropEntry> = {}): CropEntry => ({ id, tick: id + 2, kind, from: 'firm:1', to: 'firm:2', quantity: 2, fromValue: 100, toValue: 300, cash: 300, workers: 0, batches: 0, outputQuantity: 0, reason: `Crop event ${id}`, ...overrides });
  city.cropLedger = [
    entry(1, 'harvest', { from: 'environment:crops', to: 'firm:1', fromValue: 0, toValue: 0, cash: 0, workers: 1 }),
    entry(2, 'trade'),
    entry(3, 'process', { to: 'processing', toValue: 0, cash: 0, workers: 1, batches: 1, outputQuantity: 8 }),
    entry(4, 'writeoff', { to: 'outside', toValue: 0, cash: 0 }),
    entry(5, 'consumption', { to: 'household:8', quantity: 1, toValue: 0, cash: 800 }),
  ];
  city.goodsLedger = [{ tick: 1, from: 'production', to: 'firm:2', quantity: 8, reason: 'Crop recipe #3' }];
  const before = JSON.stringify(city), rows = cropFlowRows(city);
  assert.deepEqual(rows.map(row => [row.id, row.index]), [[5, 4], [4, 3], [3, 2], [2, 1], [1, 0]]);
  for (const row of rows) {
    const source = city.cropLedger[row.index];
    assert.equal(row.kind, 'crops'); assert.equal(row.cropKind, source.kind); assert.equal(row.value, source.quantity);
    for (const field of ['id', 'tick', 'from', 'to', 'reason', 'fromValue', 'toValue', 'cash', 'workers', 'batches', 'outputQuantity'] as const) assert.equal(row[field], source[field]);
    assert.ok(/[ก-๙]/.test(row.label));
  }
  assert.equal(rows.at(-1)!.fromLabel, 'ผลผลิตธรรมชาติจากพื้นที่');
  assert.equal(rows[2].toLabel, 'พืชผลที่ใช้แปรรูป'); assert.equal(rows[0].toLabel, 'ครัวเรือน #8');
  assert.deepEqual(flowRows(city, 'goods').map(row => [row.kind, row.index, row.value]), [['goods', 0, 8]]);
  rows[0].cash = 0; rows[1].value = -99; assert.equal(JSON.stringify(city), before);
});

test('crop and owner money labels describe actual transaction classes without counting capital as sales', () => {
  const city = createCity();
  city.ledger = [
    { tick: 1, from: 'household:2', to: 'firm:3', amount: 10000, reason: 'Owner capital contribution' },
    { tick: 2, from: 'firm:3', to: 'household:2', amount: 10000, reason: 'Owner profit distribution' },
    { tick: 3, from: 'firm:3', to: 'firm:4', amount: 300, reason: 'Crop exchange #7' },
    { tick: 3, from: 'household:2', to: 'firm:3', amount: 800, reason: 'Fresh crop purchase #8' },
  ];
  const rows = flowRows(city, 'money');
  assert.match(rows[3].label, /ทุน.*ไม่ใช่ยอดขาย/); assert.match(rows[2].label, /ถอนกำไร.*ไม่ใช่ค่าใช้จ่ายซ้ำ/);
  assert.match(rows[1].label, /พืชผล.*#7/); assert.match(rows[0].label, /ครัวเรือนซื้อพืชผล.*#8/);
  assert.equal(rows[0].value, 800); assert.equal(rows[3].value, 10000);
});
