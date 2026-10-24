# Read-only signal mapping

This adapter reads the merged household-1 / save-version-two CityManager aggregates without changing the city, ledger, household, firm, tick, RNG, save schema or simulation rules. Nine available metrics are sent.

| Wire metric | Actual source | Wire unit | UI meaning |
| --- | --- | --- | --- |
| population | Sum of `city.households[].members` | people | Actual household members, including displaced households |
| households | `city.households.length` | households | Household records, not individual people |
| businesses | `city.firms.length` | establishments | Current firm/establishment records |
| employed | Sum of `city.employment[].workers` | people | Allocated workers, not allocation-record or household counts |
| unemployed | Sum of household `workforce` minus allocated workers | people | Unemployed workforce; dependents are excluded |
| treasury | `city.accounts.treasury / 100` | currency | Credits observed at the current tick |
| incomePerTick | Treasury-bound money ledger entries with `entry.tick === city.tick`, divided by 100 | currency/tick | Receipts recorded on this simulation day |
| expensesPerTick | Treasury-originating money ledger entries with `entry.tick === city.tick`, divided by 100 | currency/tick | Payments recorded on this simulation day |
| housingCapacity | Sum of `housingCapacity(building).persons` for residential buildings | people | Actual built residential person capacity from cottage type/level rules |

One tick is one simulation day. Ledger flow values include every recorded current-day municipal receipt/payment: initial grant, construction and upkeep can be included. They are not recurring tax revenue, a forecast, a 30-day sum or an average over the report window. At startup the actual fixture records a 30,000-credit grant and 550-credit starter road payment; treasury is therefore 29,450 credits.

Population and household count now have distinct actual sources and units. Employment allocations may contain several workers, and a family may work across establishments; counts therefore sum workers rather than records. Unemployment uses workforce minus employed workers, not population minus employed workers. Housing capacity sums all built residential person slots; it is not occupied persons, household slots, an accessibility guarantee or proof that every household has a home. The existing threshold compares population and total built person capacity only and makes no allocation or causal conclusion.

No supported happiness, pollution or traffic metric exists in this inspected version. These three metrics stay absent and receive explicit missing-data flags. Available empty counts/capacities and a zero flow from an empty current-day ledger sum are observed zeros; they do not replace unavailable metrics. Workforce itself is not sent because the existing backend enum has no workforce metric; its role in the unemployment calculation is documented here.

`captureCitySignals` creates detached value snapshots. `requestForCapture(current, prior?)` uses only an earlier observed capture; same/future history is omitted. The comparison window is exactly prior tick to current tick, and current observations are marked at the current tick alone. The caller must discard prior captures when loading, creating or replacing a city. No history is reconstructed from ledger balances or invented tick-zero values.

`buildLocalSignalReport` follows the isolated backend's version-one deterministic rules and templates. Test fixtures copied from the synthetic backend example establish full response parity without requiring files outside this repository. Provenance is declared adapter/rule version and `client_reported_unverified`, rather than server-verified game accounting.

`acceptRemoteSignalReport` accepts matching schema/tick/deterministic data only, validates every summary/group/observation reference and category, requires empty hypotheses, and rejects extra report fields such as severity. Object key order does not change equality. It retains local observation/limitation text and applies only validated signal selection/grouping. Arbitrary remote prose is discarded. UI rendering must still use text nodes/textContent, never HTML.

This module has no network, credential, storage, mutation or model-execution capability.

