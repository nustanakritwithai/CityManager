import { deserialize } from '../src/sim.ts';

/** Validate the save, but return its raw journal representation for read-only checks. */
export function browserSnapshotState(raw: string) {
  deserialize(raw); // Validation only: its migrated/compacted result must not mask changes.
  const value = JSON.parse(raw);
  delete value.commercialBaseVersion; delete value.historyBaseVersion; delete value.mapBaseVersion; delete value.mapLayout;
  value.version = 9; value.rulesVersion = 'chain-4';
  return value;
}
