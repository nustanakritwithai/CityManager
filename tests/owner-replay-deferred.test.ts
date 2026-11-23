import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, serialize, step } from '../src/sim.ts';
import { createOwnerDecisionSession, replayOwnerJournal, type OwnerShadowLoader } from '../src/owner-decision-session.ts';
import { ownerStateHash } from '../src/owner-decision.ts';

/** A stand-in for the game's worker: when told to finish, it builds the shadow as the worker does (deserialize, then a structured clone across the thread boundary). */
function fakeWorker() {
  const asked: { id: number; boundary: string }[] = [];
  let ready: { id: number; built: ReturnType<OwnerShadowLoader['take']> } | null = null;
  const loader: OwnerShadowLoader = { request(id, boundary) { asked.push({ id, boundary }); ready = null; }, take: id => ready?.id === id ? ready.built : null };
  const finish = (failed = false) => {
    const last = asked.at(-1)!, city = deserialize(last.boundary);
    ready = { id: last.id, built: failed ? 'failed' : { city: structuredClone(city), hash: ownerStateHash(city) } };
  };
  return { loader, asked, finish };
}

test('the day-end frame steps the city once; the journal replays the days later, one piece per quiet frame', () => {
  const c = createCity(61025), session = createOwnerDecisionSession(c);
  for (let n = 0; n < 3; n++) session.advance(c);
  assert.equal(session.getStats().pendingTicks, 3);
  // Rebuilding the shadow city from the sealed boundary is one piece; each of the three days is another.
  let pieces = 0; while (session.replayPending()) pieces++;
  assert.equal(pieces, 4);
  assert.equal(session.replayPending(), false, 'nothing left');
  assert.equal(session.getStats().recording, true);
});

test('sealing finishes any replay the quiet frames left, so the month-end journal is the same', () => {
  const quiet = createCity(61025), busy = createCity(61025), a = createOwnerDecisionSession(quiet), b = createOwnerDecisionSession(busy);
  for (let n = 1; n <= 60; n++) {
    a.advance(quiet); b.advance(busy);
    while (b.replayPending()) { /* a frame with time to spare after every day */ }
  }
  assert.equal(serialize(quiet), serialize(busy));
  const ja = a.exportJournal(), jb = b.exportJournal();
  assert.deepEqual(ja.events, jb.events);
  assert.equal(ja.journalHash, jb.journalHash);
  const replay = replayOwnerJournal(JSON.parse(JSON.stringify(ja)));
  assert.equal(replay.ok, true, replay.code); assert.equal(serialize(replay.city!), serialize(quiet));
});

test('a change the journal was not told about is still caught when the days are sealed', () => {
  for (const caughtUp of [false, true]) {
    const c = createCity(61025), session = createOwnerDecisionSession(c);
    session.advance(c); session.advance(c);
    if (caughtUp) while (session.replayPending()) { /* replay done before the change */ }
    c.accounts.treasury += 1;
    session.beforeExternal(c);
    assert.equal(session.getStats().issue, 'unnotified-state-change', caughtUp ? 'replayed first' : 'replayed at the seal');
  }
});

test('a session told about every change seals its days in step with the city', () => {
  const c = createCity(61025), session = createOwnerDecisionSession(c);
  for (let n = 0; n < 5; n++) { session.advance(c); session.replayPending(); }
  session.beforeExternal(c);
  assert.equal(session.getStats().issue, null);
  assert.equal(session.getStats().pendingTicks, 0);
  step(c); // not through the session
  session.beforeExternal(c);
  assert.equal(session.getStats().issue, 'unnotified-state-change');
});

test('with a worker, quiet frames wait for it to rebuild the shadow and then step the days; the journal is the same', () => {
  const plain = createCity(61025), busy = createCity(61025), a = createOwnerDecisionSession(plain), b = createOwnerDecisionSession(busy), w = fakeWorker();
  b.useShadowLoader(w.loader);
  for (let n = 1; n <= 60; n++) {
    a.advance(plain); b.advance(busy);
    const asks = w.asked.length;
    while (b.replayPending()) { /* quiet frames */ }
    if (w.asked.length > asks) {
      assert.equal(b.replayPending(), false, 'waiting for the worker, and asking it only once');
      assert.equal(w.asked.length, asks + 1);
      w.finish(); while (b.replayPending()) { /* the worker delivered */ }
    }
    if (n % 7 === 0) { a.syncExternal(plain, 'player-map-command'); b.syncExternal(busy, 'player-map-command'); }
  }
  assert.ok(w.asked.length >= 8, `one rebuild for each range: ${w.asked.length}`);
  assert.equal(serialize(plain), serialize(busy));
  const ja = a.exportJournal(), jb = b.exportJournal();
  assert.deepEqual(ja.events, jb.events); assert.equal(ja.journalHash, jb.journalHash);
  assert.equal(b.getStats().issue, null);
});

test('a worker that fails or has not finished never stops the journal: the session rebuilds the shadow itself', () => {
  for (const finish of ['failed', 'unfinished'] as const) {
    const c = createCity(61025), session = createOwnerDecisionSession(c), w = fakeWorker();
    session.useShadowLoader(w.loader);
    session.advance(c); session.advance(c);
    assert.equal(session.replayPending(), false); assert.equal(w.asked.length, 1);
    if (finish === 'failed') { w.finish(true); assert.equal(session.replayPending(), true, 'rebuilt here instead'); }
    // Sealing (a player command) never waits for the worker.
    session.beforeExternal(c);
    assert.equal(session.getStats().issue, null, finish); assert.equal(session.getStats().pendingTicks, 0);
    // A tampered city is still caught either way.
    session.advance(c); session.replayPending(); c.accounts.treasury -= 1; session.beforeExternal(c);
    assert.equal(session.getStats().issue, 'unnotified-state-change');
  }
});
