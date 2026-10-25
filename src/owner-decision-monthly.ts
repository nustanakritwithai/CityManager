import { MONTH, type City } from './sim.ts';
import type { OwnerDecisionMode } from './owner-decision-session.ts';

export type OwnerMonthlyBatchStatus = 'idle' | 'running' | 'paused' | 'complete' | 'stale';
export type OwnerMonthlyStepResult = 'completed' | 'skipped' | 'cancelled' | 'retry' | 'stale';
export type OwnerMonthlyBatchState = {
  status: OwnerMonthlyBatchStatus;
  tick: number | null;
  firmIds: number[];
  completedFirmIds: number[];
  nextFirmId: number | null;
  total: number;
};

type Context = { city: City; mode: OwnerDecisionMode };
type Batch = { city: City; tick: number; firmIds: number[]; cursor: number; status: Exclude<OwnerMonthlyBatchStatus, 'idle'> };
type Options = {
  getContext(): Context;
  getFirmIds(city: City): number[];
  processFirm(city: City, firmId: number, controller: AbortController): Promise<OwnerMonthlyStepResult>;
  onChange?(state: OwnerMonthlyBatchState): void;
};

/** Sequential, same-month Typhoon work. Progress is session-local and never changes the saved city format. */
export function createOwnerMonthlyBatch(options: Options) {
  let batch: Batch | null = null;
  let generation = 0;
  let activeController: AbortController | null = null;
  let running: Promise<OwnerMonthlyBatchState> | null = null;

  const snapshot = (): OwnerMonthlyBatchState => batch ? {
    status: batch.status,
    tick: batch.tick,
    firmIds: [...batch.firmIds],
    completedFirmIds: batch.firmIds.slice(0, batch.cursor),
    nextFirmId: batch.firmIds[batch.cursor] ?? null,
    total: batch.firmIds.length,
  } : { status: 'idle', tick: null, firmIds: [], completedFirmIds: [], nextFirmId: null, total: 0 };
  const emit = () => options.onChange?.(snapshot());

  function cancel(): void {
    if (!batch || batch.status !== 'running') return;
    generation++;
    activeController?.abort(); activeController = null; running = null;
    batch.status = 'paused'; emit();
  }

  function reset(): void {
    generation++;
    activeController?.abort(); activeController = null; running = null; batch = null;
    emit();
  }

  function invalidate(): void {
    if (!batch || batch.status === 'stale') return;
    generation++;
    activeController?.abort(); activeController = null; running = null;
    batch.status = 'stale'; emit();
  }

  async function start(): Promise<OwnerMonthlyBatchState> {
    const context = options.getContext();
    if (context.mode !== 'typhoon-auto' || context.city.tick <= 0 || context.city.tick % MONTH !== 0) return snapshot();
    if (batch?.status === 'running' && batch.city === context.city && batch.tick === context.city.tick) return running ?? snapshot();
    if (batch && batch.city === context.city && batch.tick === context.city.tick) {
      if (batch.status === 'complete' || batch.status === 'stale') return snapshot();
    } else {
      if (batch?.status === 'running') { generation++; activeController?.abort(); activeController = null; }
      const firmIds = [...new Set(options.getFirmIds(context.city))]
        .filter(id => Number.isSafeInteger(id) && id > 0)
        .sort((left, right) => left - right);
      batch = { city: context.city, tick: context.city.tick, firmIds, cursor: 0, status: 'paused' };
    }

    if (!batch.firmIds.length) { batch.status = 'complete'; emit(); return snapshot(); }
    const target = batch, runGeneration = ++generation;
    target.status = 'running'; emit();
    const task = (async (): Promise<OwnerMonthlyBatchState> => {
      while (target.cursor < target.firmIds.length) {
        if (runGeneration !== generation) return snapshot();
        const before = options.getContext();
        if (before.city !== target.city || before.city.tick !== target.tick) {
          target.status = 'stale'; running = null; emit(); return snapshot();
        }
        if (before.mode !== 'typhoon-auto') {
          target.status = 'paused'; running = null; emit(); return snapshot();
        }

        const controller = new AbortController(); activeController = controller;
        let result: OwnerMonthlyStepResult;
        try { result = await options.processFirm(target.city, target.firmIds[target.cursor], controller); }
        catch { result = 'retry'; }
        if (runGeneration !== generation || controller.signal.aborted) return snapshot();
        activeController = null;

        const after = options.getContext();
        if (after.city !== target.city || after.city.tick !== target.tick || result === 'stale') {
          target.status = 'stale'; running = null; emit(); return snapshot();
        }
        if (after.mode !== 'typhoon-auto' || result === 'cancelled' || result === 'retry') {
          target.status = 'paused'; running = null; emit(); return snapshot();
        }
        target.cursor++;
        emit();
      }
      target.status = 'complete'; running = null; emit(); return snapshot();
    })();
    running = task;
    return task;
  }

  return { start, cancel, reset, invalidate, getState: snapshot };
}
