# Combined park runtime

The core park release is PR #69 / `bf753818c9b909acb9e00889af3894f9a47a23bd`.
This increment combines workforce `e8d6f9e1a6dc27092f85fdac803ac874c9fba857`,
recreation `87f802c81f3e34e8cd8f864a62aaedb148612d41`, and complete activity
range `2431ba31..db6aba95389a13bc16a49ded5fe30ad88510ef00` exactly once.
All integration uses its own checkout and preserves the main backup/utility changes.

## Behavior and ownership

- The existing economic engine assigns residual workers after business/owner jobs,
  records earned wages, settles them once, and charges separate park upkeep.
- Activity resolves those canonical allocations to household constituent IDs. It
  creates no residents, wages, friendships, or extra business jobs.
- `park-runtime.ts` samples every actual pre-step activity minute, then advances
  activity and commits the immutable recreation result. Reservations, travel,
  arrival/entry and return counts cannot award benefit. Strolling, waiting,
  meeting and sitting can; on-duty workers cannot.
- Quality is the actual staffed fraction (0 or 100% for one level-1 position).
  Comfort is three occupants; reservations remain six. Full-quality gain is at
  most 0.25 points/minute and 15/day, with 5/day decay to zero. This is only park
  recreation satisfaction, with no tax, output, land-value, needs or migration effect.
- Every park stays one cell and requires no road or utility connection. Walking
  routes are bounded paths through actual unoccupied grid cells.
- The existing 1×/3×/10× economy pacing remains one/three/ten days per requested
  second. A separate citizen-view control slows the whole city to one minute per
  second (24 real minutes/day); it does not run the economy and residents on
  different clocks. Rendering quality changes only the visible subset.
  A frame budget stops work at a completed minute under load, slowing playback
  without skipping game time or accumulating background catch-up debt. A single
  bounded admission/pathfinding step and one daily economic step remain indivisible.
- Decorative pedestrians are disabled; decorative vehicles remain. Every park
  figure is a current, uniquely identified activity visitor. Renderer limits do
  not affect service, reservations, benefit or money.

## Clock, pause and persistence

One daily economic step occurs after exactly 1440 activity minutes. Activity resets
to the new day before UI/owner-automation callbacks can render or request a pause.
An automation pause at that boundary stops the rest of that wall-time request.
Ordinary pause, speed changes and backgrounding retain fractional minute progress.
Background wall time is not replayed as invented visits.

The unpublished combined save is v15 / chain-10. Its optional `parkRuntime` field
holds version-1 activity, recreation, and fractional minute state in the same local
storage write as City. The application removes this field before economic
deserialization, so owner journals and daily simulation do not own it. The loader
validates both clocks and all components before swapping live state. Old saves
initialize at their current day with zero past visits or earned benefit. Existing
bounded v12, v13 and v14 backup/recovery behavior is preserved. Prototype sidecars
without the canonical municipal job field are rejected rather than guessed.

Paused construction and demolition reconcile visitors immediately. Removed
residents are pruned without crediting new time. The recreation table is read-only
and keeps its disclosure and scroll state during updates.

Synchronous batches cache canonical citizen identities, walkability and staffing
policy. A cache is recreated on every call and economic boundary; it never survives
city edits or asynchronous work. Observations and activity phases still advance
one minute at a time.

## Verification gates

`tests/park-runtime.test.ts` covers real eligible intervals, workforce exclusion,
batch/reload equivalence, fractional pause, payroll boundaries, synchronous owner
automation, two 360-day no-park baselines, demolition, corrupt clocks and v14 backup.
The installed Edge acceptance suite adds actual rendered identities, citizen-view
controls, save/load and corruption rejection, and a 390px mobile recreation panel.
Exact executed results belong to the integration checkpoint / PR, not this design
document. New external asset admission remains outside this increment pending
canonical package verification and explicit destination approval. Server-market
work remains paused and unchanged.
