/** Loading never writes; v1 bytes are retained independently of the v2 slot. */
export const SAVE_KEY = 'citymanager.save.v2';
export const LEGACY_SAVE_KEY = 'citymanager.save.v1';
export const LEGACY_BACKUP_KEY = 'citymanager.backup.v1';
const BACKUP_SLOTS = 8;
type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'getItem' | 'setItem'>;
export type SaveSource = 'current' | 'legacy' | 'backup';
const backupKey = (i: number) => i === 0 ? LEGACY_BACKUP_KEY : `${LEGACY_BACKUP_KEY}.${i}`;
export function readStoredCity(storage: Reader, source: SaveSource = 'current'): { raw: string; key: string } | null {
  const keys = source === 'current' ? [SAVE_KEY, LEGACY_SAVE_KEY] : source === 'legacy' ? [LEGACY_SAVE_KEY] : Array.from({ length: BACKUP_SLOTS }, (_, i) => backupKey(BACKUP_SLOTS - i - 1));
  for (const key of keys) { const raw = storage.getItem(key); if (raw !== null) return { raw, key }; }
  return null;
}
export function saveStoredCity(storage: Writer, raw: string, importedLegacy: string | null): { backup: string | null } {
  if (JSON.parse(raw)?.version !== 2) throw new Error('Expected a version 2 snapshot.');
  let backup: string | null = null;
  if (importedLegacy !== null) {
    if (JSON.parse(importedLegacy)?.version !== 1) throw new Error('Expected the original version 1 snapshot.');
    for (let i = 0; i < BACKUP_SLOTS; i++) {
      const key = backupKey(i), previous = storage.getItem(key);
      if (previous === importedLegacy) { backup = key; break; }
      if (previous === null) { storage.setItem(key, importedLegacy); backup = key; break; }
    }
    if (backup === null) throw new Error('Legacy backup slots are full; the current save was preserved.');
  }
  // Native setItem is atomic: failed primary writes retain the previous v2
  // bytes, while a successful preceding legacy backup remains recoverable.
  storage.setItem(SAVE_KEY, raw);
  return { backup };
}
