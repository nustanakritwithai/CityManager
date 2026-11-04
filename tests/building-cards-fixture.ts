import assert from 'node:assert/strict';
import { adoptSavedEducation, deserialize, expandValidatedCity, isRetail, serialize, step, type City } from '../src/sim.ts';
import { createCity as createV4, serialize as serializeV4, step as stepV4 } from '../src/legacy-v4.ts';
import { keepSupplied } from './plants.ts';

/** Published-save replay, followed only by real days and player-equivalent utility builds. */
export function createBuildingCardsFixture() {
  const prior = createV4(61025); for (let day = 0; day < 29; day++) stepV4(prior);
  const legacy = deserialize(serializeV4(prior)), legacyInput = serialize(legacy);
  const fixture = expandValidatedCity(legacy); adoptSavedEducation(fixture);
  const baseline = serialize(fixture); assert.deepEqual(deserialize(baseline), fixture);
  const later = deserialize(baseline); for (let day = 0; day < 30; day++) step(later);
  assert.equal(later.tick, 59); assert.deepEqual(deserialize(serialize(later)), later);

  // Historical retail tags do not determine the current card: levels 1–3 are
  // markets. Keep those migration cases, then earn a shop through paid growth.
  const retail = fixture.firms.find(isRetail)!; assert.ok(retail);
  const shopCity = deserialize(baseline);
  while (shopCity.tick < 89) { keepSupplied(shopCity); step(shopCity); }
  keepSupplied(shopCity);
  const shopBefore = deserialize(serialize(shopCity));
  step(shopCity);
  const shopBuilding = shopCity.buildings.find(b => b.id === retail.building)!;
  const previous = shopBefore.buildings.find(b => b.id === retail.building)!;
  assert.equal(previous.level, 3); assert.equal(shopBuilding.level, 4);
  assert.equal(shopBuilding.id, previous.id); assert.equal(shopBuilding.cell, previous.cell);
  assert.deepEqual(shopCity.ledger.filter(e => e.tick === 90 && e.from === retail.wallet && e.reason === 'Profitable firm height investment'), [
    { tick: 90, from: retail.wallet, to: 'construction', amount: 20_000, reason: 'Profitable firm height investment' },
  ]);
  assert.deepEqual(deserialize(serialize(shopCity)), shopCity);
  return { fixture, legacyInput, baseline, later, shopCity, shopBefore, shopBuilding };
}

/** Independently pair physical trades with their actual cash payments. */
export function observedCardTrade(city: City, wallet: string, crops: boolean, direction: 'buy' | 'sell') {
  const rows = (crops ? city.cropLedger.filter(e => e.kind === 'trade' || e.kind === 'consumption') : city.goodsLedger.filter(e => e.from !== 'production' && e.reason !== 'Demolition stock write-off to outside'))
    .filter(e => e.tick >= Math.max(0, city.tick - 29) && e.tick <= city.tick && (direction === 'buy' ? e.to === wallet : e.from === wallet));
  if (!rows.length) return { quantity: null, cash: null, unit: null, status: 'missing' };
  let quantity = 0, cash = 0;
  for (const e of rows) {
    const reason = crops ? e.reason : e.reason === 'Wholesale stock delivery' ? 'Local wholesale goods' : e.reason === 'Imported shop stock' ? 'Outside goods import' : e.reason === 'Exported goods' ? 'Outside market goods export' : e.reason === 'Household final consumption' ? `Household #${e.to.slice(10)} purchase` : null;
    const paired = city.ledger.filter(m => m.tick === e.tick && m.from === e.to && m.to === e.from && m.reason === reason); assert.equal(paired.length, 1, 'Fixture physical trade has one actual matching cash payment');
    quantity += e.quantity; cash += paired[0].amount;
  }
  return { quantity, cash, unit: cash % quantity === 0 ? cash / quantity : null, status: cash % quantity === 0 ? 'observed' : 'non-integer' };
}

export type CardTradeSection = { commodity: string; keys: string[]; stats: Record<string, { value: string; status?: string }> };
export function assertCommercialCardTrades(city: City, wallet: string, kind: string, sections: CardTradeSection[]) {
  assert.deepEqual(sections.map(t => t.commodity).sort(), ['crops', 'goods'], 'Every commercial card retains both distinct trade sections');
  for (const section of sections) {
    assert.equal(new Set(section.keys).size, section.keys.length, 'Trade metrics occur exactly once within their commodity');
    for (const direction of ['buy', 'sell'] as const) {
      const trade = observedCardTrade(city, wallet, section.commodity === 'crops', direction), prefix = direction === 'buy' ? 'purchase' : 'sales', qty = `${section.commodity}-${direction === 'buy' ? 'purchased' : 'sold'}`;
      assert.equal(section.stats[qty]?.value, String(trade.quantity), `${kind} actual ${qty}`);
      assert.equal(section.stats[`${prefix}-cash`]?.value, String(trade.cash), `${kind} ${section.commodity} paired ${prefix} cash`);
      assert.deepEqual(section.stats[`${prefix}-price`], { value: String(trade.unit), status: trade.status }, `${kind} ${section.commodity} paired-journal unit price; missing/fractional values are not invented`);
    }
  }
}
