import { SAVE_KEY } from './save-storage.ts';
import { RESUME_CHOICE_KEY } from './save-choice.ts';
/** CityManager-only data. Strategy-Game shares this origin, so never touch other keys or databases. */
export const CITY_SAVE_KEY_PATTERN = /^citymanager\.(save\.|backup\.|checkpoint\.)/;
export const CITY_RECOVERY_DB = 'citymanager.emergency-recovery-v1';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
/** Keys removed by "delete old saves": every CityManager save slot except the kept primary, plus the resume hint. */
export function oldSaveKeys(storage: Store): string[] {
  const out: string[] = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k !== SAVE_KEY && CITY_SAVE_KEY_PATTERN.test(k)) out.push(k); }
  if (storage.getItem(RESUME_CHOICE_KEY) !== null) out.push(RESUME_CHOICE_KEY);
  return out;
}
function deleteDb(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = factory.deleteDatabase(name); const t = setTimeout(() => reject(Error('ลบสำเนากู้คืนไม่สำเร็จ (หมดเวลา) · ข้อมูลยังอยู่')), 10_000);
    r.onsuccess = () => { clearTimeout(t); resolve(); };
    r.onerror = () => { clearTimeout(t); reject(r.error ?? Error('ลบสำเนากู้คืนไม่สำเร็จ · ข้อมูลยังอยู่')); };
    r.onblocked = () => { clearTimeout(t); reject(Error('ปิดแท็บ CityManager อื่นก่อน แล้วลองใหม่ · ข้อมูลยังอยู่')); };
  });
}
/** Keep exactly `keepRaw` as the primary save; delete every other CityManager save copy.
 * Order is safe: the kept city is written and verified BEFORE anything is deleted. */
export async function deleteOldSaves(keepRaw: string, storage: Store = localStorage, factory: IDBFactory | undefined = globalThis.indexedDB): Promise<{ removed: string[] }> {
  if (!keepRaw) throw Error('เลือกเมืองที่จะเก็บไว้ก่อน');
  JSON.parse(keepRaw);
  storage.setItem(SAVE_KEY, keepRaw);
  if (storage.getItem(SAVE_KEY) !== keepRaw) throw Error('บันทึกเมืองที่เลือกไม่สำเร็จ · ยังไม่ได้ลบอะไร');
  if (factory) await deleteDb(factory, CITY_RECOVERY_DB);
  const removed = oldSaveKeys(storage); for (const k of removed) storage.removeItem(k);
  return { removed };
}
