# Read-only signal mapping

This adapter reads published-main CityManager aggregates without changing the city, ledger, household, firm, tick, RNG, save schema or simulation rules.

| Wire metric | Actual source | Wire unit | UI meaning |
| --- | --- | --- | --- |
| households | `city.households.length` | households | Household records, not individual people |
| businesses | `city.firms.length` | establishments | Current firm/establishment records |
| treasury | `city.accounts.treasury / 100` | currency | Credits observed at the current tick |
| incomePerTick | Treasury-bound money ledger entries with `entry.tick === city.tick`, divided by 100 | currency/tick | Receipts recorded on this simulation day |
| expensesPerTick | Treasury-originating money ledger entries with `entry.tick === city.tick`, divided by 100 | currency/tick | Payments recorded on this simulation day |

One tick is one simulation day. Ledger flow values include every recorded current-day municipal receipt/payment: initial grant, construction and upkeep can be included. They are not recurring tax revenue, a forecast, a 30-day sum or an average over the report window. At startup the actual fixture records a 30,000-credit grant and 550-credit starter road payment; treasury is therefore 29,450 credits.

The simulation's `summary().population` currently counts household records, so it is deliberately not sent as the backend's people-valued `population` metric. Employed/unemployed household counts are also not converted into people. No supported person-valued housing capacity, happiness, pollution or traffic metric exists in this inspected version. These metrics stay absent and receive explicit missing-data flags. A zero flow from an empty current-day ledger sum is an observed zero; it does not replace an unavailable metric.

`captureCitySignals` creates detached value snapshots. `requestForCapture(current, prior?)` uses only an earlier observed capture; same/future history is omitted. The comparison window is exactly prior tick to current tick, and current observations are marked at the current tick alone. The caller must discard prior captures when loading, creating or replacing a city. No history is reconstructed from ledger balances or invented tick-zero values.

`buildLocalSignalReport` follows the isolated backend's version-one deterministic rules and templates. Test fixtures copied from the synthetic backend example establish full response parity without requiring files outside this repository. Provenance is declared adapter/rule version and `client_reported_unverified`, rather than server-verified game accounting.

`acceptRemoteSignalReport` accepts matching schema/tick/deterministic data only, validates every summary/group/observation reference and category, requires empty hypotheses, and rejects extra report fields such as severity. Object key order does not change equality. It retains local observation/limitation text and applies only validated signal selection/grouping. Arbitrary remote prose is discarded. UI rendering must still use text nodes/textContent, never HTML.

This module has no network, credential, storage, mutation or model-execution capability.

