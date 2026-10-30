# Taxi destination search baseline

Run `node --experimental-strip-types scripts/benchmark-taxi-search.mjs` from the repository root. On 2026-10-30, Windows x64 and Node v24.19.0, a synthetic fully connected 24×24 all-road grid (576 cells, 2,208 directed links) built 192 distinct full origin trees and performed 192 destination lookups per tree. Five samples in milliseconds:

| Sample | Cold trees | 36,864 cached lookups |
| --- | ---: | ---: |
| 1 | 543.97 | 27.94 |
| 2 | 347.68 | 40.21 |
| 3 | 357.38 | 10.63 |
| 4 | 357.91 | 2.20 |
| 5 | 330.25 | 2.02 |

Each run produced the same 146073.4-minute checksum. This is a stress microbenchmark, not a natural city, end-to-end dispatch or browser frame benchmark. Build and a separate browser test were active during measurement on a shared machine; CPU and memory isolation were not controlled. It demonstrates substantial cold-tree work and cheap repeated lookups after warmup, but is not a release threshold or a mobile-device claim. Before runtime release, measure representative large-city demand and road edits, memory growth from the per-origin cache, dispatch scheduling and browser frames; agree budgets and optimize or spread the cold work as needed without dropping demand.
