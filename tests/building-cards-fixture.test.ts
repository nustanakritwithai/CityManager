import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { deserialize, isMarket, isRetail, serialize, step, type City, type Firm } from '../src/sim.ts';
import { buildingCardData } from '../src/building-card-data.ts';
import { assertCommercialCardTrades, createBuildingCardsFixture, type CardTradeSection } from './building-cards-fixture.ts';

const replay = createBuildingCardsFixture();
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

registerHooks({ load(url, context, nextLoad) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context); } });
const { renderAgriculture } = await import('../src/context-panels.ts');
class Element {
  children: Element[] = []; dataset: Record<string, string> = {}; className = ''; textContent = '';
  classList = { add: (...names: string[]) => { this.className += ' ' + names.join(' '); } };
  style = { setProperty: (_name: string, _value: string) => undefined };
  append(...children: Element[]) { this.children.push(...children); }
  setAttribute(_name: string, _value: string) {}
  addEventListener(_name: string, _callback: unknown) {}
}

test('building-card acceptance preserves genuine day29/day59 migration snapshots and commercial origins', () => {
  assert.equal(hash(replay.baseline), '17c7548e346e1646106c902e048866b19b9381cc3539c103f9ef20ddae8e01aa');
  assert.equal(hash(serialize(replay.later)), '5e62befe3e6becad5fdd0fd651c59eaef174185288815c3d1941adc768efa8d4');
  assert.equal(deserialize(replay.legacyInput).tick, 29);
  for (const city of [replay.fixture, replay.later]) {
    assert.ok(city.firms.some(isMarket) && city.firms.some(isRetail));
    for (const firm of city.firms.filter(f => f.zone === 'C')) assert.equal(buildingCardData(city, firm.building)?.kind, 'market');
    assert.deepEqual(deserialize(serialize(city)), city);
  }
});

test('shop fixture is a real paid day90 upgrade with unchanged identity and no forged education', () => {
  const before = deserialize(serialize(replay.shopBefore)), retail = before.firms.find(isRetail)!;
  assert.equal(before.tick, 89); assert.equal(before.buildings.find(b => b.id === retail.building)?.level, 3);
  step(before); assert.deepEqual(before, replay.shopCity, 'Exactly one real simulation step produces the complete shop fixture');
  const upgraded = before.firms.find(f => f.id === retail.id)!;
  assert.equal(upgraded.wallet, retail.wallet); assert.equal(upgraded.building, retail.building);
  assert.equal(replay.shopBuilding.level, 4); assert.equal(buildingCardData(before, upgraded.building)?.kind, 'shop');
  assert.ok(before.ledger.some(e => e.tick === 90 && e.from === retail.wallet && e.to === 'construction' && e.amount === 20_000 && e.reason === 'Profitable firm height investment'));
  assert.equal(before.education?.residentBasic, 0); assert.equal(before.education?.residentHigher, 0);
  const kinds = new Set(before.buildings.map(b => buildingCardData(before, b.id)?.kind));
  assert.deepEqual([...kinds].sort(), ['factory', 'farm', 'house', 'market', 'shop']);
  assert.deepEqual(deserialize(serialize(before)), before);
});

test('real owner market and external-investor shop retain distinct owner-section layouts', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
  try {
    for (const [city, firm, expectedOwners] of [
      [replay.fixture, replay.fixture.firms.find(isMarket)!, 1],
      [replay.shopCity, replay.shopCity.firms.find(isRetail)!, 0],
    ] as const) {
      const building = city.buildings.find(b => b.id === firm.building)!;
      const nodes = renderAgriculture(city, building, firm, 0) as unknown as Element[];
      assert.equal(nodes.filter(node => node.className.split(/\s+/).includes('bc-owner-source')).length, expectedOwners);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, 'document');
  }
});

function tradeSections(city: City, firm: Firm): CardTradeSection[] {
  const card = buildingCardData(city, firm.building)!;
  return (['crops', 'goods'] as const).map(commodity => {
    const stats: CardTradeSection['stats'] = {};
    for (const direction of ['Buy', 'Sell'] as const) {
      const trade = card.prices[`${commodity}${direction}`], prefix = direction === 'Buy' ? 'purchase' : 'sales';
      stats[`${commodity}-${direction === 'Buy' ? 'purchased' : 'sold'}`] = { value: String(trade.quantity) };
      stats[`${prefix}-cash`] = { value: String(trade.cashSatang) };
      stats[`${prefix}-price`] = { value: String(trade.unitSatang), status: trade.status };
    }
    return { commodity, stats, keys: Object.keys(stats) };
  });
}

test('all commercial commodities reconcile independently at days29,59,90, including missing and fractional prices', () => {
  for (const city of [replay.fixture, replay.later, replay.shopCity]) for (const firm of city.firms.filter(f => f.zone === 'C')) {
    assertCommercialCardTrades(city, firm.wallet, buildingCardData(city, firm.building)!.kind, tradeSections(city, firm));
  }
  const city = replay.fixture, market = city.firms.find(isMarket)!, sections = tradeSections(city, market);
  assert.equal(sections[0].stats['sales-price'].status, 'non-integer');
  assert.equal(sections[1].stats['sales-price'].status, 'missing');
  const overwritten = structuredClone(sections); overwritten[0].stats['sales-price'] = overwritten[1].stats['sales-price'];
  assert.throws(() => assertCommercialCardTrades(city, market.wallet, 'market', overwritten), /crops paired-journal unit price/);
  assert.throws(() => assertCommercialCardTrades(city, market.wallet, 'market', [sections[0]]), /both distinct trade sections/);
  const duplicate = structuredClone(sections); duplicate[0].keys.push('sales-price');
  assert.throws(() => assertCommercialCardTrades(city, market.wallet, 'market', duplicate), /exactly once/);
});
