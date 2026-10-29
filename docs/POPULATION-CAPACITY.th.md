# Population capacity: removing the 128-household ceiling

## Scope

Remove the old 128-household admission/demand ceiling. Households remain actual 1- or 3-person compositions, not display multipliers. Admission still requires an existing vacant home with both capacities available, road access, spare water and power, funded jobs, existing unemployed workers served first, affordability and the existing one-household/day limit. No cash, stock, residents or job slots are injected by this feature.

The structural safety bound is 192 building parcels × 32 households at the highest residential tier = 6,144 households. It is **not** a claim that this many households can be housed and employed together: factories, farms, shops and utilities also consume parcels. The 64-firm and 32-plant bounds, their capacities, financial rules and map size remain unchanged. Large towns can still stop growing for genuine shortages. This patch removes one artificial ceiling; it does not promise arbitrary population or mobile FPS.

## Save compatibility

- Existing v1–v20 saves retain their own strict validation, including their historical count bounds.
- Small cities keep v19 (or v20 with road topology) envelopes.
- Exceeding 128 households / 256 employment records uses v21 / chain-16 with populationCapacityVersion:1. Once present, the marker is retained even if population declines.
- v21 validates the entire v19 economic state under expanded count bounds and also validates v20 road topology if present. Employment conservation, capacity, money, stock, funding, wage claims and migration reconciliation are not bypassed.
- The employment record bound is 2 × 6,144 because current household compositions contain at most two workers. Existing per-household checks continue to reject double use.
- First replacement of a v9–v20 main-slot save preserves its exact original bytes in one of eight immutable population backups. Full slots or failed writes abort before primary replacement. Guest ID/session lifetime is unchanged; market identity and park clocks are retained.
- Older applications cannot read v21. Rollback must use the preserved pre-transition save; it must not overwrite the newer save with an empty city.
- Existing 12 MB journal and browser storage limits remain. This work does not prune history or claim unlimited save duration.

## Verification

New tests cover the 129th household with real admission checks, one funding entry, missing jobs/utilities/vacancy blockers, a reconciled synthetic city with more than 1,000 people and 256 employment records, roads + population envelopes, corruption rejection, old-byte backups and quota failures, and deterministic daily/payroll replay.

The high-population fixture is explicitly synthetic: initial capital and an enlarged outside utility contract are fixture inputs. It proves count handling/reconciliation and UI compatibility, **not** organic city growth or balanced capacity of the default utility network. No such inputs are added to production gameplay.

Browser acceptance extends the existing population suite: load a validated high-population city through real Load, inspect exact mobile city metrics, Save, Load, and compare the complete city and session. CI must pass before publishing. A cloud CPU timing diagnostic is not a physical Android performance guarantee.

## Integration with education work

Education agents must branch from current main, discover the latest save version, preserve this marker and all prior road/market/park fields, and use a new non-conflicting schema for education. Do not overwrite the new count validation with legacy limits or mistake occupational workerSkills for qualifications.
