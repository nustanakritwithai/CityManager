import assert from 'node:assert/strict';
import type { City } from '../src/sim.ts';

/** Independently replay the pre-checkpoint rows of a genuine, uncompressed legacy fixture. */
export function assertLegacyCheckpoint(loaded: City, raw: any): void {
  const history = loaded.history!;
  assert.ok(history, 'legacy history was compacted into a checkpoint');
  const money = raw.ledger.filter((e: any) => e.tick <= history.throughTick);
  const goods = raw.goodsLedger.filter((e: any) => e.tick <= history.throughTick);
  const crops = raw.cropLedger.filter((e: any) => e.tick <= history.throughTick);
  const accounts: Record<string, number> = {}, goodsBalances: Record<string, number> = {};
  const transfer = (balances: Record<string, number>, from: string, to: string, amount: number) => {
    balances[from] = (balances[from] ?? 0) - amount;
    balances[to] = (balances[to] ?? 0) + amount;
  };
  for (const e of money) transfer(accounts, e.from, e.to, e.amount);
  for (const e of goods) transfer(goodsBalances, e.from, e.to, e.quantity);
  for (const balances of [accounts, goodsBalances]) for (const key of Object.keys(balances)) if (balances[key] === 0) delete balances[key];
  assert.deepEqual(history.accounts, accounts, 'checkpoint balances match original money transfers');
  assert.deepEqual(history.goodsBalances, goodsBalances, 'checkpoint goods balances match original transfers');
  assert.deepEqual(history.totals, {
    moneyCount: money.length, moneyAmount: money.reduce((n: number, e: any) => n + e.amount, 0),
    cropCount: crops.length, cropQuantity: crops.reduce((n: number, e: any) => n + e.quantity, 0),
    goodsCount: goods.length, goodsQuantity: goods.reduce((n: number, e: any) => n + e.quantity, 0),
  }, 'checkpoint counts and amounts match original rows');
  const sum = (rows: any[], predicate: (e: any) => boolean) => rows.filter(predicate).reduce((n: number, e: any) => n + e.quantity, 0);
  assert.deepEqual(history.goodsTotals, {
    produced: sum(goods, e => e.from === 'production'), imported: sum(goods, e => e.from === 'outside'),
    consumed: sum(goods, e => e.to.startsWith('household:')), exported: sum(goods, e => e.to === 'outside'),
  });
  assert.deepEqual(history.cropTotals, {
    harvested: sum(crops, e => e.kind === 'harvest'), processed: sum(crops, e => e.kind === 'process'),
    consumed: sum(crops, e => e.kind === 'consumption'), writtenOff: sum(crops, e => e.kind === 'writeoff'),
    exported: sum(crops, e => e.kind === 'export'),
  });
}
