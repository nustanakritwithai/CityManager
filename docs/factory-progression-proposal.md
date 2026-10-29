# Factory progression proposal

Source reviewed: `cc5c13a683e73cd8d275d22d5413432581f13bbf` (main, after parks PR #71). The proposed balance is not yet validated for release.

The accompanying branch is a candidate for integration review, not release-ready. Its v17 / chain-12 stamp is a local placeholder only: the serial integrator assigns the actual combined schema. It does not yet read housing's provisional v16. The serial integrator must reconcile all shared files and verify exact-head behavior before merge.

Keep levels 1–3 unchanged. At levels 4–9, add one actual employee slot per level (7–12 jobs), with unchanged recipe throughput of two crop lots into eight goods per worker per day. This gives full-staff throughput of 14–24 lots and 56–96 goods daily, without an additional level multiplier. Expand crop capacity from the existing 24 lots to four lots per job for levels 4–9 (28, 32, 36, 40, 44, 48). Utilities continue at power = level + 2, water = level + 1. Each upgrade stays on its original cell and uses the existing 20,000-satang construction payment; require the firm to retain a working reserve plus a day's wages and crop purchases after payment. These values require playtesting, especially given factory sales and demand constraints.

| Absolute level | Paid positions | Crop lots | Power / water | Model / markers |
| --- | ---: | ---: | ---: | --- |
| 1 | 4 | 24 | 3 / 2 | 1 / 0 |
| 2 | 5 | 24 | 4 / 3 | 2 / 0 |
| 3 | 6 | 24 | 5 / 4 | 3 / 0 |
| 4 | 7 | 28 | 6 / 5 | 3 / 1 |
| 5 | 8 | 32 | 7 / 6 | 3 / 2 |
| 6 | 9 | 36 | 8 / 7 | 3 / 3 |
| 7 | 10 | 40 | 9 / 8 | 3 / 4 |
| 8 | 11 | 44 | 10 / 9 | 3 / 5 |
| 9 | 12 | 48 | 11 / 10 | 3 / 6 |

The markers are code-native boxes on the same tile; appearance needs browser review. The level table drives jobs, crop storage, utility needs and model/marker selection. From level 3 onward, monthly growth also requires spare utilities, positive last-month operating profit, at least one real worker and spendable cash of 20,000 construction + 20,000 working reserve + next-level jobs × (one daily wage + two crop lots at 350 satang). Earlier factory upgrades retain the original checks.

The current output inventory has no production storage cap. Introducing one would alter old-level economics and could strand existing stock, so a finished-goods cap needs a separately specified migration and overflow policy rather than an arbitrary retroactive limit. Market receipt capacity is independently capped at 1,024 finished goods.

Integration must coordinate with housing's v16 / chain-11. Validate v15 under its existing limits first; do not rewrite crop or goods ledger history. On migration, set `factoryProgressionStartTick` to the loaded tick; events through that tick retain the old six-worker/24-lot bounds. A fresh city starts at zero. Assign the combined schema serially, back up previous bytes before first replacement, and preserve market identity and park runtime. Deleted or replaced firms still appear in historic ledgers: infer a deleted recipient's role from its provable crop events before replay; if a deleted market-receipt recipient has no role evidence, both admissible recipient types have a maximum of 48 lots. Preserve recipe selection history and every wallet, stock, worker allocation and building identity during upgrade.

Audit targets: `sim.ts` (growth, capacity, recipe forecast, demand, hiring, exports, validation and migration), `agriculture.ts`, `agriculture-runtime.ts`, `agriculture-validation.ts`, `market-client.ts`, `entry-gate.ts`, `context-panels.ts`, `renderer.ts`, `asset-models.ts`, `park-runtime.ts`, and `save-storage.ts`. Labor and processing already scale from actual workers; goods exports use actual workers, and crop purchases are constrained by available cash and seller stock.

Required evidence: deterministic parity for levels 1–3; progressive staffing, inputs, utilities, capital, stock and output at 4–9; no production without workers, input or services; no double scaling; money and commodity journal reconciliation; underfunded upgrade blocking; receipt and demolition at expanded stock; old save strict validation and byte-preserving migration; high-level save/load including demolished historical firms and recipe changes; automatic upgrade identity preservation; browser rendering and displayed capacity at old and new levels. Test combined housing and factory migrations after serial integration.

Focused checks exercise actual monthly upgrades with conserved payments and manual recipe, input purchase and worker-based processing, old and high-level save round trips, history after demolition, old-capacity tampering, market receipt capacity, utility and funding gates, and old-save backups. The higher-level setup uses controlled synthetic level and market-receipt inputs; it is not a long-run balance proof. Build, full regression, combined housing migration and browser acceptance remain unrun. Schedule heavy checks around the performance worker.
