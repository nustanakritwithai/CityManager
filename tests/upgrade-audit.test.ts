import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, isMarket, isRetail, marketConversionStatus, marketToConvert, retailGrowthStatus } from '../src/sim.ts';

test('market conversion preview agrees with the conversion gate and explains blockers', () => {
  const c = createCity(61025);
  for (let d = 0; d < 400; d++) {
    step(c);
    for (const f of c.firms.filter(isMarket)) {
      const s = marketConversionStatus(c, f);
      if (s.next) assert.equal(marketToConvert(c)?.id, f.id);
      if (marketToConvert(c)?.id === f.id) assert.equal(s.reasons.filter(r => !r.includes('ต้องการร้านค้า')).length, 0);
      else if (!s.next) assert.ok(s.reasons.length > 0 || marketToConvert(c) !== undefined);
    }
  }
});

test('retail growth profit blocker states the threshold', () => {
  const c = createCity(61025);
  for (let d = 0; d < 45; d++) step(c);
  const shop = c.firms.find(isRetail)!; shop.lastMonthProfit = -100;
  assert.ok(retailGrowthStatus(c, shop).reasons.some(r => /มากกว่า \d/.test(r)));
});

import { spareShortfall, utilityUpgradeBlocks, productionUpgradeStatus, MONTH } from '../src/sim.ts';
import { cityOverview } from '../src/context-data.ts';

test('utility shortfall names needed vs spare units and what to build', () => {
  assert.equal(spareShortfall({ power: 1, water: 1 }, { power: 1, water: 1 }), null);
  const text = spareShortfall({ power: 2, water: 3 }, { power: 0, water: 1 })!;
  assert.match(text, /ไฟฟ้าต้องเพิ่ม 2 หน่วย แต่สำรองเหลือ 0 — สร้างโรงไฟฟ้า/);
  assert.match(text, /น้ำต้องเพิ่ม 3 หน่วย แต่สำรองเหลือ 1 — สร้างปั๊มน้ำ/);
});

test('a utility-capped city tells the player which upgrades wait for water or power', () => {
  const live = createCity(61025); for (let d = 0; d < 400; d++) step(live);
  const blocks = utilityUpgradeBlocks(live);
  assert.ok(blocks.count > 0, 'the default contract caps some upgrade');
  const warning = cityOverview(live).warnings.find(w => w.includes('รออัปเกรดเพราะน้ำไฟสำรองไม่พอ'));
  assert.ok(warning && /ต้องการไฟเพิ่ม \d+ \(สำรอง \d+\)/.test(warning) && /(โรงไฟฟ้า|ปั๊มน้ำ)/.test(warning));
});

test('on the eve of a review the upgrade panels predict the month-end decision', () => {
  let checked = 0;
  for (const seed of [61025, 7]) {
    const c = createCity(seed); c.utilities.outside = { power: 200, water: 200 };
    for (let d = 0; d < 300; d++) {
      const eve = (c.tick + 1) % MONTH === 0, pred = new Map<number, boolean>();
      if (eve) for (const f of c.firms.filter(f => f.zone === 'I' || f.zone === 'F')) { const s = productionUpgradeStatus(c, f); if (s.nextLevel !== null) pred.set(f.building, !s.reasons.length); }
      const before = new Map(c.buildings.map(b => [b.id, b.level]));
      step(c);
      for (const [id, ok] of pred) { const b = c.buildings.find(b => b.id === id); if (b) { assert.equal(b.level > before.get(id)!, ok, `seed ${seed} day ${c.tick} building ${id}`); checked++; } }
    }
  }
  assert.ok(checked > 10);
});
