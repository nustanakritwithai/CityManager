# Business capacity (v23 / chain-18)

## Bounded current-map policy

The legacy 64-business ceiling no longer blocks a city at its 65th business.
`MAX_CITY_BUILDINGS = 192` remains unchanged on the 24×24 map;
`MAX_CITY_FIRMS = MAX_CITY_BUILDINGS`. Each business occupies exactly one
nonresidential building on a unique cell. Homes and businesses share the 192
zoned-building budget, so a city with homes has fewer than 192 possible business
premises. Roads, utilities, parks and campuses still occupy their existing cells
and retain their own validation and limits. This is not an unlimited-city or
larger-map change.

Normal zoned development, automatic retail opening, save validation and the UI
use the same bound. Demand, reachable roads, available utilities, safe entity IDs,
owner labour, construction payments, capital and upgrade rules are unchanged.
No population, workers, stock or money is added by loading a save.

## Compatibility and recovery

- v1–v22 retain their historical 64-firm and 64-owner-allocation validation.
  Existing legacy import/migration remains unchanged.
- A city crosses to **v23 / `chain-18` / `businessCapacityVersion: 1`** on its
  65th business. Serialization also selects v23 for an expanded in-memory city.
  The marker remains after closures, preventing an accidental format downgrade.
- At 64 or fewer businesses, a city that has never expanded keeps its existing
  v19–v22 envelope and bytes; opening a city does not write or migrate storage.
- v23 wraps the existing optional education, expanded-population, road-topology,
  park-runtime and market-journal state. It is specifically the business-capacity
  format, not the parked experimental citizen-transport format. Missing/mismatched
  capacity markers, mismatched rules and unknown/future versions are rejected.
- One firm per nonresidential building, unique cells and entity IDs, safe `nextId`,
  housing/workforce bounds, all ledger and stock reconciliation, and the 12 MB
  journal limit remain enforced. The owner-allocation bound grows to 192 only
  inside the validated v23 envelope; existing per-household worker limits remain.
- Before replacing a v9–v22 primary with v23, Save stores the **exact prior bytes**
  in `citymanager.backup.before-business-capacity` or `.1` through `.7`. An exact
  existing copy is reused. Slots are never overwritten. Full slots or a required
  backup quota failure abort before the guarded primary/checkpoint commit.
  v1–v8 keep their existing original-format backups. New backups are available
  through the existing recovery selector.
- Startup, explicit Load, offline local Save, automatic checkpoint/recovery and
  Guest identity lookup support v23. Guest identity, sequence, receipts and pending
  financial state are neither regenerated nor rebound by this change. The existing
  stale-tab, async-generation and old-version overwrite guards are unchanged.

## Focused validation

`tests/business-capacity.test.ts` covers normal 64→65 farm construction and
household-funded automatic retail, 128-firm deterministic replay through payroll,
65 owner allocations, the shared 192-building ceiling, safe-ID exhaustion,
duplicate IDs/cells/premises, malformed money/stock, every combination of
education/population/road envelopes, v1/v5/v22 read-only startup, v23 local-session
and recovery paths, and full/quota backup failures. Entry-gate and Pages-auth unit
tests use **mocked** authentication and verify that a v23 Guest cannot be replaced.

The representative 128-firm/96-household fixture has explicit historical capital
and an external utility contract. It is a bounded correctness/CPU profile, not
proof of natural growth balance. Its 21 daily steps include a monthly payroll
boundary. Test output reports timings and save size for that run. No rendering,
real mobile FPS or physical-device performance is claimed.
