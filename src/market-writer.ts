/** A cross-tab writer guard for one browser origin. It does not authenticate a Guest. */
export interface MarketWriterLocks {
  request<T>(name: string, options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => Promise<T>): Promise<T>;
}

/**
 * Hold the lock across the entire mutation and its durable journal update.
 * A stale tab must reload/reconcile instead of overwriting another tab's journal.
 * The caller must use this guard for every mutation of the shared journal.
 */
export async function withMarketWriter<T>(options: {
  locks: MarketWriterLocks | undefined;
  expectedJournal: string | null;
  readJournal: () => string | null;
  work: () => Promise<T>;
}): Promise<T> {
  if (!options.locks) throw new Error('market-writer-lock-unavailable');
  return options.locks.request('citymanager-market-writer', { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw new Error('market-writer-busy');
    if (options.readJournal() !== options.expectedJournal) throw new Error('market-state-changed-reload');
    return options.work();
  });
}
