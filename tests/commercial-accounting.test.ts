import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserialize, serialize, step, isMarket, type City } from '../src/sim.ts';
import { validateAgriculture } from '../src/agriculture-validation.ts';
import { validateTypes } from '../src/goods-validation.ts';
import { createParkRuntime, deserializeParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { cropJournalLength } from '../src/city-history.ts';

const source = readFileSync(new URL('./fixtures/retail-v15.json', import.meta.url), 'utf8');
const old = () => deserialize(source);
const check = (c: City) => { validateAgriculture(c, true, true); validateTypes(c); };
const expectBad = (c: City, mutate: (x: City) => void) => {
  const bad = structuredClone(c); mutate(bad); const before = JSON.stringify(bad);
  assert.throws(() => check(bad)); assert.equal(JSON.stringify(bad), before, 'validation must not repair or write off');
};

test('old city migrates only after validation, preserving firms, ledgers and funds across v25 and session roundtrips', () => {
  const c = old(), before = JSON.stringify(c), raw = serialize(c);
  assert.equal(c.commercialUnifiedStartTick, c.tick);
  assert.equal(JSON.parse(raw).version, 25);
  assert.equal(serialize(deserialize(raw)), raw);
  const restored = deserializeParkSession(serializeParkSession(c, createParkRuntime(c)));
  assert.equal(JSON.stringify(restored.city), before);
  assert.equal(JSON.stringify(c), before);
  const corrupt = JSON.parse(source); corrupt.accounts.treasury++;
  assert.throws(() => deserialize(JSON.stringify(corrupt)), /corrupt/i);
});

test('legacy market preserves ownership and reconciles wages plus both stocks through compaction and reload', () => {
  let c = old(); const id = c.firms.find(isMarket)!.id, start = c.commercialUnifiedStartTick!;
  let both = false, wages = false;
  for (let i = 0; i < 180; i++) {
    step(c); check(c);
    const firm = c.firms.find(f => f.id === id);
    if (firm) {
      both ||= firm.cropInventory > 0 && firm.inventory > 0;
      wages ||= c.ledger.some(e => e.tick > start && e.from === firm.wallet && e.reason === 'Monthly wages');
    }
    if (c.tick % 30 === 0) { const raw = serialize(c); assert.equal(serialize(deserialize(raw)), raw); c = deserialize(raw); }
  }
  assert.ok(both, 'same business holds crops and finished goods');
  assert.ok(wages, 'legacy owner business may hire and actually pay');
  assert.ok((c.history?.throughTick ?? 0) > start, 'compaction passed the unified boundary');
  const firm = c.firms.find(f => f.id === id)!;
  assert.equal(firm.commercialKind, 'market'); assert.ok(firm.owner);
  for (const mutate of [
    (x: City) => { x.firms.find(f => f.id === id)!.cropCost++; },
    (x: City) => { x.firms.find(f => f.id === id)!.profit++; },
    (x: City) => { x.firms.find(f => f.id === id)!.owner!.withdrawn++; },
    (x: City) => { x.history!.ownerProfit[firm.wallet].profit++; },
  ]) expectBad(c, mutate);
});

test('post-boundary forged principal withdrawal is rejected without state mutation', () => {
  const c = old(); step(c); const f = c.firms.find(isMarket)!, amount = 30_000;
  assert.ok(c.accounts[f.wallet] - amount >= 20_000);
  expectBad(c, x => {
    const firm = x.firms.find(t => t.id === f.id)!, h = `household:${firm.owner!.householdId}`;
    x.accounts[firm.wallet] -= amount; x.accounts[h] += amount; firm.owner!.withdrawn += amount;
    x.ledger.push({ tick:x.tick, from:firm.wallet, to:h, amount, reason:'Owner profit distribution' });
  });
});


test('same-tick post-migration crop receipt uses journal boundary, not tick alone', () => {
  const c = old(), shop = c.firms.find(f => f.commercialKind === 'retail' && f.productionTick < c.tick)!;
  assert.ok(shop, 'a paused or unserved firm can receive without a production attempt');
  const id = cropJournalLength(c) + 1;
  shop.cropInventory++; shop.crops.rice++;
  c.cropLedger.push({id,tick:c.tick,kind:'market-receipt',from:'market-server',to:shop.wallet,quantity:1,fromValue:0,toValue:0,cash:0,workers:0,batches:0,outputQuantity:0,reason:`Market receipt #${id}`,crop:'rice'});
  check(c);
  const raw = serialize(c); assert.equal(serialize(deserialize(raw)), raw);
  expectBad(c, bad => { bad.commercialUnifiedBaseline!.cropEntries++; });
});

test('post-boundary retail income must match an actual goods basket', () => {
  const c = old(); step(c); const f = c.firms.find(isMarket)!, buyer = c.households[0].wallet;
  expectBad(c, bad => {
    bad.accounts[buyer] -= 800; bad.accounts[f.wallet] += 800;
    bad.ledger.push({tick:bad.tick,from:buyer,to:f.wallet,amount:800,reason:`Household #${buyer.slice(10)} purchase`});
    bad.firms.find(t => t.id === f.id)!.monthlyRevenue += 800;
  });
});

test('post-boundary draw cannot consume known tax or development reserve', () => {
  const c = old(); step(c); const f = c.firms.find(isMarket)!, amount = 1_000;
  const knownNet = f.profit + f.monthlyRevenue - f.monthlyExpense - f.owner!.taxPaid - f.owner!.withdrawn;
  assert.ok(knownNet > amount && c.accounts[f.wallet] - amount > 20_000, 'test exceeds neither gross earnings nor bare cash floor');
  expectBad(c, x => {
    const firm = x.firms.find(t => t.id === f.id)!, h = `household:${firm.owner!.householdId}`;
    x.accounts[firm.wallet] -= amount; x.accounts[h] += amount; firm.owner!.withdrawn += amount;
    x.ledger.push({tick:x.tick, from:firm.wallet, to:h, amount, reason:'Owner profit distribution'});
  });
});

test('compensated impossible commercial wage is rejected even when all balances and owner totals reconcile',()=>{
  const c=old();while(c.tick<151)step(c);
  const wage=c.ledger.find(e=>e.tick===150&&e.reason==='Monthly wages'&&c.firms.some(f=>f.wallet===e.from&&f.zone==='C'))!;
  assert.ok(wage);assert.equal(wage.amount%1400,0);assert.doesNotThrow(()=>deserialize(serialize(c)));
  const bad=structuredClone(c),w=bad.ledger.find(e=>e.tick===wage.tick&&e.from===wage.from&&e.to===wage.to&&e.reason==='Monthly wages')!;
  const draw=bad.ledger.find(e=>e.tick===150&&e.from===w.from&&e.reason==='Owner profit distribution')!,f=bad.firms.find(f=>f.wallet===w.from)!;
  assert.ok(draw&&f.owner);w.amount++;draw.amount--;bad.accounts[w.to]++;bad.accounts[draw.to]--;f.profit--;f.lastMonthProfit--;f.owner!.withdrawn--;
  const before=JSON.stringify(bad);assert.throws(()=>deserialize(serialize(bad)),/agriculture/);assert.equal(JSON.stringify(bad),before);
});

test('commercial wage cannot be redirected to a non-household account with balanced entries',()=>{
  const c=old();while(c.tick<151)step(c);
  expectBad(c,bad=>{
    const wage=bad.ledger.find(e=>e.tick===150&&e.reason==='Monthly wages'&&bad.firms.some(f=>f.wallet===e.from&&f.zone==='C'))!;
    assert.ok(wage);bad.accounts[wage.to]-=wage.amount;bad.accounts.treasury+=wage.amount;wage.to='treasury';
  });
});
