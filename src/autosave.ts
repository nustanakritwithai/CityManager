/** Periodic + lifecycle autosave for the local browser save. Pure controller so it can be tested headlessly. */
export const AUTOSAVE_INTERVAL_MS = 60_000;

export type AutosaveResult = { ok: true; at: number } | { ok: false; at: number; quota: boolean; message: string };

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; code?: number; message?: string };
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(e.message ?? '');
}

export interface AutosaveOptions {
  save: () => void | Promise<void>;
  tick: () => number;
  onResult: (result: AutosaveResult) => void;
  now?: () => number;
  canSave?: () => boolean;
}

export function createAutosave(opts: AutosaveOptions) {
  const now = opts.now ?? Date.now;
  let savedTick: number | null = null, running = false, last: AutosaveResult | null = null;
  const finish = (r: AutosaveResult) => { last = r; opts.onResult(r); return r; };
  async function run(force = false): Promise<AutosaveResult | null> {
    if (running || (opts.canSave && !opts.canSave())) return null;
    const tick = opts.tick();
    if (!force && savedTick === tick && last?.ok) return null;
    running = true;
    try { await opts.save(); savedTick = tick; return finish({ ok: true, at: now() }); }
    catch (error) { return finish({ ok: false, at: now(), quota: isQuotaError(error), message: error instanceof Error ? error.message : String(error) }); }
    finally { running = false; }
  }
  return { run, flush() { void run(); }, markSaved(tick: number) { savedTick = tick; last = { ok: true, at: now() }; }, get last() { return last; } };
}

type Listen = { addEventListener(type: string, fn: () => void): void };
export function installAutosave(doc: Listen, win: Listen & { setInterval(fn: () => void, ms: number): unknown }, auto: ReturnType<typeof createAutosave>, isHidden: () => boolean, intervalMs = AUTOSAVE_INTERVAL_MS) {
  win.setInterval(() => { void auto.run(); }, intervalMs);
  doc.addEventListener('visibilitychange', () => { if (isHidden()) auto.flush(); });
  win.addEventListener('pagehide', () => auto.flush());
  win.addEventListener('beforeunload', () => auto.flush());
}

export function describeAutosave(r: AutosaveResult, fmt: (at: number) => string = at => new Date(at).toLocaleTimeString()): string {
  if (r.ok) return `บันทึกอัตโนมัติแล้ว ${fmt(r.at)}`;
  return r.quota
    ? 'บันทึกอัตโนมัติไม่สำเร็จ: พื้นที่เก็บข้อมูลเบราว์เซอร์เต็ม (quota) — ส่งออกเซฟหรือล้างข้อมูลเว็บไซต์ เซฟเดิมยังอยู่'
    : `บันทึกอัตโนมัติไม่สำเร็จ: ${r.message} — เซฟเดิมยังอยู่`;
}
