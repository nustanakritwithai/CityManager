import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketAsync } from '../src/market-async.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('late reads and failures cannot overwrite a newer result or a closed view', async () => {
  const guard = new MarketAsync(), first = deferred<string>(), second = deferred<string>();
  const seen: string[] = [];
  const a = guard.read(() => first.promise, v => seen.push(v), () => seen.push('old error'));
  const b = guard.read(() => second.promise, v => seen.push(v), () => seen.push('new error'));
  second.resolve('new'); await b; first.reject(new Error('late')); await a;
  assert.deepEqual(seen, ['new']);
  const third = deferred<string>();
  const c = guard.read(() => third.promise, v => seen.push(v), () => seen.push('closed error'));
  guard.invalidate(); third.resolve('closed'); await c;
  assert.deepEqual(seen, ['new']);
});

test('writes are serialized and uncertain failures require explicit reconciliation', async () => {
  const guard = new MarketAsync(), operation = deferred<void>();
  let calls = 0;
  const pending = guard.mutate(() => { calls++; return operation.promise; }, () => true);
  assert.equal(guard.isBusy, true);
  await assert.rejects(guard.mutate(async () => { calls++; }, () => true), /market-mutation-blocked/);
  operation.reject(new Error('network')); await assert.rejects(pending, /network/);
  assert.equal(calls, 1);
  assert.equal(guard.needsReconciliation, true);
  await assert.rejects(guard.mutate(async () => { calls++; }, () => true), /market-mutation-blocked/);
  guard.reconciled(); await guard.mutate(async () => { calls++; }, () => true);
  assert.equal(calls, 2);
});

test('a write invalidates reads started before and during it', async () => {
  const guard = new MarketAsync(), read = deferred<string>(), operation = deferred<void>(), during = deferred<string>();
  const seen: string[] = [];
  const before = guard.read(() => read.promise, v => seen.push(v), () => {});
  const write = guard.mutate(() => operation.promise, () => true);
  const concurrent = guard.read(() => during.promise, v => seen.push(v), () => {});
  operation.resolve(); await write;
  read.resolve('before'); during.resolve('during'); await Promise.all([before, concurrent]);
  assert.deepEqual(seen, []);
});
