import { access, type City } from '../src/sim.ts';
import { emptyCrops, emptyProducts } from '../src/goods.ts';
import { populationFixture } from './population-capacity-fixture.ts';

/** Synthetic reconciled starting city, not natural growth or mobile performance evidence.
 * Every business has a unique one-cell premise and explicit historical outside capital. */
export function businessFixture(firms = 64, households = 96): City {
  const c = populationFixture(households, false, false);
  if (!households) { for (const b of c.buildings) c.cells[b.cell] = { road: false, zone: null, building: null }; c.buildings = []; }
  const sites = c.cells.flatMap((cell, i) => !cell.road && cell.building === null && access(c, i) ? [i] : []);
  for (let n = 0; n < firms; n++) {
    const bid = c.nextId++, id = c.nextId++, cell = sites.shift()!, wallet = `firm:${id}`;
    c.cells[cell] = { road: false, zone: 'I', building: bid };
    c.buildings.push({ id: bid, cell, zone: 'I', level: 1, age: c.tick });
    c.firms.push({ id, building: bid, zone: 'I', recipe: 'rice-mill', wallet, crops: emptyCrops(), products: emptyProducts(), workDays: {}, inventory: 0, cropInventory: 0, cropCost: 0, productionTick: 0, owner: null, profit: 0, lastMonthProfit: 0, monthlyRevenue: 0, monthlyExpense: 0 });
    c.accounts[wallet] = 1_000_000; c.accounts.outside -= 1_000_000;
    c.ledger.push({ tick: 0, from: 'outside', to: wallet, amount: 1_000_000, reason: 'Fixture historical business capital' });
  }
  if (firms > 64) c.businessCapacityVersion = 1;
  // Synthetic historical funding predates the unified commercial rules.
  c.commercialUnifiedStartTick=c.tick;
  c.commercialUnifiedBaseline={moneyEntries:c.ledger.length,cropEntries:c.cropLedger.length,goodsEntries:c.goodsLedger.length};
  return c;
}
export const vacantSite = (c: City) => c.cells.findIndex((cell, i) => !cell.road && cell.zone === null && cell.building === null && access(c, i));

/** Representative mix with actual production, imports, sales and stocks during replay. */
export function mixedBusinessFixture(): City {
  const c = businessFixture(128);
  for (const [index, f] of c.firms.slice(0, 24).entries()) {
    const b = c.buildings.find(b => b.id === f.building)!;
    f.zone = index < 12 ? 'F' : 'C'; b.zone = f.zone; c.cells[b.cell].zone = f.zone; delete f.recipe;
    if (f.zone === 'C') { f.commercialKind = 'retail'; b.level = 2; }
  }
  return c;
}
