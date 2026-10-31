# Bounded simulation history

Save v24 (`chain-19`) wraps the existing v19–v23 city rules and a versioned history checkpoint. Old saves are validated under their original rules before migration. No account balance, asset, inventory, RNG state, active claim, park session, or embedded market journal is deleted or recomputed as a new entitlement.

- Exact transaction detail covers the current and previous accounting months (30–59 days after the first checkpoint). This supports 30-day paired price statistics, current settlement ordering, and the previous month's profit validation.
- A closed-month checkpoint seeds subsequent cash, stock, cost, typed-goods, and owner-finance replay. Crop IDs and recipe-choice offsets remain monotonic. Sparse original construction/funding evidence is retained only while relevant to assets or obligations.
- Older simulation details are discarded, not hidden in an unbounded archive. Lifetime quantities/counts and owner development reserves are cumulative sufficient statistics. Charts keep at most 90 daily summary bins, and three-month city goals use four fixed month-end balance points. Longer chart requests disclose the retained range rather than inventing zeros.
- Compaction occurs on validated load and at a stable completed-day boundary. Repeated compaction is idempotent. Audio and network event cursors use absolute sequence positions.
- The existing service remains limited to 8 MiB of UTF-8 city JSON. Client preflight rejects larger payloads before creating a pending mutation; it does not truncate data or report a successful save.
- Entry uses only the authenticated server head. Obsolete browser-only city copies are not inventoried, archived, or activated and cannot block an existing server city. Separate remembered Guest identity is preserved. Missing/deleted heads require an explicit fresh-city action; tombstones never resurrect a local copy.

The server-only ACK, CAS, owner binding, and stable-key retry contracts are unchanged. Exported recovery files are not automatically imported over a current server city. A user's older export requires an explicit recovery choice, not selection by largest tick or file size.

Focused acceptance covers generated oversized legacy input, exact state/conservation invariants, bounded repeated runtime checkpoints, old-format server-save migration, malformed checkpoints, financial reserves, crop/goods replay, city goals/charts, save preflight and server-only entry. Private player exports are not fixtures or repository artifacts.
