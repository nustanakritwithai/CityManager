import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketClient } from '../src/market-client.ts';
import { createCity } from '../src/sim.ts';

test('returning session preserves saved sequence, operations and receipt', () => {
  const city = createCity(1, { starter: false }); const client = new MarketClient(() => city, 'http://127.0.0.1:4317');
  client.guestId = '00000000-0000-4000-8000-000000000003'; client.journal.guestId = client.guestId; client.journal.seq = '4';
  client.journal.receipts['00000000-0000-4000-8000-000000000004'] = { claimId: '00000000-0000-4000-8000-000000000005', state: 'applied' };
  const before = JSON.stringify(client.journal); client.acceptSession({ guest_id: client.guestId, seq: '8' }); assert.equal(JSON.stringify(client.journal), before);
  assert.throws(() => client.acceptSession({ guest_id: '00000000-0000-4000-8000-000000000006', seq: '8' }), /mismatch/); assert.equal(JSON.stringify(client.journal), before);
});

test('entry reconciliation rejects rollback and unexplained sequence advance without changing journal', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), store = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  try { const client = new MarketClient(() => createCity(1, { starter: false }), 'http://127.0.0.1:4317'); client.guestId = '00000000-0000-4000-8000-000000000003'; client.journal.guestId = client.guestId; client.journal.seq = '4';
    const before = JSON.stringify(client.journal); await assert.rejects(client.reconcileSession({ guest_id: client.guestId, seq: '3' }), /rollback/); await assert.rejects(client.reconcileSession({ guest_id: client.guestId, seq: '5' }), /gap/); assert.equal(JSON.stringify(client.journal), before);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
