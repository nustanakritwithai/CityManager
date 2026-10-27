/** Loading never writes; original v1-v6 bytes are independent of the v7 slot. */
export const SAVE_KEY = 'citymanager.save.v7';
export const GROWTH_SAVE_KEY = 'citymanager.save.v6';
export const COMMERCIAL_SAVE_KEY = 'citymanager.save.v5';
export const AGRICULTURE_SAVE_KEY = 'citymanager.save.v4';
export const WORKER_SAVE_KEY = 'citymanager.save.v3';
export const HOUSEHOLD_SAVE_KEY = 'citymanager.save.v2';
export const LEGACY_SAVE_KEY = 'citymanager.save.v1';
export const LEGACY_BACKUP_KEY = 'citymanager.backup.v1';
export const HOUSEHOLD_BACKUP_KEY = 'citymanager.backup.v2';
export const WORKER_BACKUP_KEY = 'citymanager.backup.v3';
export const AGRICULTURE_BACKUP_KEY = 'citymanager.backup.v4';
export const COMMERCIAL_BACKUP_KEY = 'citymanager.backup.v5';
export const GROWTH_BACKUP_KEY = 'citymanager.backup.v6';
export const LATEST_BACKUP_KEY = 'citymanager.backup.latest';
/** The 1.x (v7 / chain-2) bytes in the main slot, copied once before the first v8 write replaces them. */
export const CHAIN2_BACKUP_KEY = 'citymanager.backup.chain-2';
/** The 2.0 (v8 / chain-3) bytes in the main slot, copied once before the first v9 write replaces them. */
export const CHAIN3_BACKUP_KEY = 'citymanager.backup.chain-3';
const BACKUP_SLOTS = 8;
type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'getItem' | 'setItem'>;
export type SaveSource = 'current' | 'growth' | 'commercial' | 'agriculture' | 'worker' | 'household' | 'legacy' | 'backup';
const backupKey = (version: 1 | 2 | 3 | 4 | 5 | 6, i: number) => {
  const base = version === 1 ? LEGACY_BACKUP_KEY : version === 2 ? HOUSEHOLD_BACKUP_KEY : version === 3 ? WORKER_BACKUP_KEY : version === 4 ? AGRICULTURE_BACKUP_KEY : version === 5 ? COMMERCIAL_BACKUP_KEY : GROWTH_BACKUP_KEY;
  return i === 0 ? base : `${base}.${i}`;
};
const backupKeys = (version: 1 | 2 | 3 | 4 | 5 | 6) => Array.from({ length: BACKUP_SLOTS }, (_, i) => backupKey(version, BACKUP_SLOTS - i - 1));
export function readStoredCity(storage: Reader, source: SaveSource = 'current'): { raw: string; key: string } | null {
  let keys: string[];
  if (source === 'current') keys = [SAVE_KEY, GROWTH_SAVE_KEY, COMMERCIAL_SAVE_KEY, AGRICULTURE_SAVE_KEY, WORKER_SAVE_KEY, HOUSEHOLD_SAVE_KEY, LEGACY_SAVE_KEY];
  else if (source === 'growth') keys = [GROWTH_SAVE_KEY];
  else if (source === 'commercial') keys = [COMMERCIAL_SAVE_KEY];
  else if (source === 'agriculture') keys = [AGRICULTURE_SAVE_KEY];
  else if (source === 'worker') keys = [WORKER_SAVE_KEY];
  else if (source === 'household') keys = [HOUSEHOLD_SAVE_KEY];
  else if (source === 'legacy') keys = [LEGACY_SAVE_KEY];
  else {
    keys = [...backupKeys(6), ...backupKeys(5), ...backupKeys(4), ...backupKeys(3), ...backupKeys(2), ...backupKeys(1), CHAIN2_BACKUP_KEY, CHAIN3_BACKUP_KEY];
    const latest = storage.getItem(LATEST_BACKUP_KEY);
    // Old installations have no pointer. Only accept our bounded backup keys;
    // never let a corrupt metadata value redirect recovery to another slot.
    if (latest !== null && keys.includes(latest)) keys = [latest, ...keys.filter(key => key !== latest)];
  }
  for (const key of keys) { const raw = storage.getItem(key); if (raw !== null) return { raw, key }; }
  return null;
}
export function saveStoredCity(storage: Writer, raw: string, importedLegacy: string | null): { backup: string | null } {
  if (![9, 10].includes(JSON.parse(raw)?.version)) throw new Error('Expected a version 9 or market version 10 snapshot.');
  let backup: string | null = null;
  if (importedLegacy !== null) {
    const version: unknown = JSON.parse(importedLegacy)?.version;
    if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6) throw new Error('Expected the original version 1, 2, 3, 4, 5 or 6 snapshot.');
    let available: string | null = null;
    for (let i = 0; i < BACKUP_SLOTS; i++) {
      const key = backupKey(version, i), previous = storage.getItem(key);
      if (previous === importedLegacy) { backup = key; break; }
      if (previous === null && available === null) available = key;
    }
    if (backup === null && available !== null) { storage.setItem(available, importedLegacy); backup = available; }
    if (backup === null) throw new Error('Legacy backup slots are full; the current save was preserved.');
    // A small pointer makes "latest backup" truthful across all old versions.
    // Failure here still aborts before changing the primary save.
    if (storage.getItem(LATEST_BACKUP_KEY) !== backup) storage.setItem(LATEST_BACKUP_KEY, backup);
  }
  // The slot keeps its v7 name; an older chain's save there is kept once, untouched, before v9 replaces it.
  const current = storage.getItem(SAVE_KEY);
  if (current !== null) {
    let version: unknown; try { version = JSON.parse(current)?.version; } catch { version = undefined; }
    if (version === 7 && storage.getItem(CHAIN2_BACKUP_KEY) === null) storage.setItem(CHAIN2_BACKUP_KEY, current);
    if (version === 8 && storage.getItem(CHAIN3_BACKUP_KEY) === null) storage.setItem(CHAIN3_BACKUP_KEY, current);
  }
  // Native setItem is atomic: failed primary writes retain the previous bytes,
  // while a successful preceding backup remains recoverable.
  storage.setItem(SAVE_KEY, raw);
  return { backup };
}
