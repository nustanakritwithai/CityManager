/**
 * Rebuilds the owner journal's shadow city from its sealed boundary bytes off the main thread. It is the same
 * validating deserialize the journal runs itself; the game only receives the finished city (a structured clone),
 * so the long save check no longer pauses a frame after every player command.
 */
import { deserialize } from './sim.ts';
import { ownerStateHash } from './owner-decision.ts';

self.addEventListener('message', (event: MessageEvent<{ id: number; boundary: string }>) => {
  const { id, boundary } = event.data;
  try {
    const city = deserialize(boundary);
    self.postMessage({ id, city, hash: ownerStateHash(city) });
  } catch { self.postMessage({ id, failed: true }); }
});
