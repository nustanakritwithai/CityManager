/** Loading never writes; original v1/v2 bytes are independent of the v3 slot. */
export const SAVE_KEY = 'citymanager.save.v3';
export const HOUSEHOLD_SAVE_KEY = 'citymanager.save.v2';
export const LEGACY_SAVE_KEY = 'citymanager.save.v1';
export const LEGACY_BACKUP_KEY = 'citymanager.backup.v1';
export const HOUSEHOLD_BACKUP_KEY = 'citymanager.backup.v2';
export const LATEST_BACKUP_KEY = 'citymanager.backup.latest';
const BACKUP_SLOTS = 8;
type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'getItem' | 'setItem'>;
export type SaveSource = 'current' | 'household' | 'legacy' | 'backup';
const backupKey = (version: 1 | 2, i: number) => {
  const base = version === 1 ? LEGACY_BACKUP_KEY : HOUSEHOLD_BACKUP_KEY;
  return i === 0 ? base : `${base}.${i}`;
};
const backupKeys = (version: 1 | 2) => Array.from({ length: BACKUP_SLOTS }, (_, i) => backupKey(version, BACKUP_SLOTS - i - 1));
export function readStoredCity(storage: Reader, source: SaveSource = 'current'): { raw: string; key: string } | null {
  let keys: string[];
  if (source === 'current') keys = [SAVE_KEY, HOUSEHOLD_SAVE_KEY, LEGACY_SAVE_KEY];
  else if (source === 'household') keys = [HOUSEHOLD_SAVE_KEY];
  else if (source === 'legacy') keys = [LEGACY_SAVE_KEY];
  else {
    keys = [...backupKeys(2), ...backupKeys(1)];
    const latest = storage.getItem(LATEST_BACKUP_KEY);
    // Old installations have no pointer. Only accept our bounded backup keys;
    // never let a corrupt metadata value redirect recovery to another slot.
    if (latest !== null && keys.includes(latest)) keys = [latest, ...keys.filter(key => key !== latest)];
  }
  for (const key of keys) { const raw = storage.getItem(key); if (raw !== null) return { raw, key }; }
  return null;
}
export function saveStoredCity(storage: Writer, raw: string, importedLegacy: string | null): { backup: string | null } {
  if (JSON.parse(raw)?.version !== 3) throw new Error('Expected a version 3 snapshot.');
  let backup: string | null = null;
  if (importedLegacy !== null) {
    const version: unknown = JSON.parse(importedLegacy)?.version;
    if (version !== 1 && version !== 2) throw new Error('Expected the original version 1 or 2 snapshot.');
    let available: string | null = null;
    for (let i = 0; i < BACKUP_SLOTS; i++) {
      const key = backupKey(version, i), previous = storage.getItem(key);
      if (previous === importedLegacy) { backup = key; break; }
      if (previous === null && available === null) available = key;
    }
    if (backup === null && available !== null) { storage.setItem(available, importedLegacy); backup = available; }
    if (backup === null) throw new Error('Legacy backup slots are full; the current save was preserved.');
    // A small pointer makes "latest backup" truthful across both old versions.
    // Failure here still aborts before changing the primary save.
    if (storage.getItem(LATEST_BACKUP_KEY) !== backup) storage.setItem(LATEST_BACKUP_KEY, backup);
  }
  // Native setItem is atomic: failed primary writes retain the previous v3
  // bytes, while a successful preceding legacy backup remains recoverable.
  storage.setItem(SAVE_KEY, raw);
  return { backup };
}
