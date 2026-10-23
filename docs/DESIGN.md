# CityManager v0.1 design boundary

This is an original, bounded city-builder prototype using the PlayCanvas engine library. Cities: Skylines II is gameplay inspiration, not a claim of parity or a source of proprietary assets or formulas. No Living City Lab or novel-engine code is reused.

## Sources and reconciliation

The user-provided **Living Economy** PDF was inspected by the coordinating agent: 13 pages, dated 23 October. A 40-page masterplan and a 24-case QA specification have not been supplied. The economic feedback image describes needs → employment → wages → purchases → firms → tax/infrastructure; it is not visual art direction. The latest user choices, PlayCanvas and CSII inspiration, take precedence over older references.

| Design input | Prototype decision | Boundary |
|---|---|---|
| p5: deterministic seed, integer satang, daily/monthly rates | Serializable TypeScript model; one fixed tick per day; 30-day months | UI speed only changes ticks per wall-clock second |
| pp3,5–10: household/firm cash, actual purchases and wages | Individual account IDs and paired money transfers | No formula-generated citywide sales or unrestricted firm credit |
| pp7–9: goods inventories and reconciliation | One abstract consumable good with quantity ledger | Raw materials, food, general goods and services remain future work |
| pp10–11: player roads/zones, autonomous private buildings | Road-connected R/C/I parcels develop under explicit conditions | No direct house/shop placement |
| pp10–12: road/power/water and viable demand | Gateway-connected roads; explicit power/water availability flags | Outside supply assumed universally available; no capacity, network or tariff model |
| pp10–12: 64×64, 40m tiles, zoning within two cells | 24×24, 2 rendering units per tile, adjacent one-cell frontage | Rendering units are not claimed to be real metres |
| p13: A*, travel cost, smoothed congestion, transit later | Four-neighbour road reachability from one outside gateway | No shortest-path cost, lane traffic or congestion model |

Ambiguities in the concept are resolved conservatively: external sources have explicit counterparties; the outside account may go negative; local firms cannot spend money they do not have. Minimum wage/ceiling wording, closure-policy inconsistencies and land-value double counting are not silently treated as authoritative formulas.

## Code boundaries

`src/sim.ts` owns the grid, road connectivity, parcels, buildings, households, firms, seeded state, accounts and ledgers. It imports no PlayCanvas or browser API. Roads and parcels remain data even when meshes are rebuilt.

`src/renderer.ts` owns PlayCanvas entities, original primitive geometry, materials, camera and pointer gestures. `src/main.ts` maps DOM/pointer actions to simulation commands, controls fixed ticking and persists versioned JSON. Simulation state, not meshes or elapsed rendering time, is saved.

## Time, money and goods

One tick is one day. A month is 30 days; 12 months form a model year. Production and shopping are daily decisions. Wages, rent and taxes settle monthly. Amounts in the model are integer **satang**; the HUD divides by 100 for currency display. No interpolation or frame-rate-dependent production is used.

Each money entry records day, payer, payee, amount and reason. A transfer subtracts exactly the amount credited to the receiver. Opening grants, migrant savings and investment are sourced from `outside`; this is an explicit external model boundary, not earned city income. City road construction and upkeep debit the treasury and credit their named counterparty. Rent goes to a landlord account, not directly into city tax revenue.

| Account | Meaning |
|---|---|
| `outside` | Abstract capital provider, external buyer/supplier and source/sink boundary; may be negative |
| `treasury` | City cash: opening grant, tax receipts, roads and upkeep |
| `household:N` | Each household's spendable wallet |
| `firm:N` | Each firm's spendable wallet |
| `construction` | Contractor receiving private construction costs |
| `roadworks` / `upkeep` | City spending counterparties retained for reconciliation |
| `landlord` | Explicit recipient of rent; not an additional simulated household |

Named source/sink accounts are retained rather than deleting money. Summing all accounts, including outside and these counterparties, must remain equal to the opening total. Positive local balances funded from outside correspond to a negative outside balance. This is a transaction ledger, not a full corporate accounting/loan model.

Goods entries record day, source, destination, quantity and reason. Production and imports introduce stock explicitly; shop replenishment moves stock between firms; shopping removes firm stock and records consumption. The invariant is `produced + imported - consumed - exported = firm inventories`. Demolition stock is written off to `outside` and counted in `exported`; that counter therefore includes disposal, not only commercial export sales. One unit represents an abstract daily consumable, not any particular PDF good.

## Bootstrap, growth and failure

Additional industry requires a connected unemployed household and fewer than two vacant existing jobs. The first factory retains an explicit workforce bootstrap exception. This prevents early excess factories from absorbing every worker before a viable shop can operate; the default UI seed and eight other seeds have an economic-loop regression.

