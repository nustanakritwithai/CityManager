import test from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY, SIZE, buildRoad, createCity, deserialize, isRetail, retailDemand, serialize, shopSite, step, zoneCell, type City, type Zone } from '../src/sim.ts';

/** A strip of homes, farms, factories and commercial parcels along one road from the gateway. */
function strip(withFactories: boolean): City {
  const c = createCity(61025), row = Math.floor(GATEWAY / SIZE);
  assert.ok(buildRoad(c, GATEWAY, GATEWAY + 14).ok);
  for (const dy of [-1, 1]) for (let x = 1; x <= 14; x++) {
    const zone: Zone = x <= 5 ? 'R' : x <= 7 ? 'F' : x <= 9 ? (withFactories ? 'I' : 'R') : x <= 11 ? 'C' : 'R';
    zoneCell(c, (row + dy) * SIZE + x, zone);
  }
  return c;
}
function conserved(c: City) {
  assert.equal(Object.values(c.accounts).reduce((n, v) => n + v, 0), 0);
  assert.equal(c.goods.produced + c.goods.imported - c.goods.consumed - c.goods.exported, c.firms.reduce((n, f) => n + f.inventory, 0));
}

test('a working factory opens outside-funded shops that sell local goods to households, with money and goods conserved', () => {
  const c = strip(true);
  for (let d = 0; d < 180; d++) { step(c); if (d % 30 === 0) conserved(c); }
  const shops = c.firms.filter(isRetail);
  assert.ok(shops.length >= 1, 'at least one shop opened');
  for (const shop of shops) {
    const b = c.buildings.find(b => b.id === shop.building)!;
    assert.equal(b.zone, 'C'); assert.ok(b.level >= 2); assert.equal(shop.owner, null);
    assert.ok(c.ledger.some(e => e.reason === 'Outside firm equity investment' && e.from === 'outside' && e.to === shop.wallet));
    assert.ok((c.tick - b.age) % 3 === 1, 'shops open on their own day of the growth cycle');
  }
  assert.ok(c.goodsLedger.some(e => e.reason === 'Wholesale stock delivery'), 'shops buy from local factories');
  assert.ok(c.goods.consumed > 0, 'households consume finished goods');
  conserved(c); assert.deepEqual(deserialize(serialize(c)), c);
});

test('no factory with workers means no shop demand and no shop', () => {
  const c = strip(false);
  for (let d = 0; d < 120; d++) step(c);
  assert.equal(retailDemand(c), 0);
  assert.equal(c.firms.filter(isRetail).length, 0);
  assert.equal(c.goods.consumed, 0);
});

test('the shop site is the first connected vacant commercial parcel, read without the simulation RNG', () => {
  const c = strip(true), before = c.rng, site = shopSite(c);
  assert.equal(c.rng, before);
  assert.ok(site !== null && c.cells[site].zone === 'C' && c.cells[site].building === null);
  assert.ok(c.cells.every((cell, i) => i >= site! || !(cell.zone === 'C' && cell.building === null)));
});

test('shops show chain bottlenecks on the map: empty shelf, and stock imported because local factories fell short', async () => {
  const { buildingIssues } = await import('../src/map-overlay.ts');
  const { networkEvents, networkSnapshot } = await import('../src/city-network.ts');
  const c = strip(true);
  for (let d = 0; d < 180 && !c.firms.some(f => isRetail(f) && c.employment.some(e => e.firmId === f.id)); d++) step(c);
  const shop = c.firms.find(f => isRetail(f) && c.employment.some(e => e.firmId === f.id))!;
  assert.ok(shop, 'a staffed shop exists');
  const cell = c.buildings.find(b => b.id === shop.building)!.cell;
  const snap = networkSnapshot(c);
  const empty = deserialize(serialize(c)); empty.firms.find(f => f.id === shop.id)!.inventory = 0;
  const issueAt = (city: City) => buildingIssues(city).find(i => i.cell === cell)?.kind;
  assert.equal(issueAt(empty), 'no-stock');
  const imported = deserialize(serialize(c)); imported.firms.find(f => f.id === shop.id)!.inventory = Math.max(1, shop.inventory);
  imported.goodsLedger.push({ tick: imported.tick, from: 'outside', to: shop.wallet, quantity: 5, reason: 'Imported shop stock' });
  assert.equal(issueAt(imported), 'importing');
  imported.tick++;
  imported.goodsLedger.push({ tick: imported.tick, from: 'outside', to: shop.wallet, quantity: 3, reason: 'Imported shop stock' });
  assert.ok(networkEvents(snap, imported).some(e => e.node === 'shops' && e.text.includes('นำเข้า')));
});