The default seed is `20261023`. New cities provide 11 connected road cells (`x=0..10, z=12`), six R, two C and two I parcels, and no private buildings. The treasury opens with a 3,000,000-satang external grant. Initial road construction is charged to it. The first two residential households and first industrial employer have limited bootstrap exemptions to break the initial no-workers/no-jobs cycle. Each arriving household receives 150,000 satang of outside savings; each new firm receives 300,000 satang outside equity and pays 40,000 satang construction. Residential construction is a 40,000-satang outside developer investment paid to `construction`. These sources are explicit; none is earned city income.

Every third day the saved RNG selects one eligible vacant parcel. R demand follows vacant jobs, with the first two households exempt. The first I firm is exempt from the workforce-demand check; later I requires an actual connected unemployed household and fewer than two vacant jobs. Retail demand is `floor(population / 4)` minus existing shops; viability also requires enough connected funded customers to cover wages and rent (four per shop with local supply, five if imports are required). All still require road access, power and water. Limits are 192 buildings, 128 households and 64 firms. The browser uses seed `61025`; `createCity()` defaults to `20261023`.

Monthly height reviews require age of at least 30 days, with a maximum level of 3. R requires employment, a recent purchase and at least 20,000 satang savings; firms require a profitable settled month, workers and 20,000 satang construction funds. There is no autonomous closure, eviction or migration-out model in this slice; manual bulldozing removes buildings. Disconnection suspends employment, purchases, production and height growth, while rent and road upkeep remain obligations.

Prices are prototype calibration assumptions, not CSII formulas: roads cost 5,000 satang/cell and upkeep 10 satang/cell/day; demolition costs 2,000 satang. Industrial/commercial wage rates are 60,000/42,000 satang per 30-day month, with wages settled monthly for worked days. Household and firm rent is 10,000 satang/month. Wage tax is 10%; positive firm-profit tax is 20%. Shops sell at 800 satang/unit, buy locally at 300 or import at 450. I produces eight goods/worker/day and exports at 350 satang/unit. Firms spend actual available cash; no unlimited credit is granted.

Development and level changes are simulation decisions; different building heights are rendered from their state. A disconnected road component cannot support activity through the outside market. Deleting a connecting road therefore has economic effects, rather than merely changing its colour.

The inspector explains reasons such as missing frontage or gateway connection, unavailable power/water, insufficient workers/customers/demand, low cash or stock and unprofitable development. Failed commands leave the city unchanged and return a message. Existing roads are not charged twice. Road creation is an atomic path operation: validation/cost checks happen before cells are changed.

## Interaction and persistence

Road creation supports two taps/clicks or dragging between endpoints with an L-shaped preview. Cancel first discards the pending start point; a subsequent cancel returns to Select. Changing tools also discards a pending path. Camera pans must not submit a building command, and multi-touch gestures must not submit a cell command.

The DOM HUD supplies accessible text, minimum 44px controls, keyboard shortcuts, explicit camera buttons and a collapsible inspector. The 3D canvas remains the playfield. Pan, rotation and zoom state are renderer concerns, independent of household/firm state.

Local save/load uses schema version 1 and includes simulation RNG state so continuation matches uninterrupted ticks. Unknown versions, malformed values, broken entity references and unreconciled journals are rejected before replacing the active city. Both ledgers retain their complete history. The parser limits JSON to 12,000,000 characters; browser storage quota can be lower, so this is a bounded prototype rather than unlimited history storage. Storage errors are surfaced; saves are local to the browser/origin and are not cloud backups.

## Verification and publication

Headless tests target reproducibility, disconnected access, repeated/failed commands, autonomous growth, real employment/purchases, money/goods reconciliation and save continuation/validation. Browser verification must also cover repeated tools, cancel/back, camera input, pause/speed, save/load, disconnected-road explanations and representative screenshots. A simulated mobile viewport demonstrates layout only; it does not establish real-device mobile performance or touch compatibility.

Vite builds with base `/CityManager/`. Pages was inspected read-only as `build_type: workflow`, source `main` `/`. The initially empty repository had no workflow; only a README bootstrap was initialized on `main`. Gameplay is developed on a feature branch and submitted as a draft PR. No deployment workflow, settings change, merge or automatic gameplay publication is part of this milestone.

Official engine references checked during development on 23 October 2026: [standalone usage](https://developer.playcanvas.com/user-manual/engine/standalone/), [AppBase](https://api.playcanvas.com/engine/classes/AppBase.html), [CameraComponent](https://api.playcanvas.com/engine/classes/CameraComponent.html). Dependencies are exact-version pinned in `package.json` and `package-lock.json`.
