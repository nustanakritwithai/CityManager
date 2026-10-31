# Reviewed bumper-gap acceptance

The `traffic-gap` route requires the exact reviewed source diff and explicit paths on the PR merge-base/head or push before/after range. Empty, unknown, mixed-feature and changed source hashes use the default full route.

Required coverage:
- Existing traffic clock/routing/fleet/network/demand/queue/poses and game/worker/layer/modal/fallback tests, plus explicit physical-spacing regressions.
- The strict bypass improvement preflight (same demand and roads, equal 20-step warmup on both paths for acceleration and safe corner traversal) and bounded stress/capture/worker benchmarks, with unchanged budgets.
- Actual built game entered through the isolated server ACK fixture: real Worker frames, busy actual-render-frame clearance and stable admitted IDs, native pause/resume and OFF/ON, one-attempt worker fault fallback, real server save/reload and no browser city writes. Synthetic fixture screenshots use the existing health-checked readback path. No live accounts or saved cities.
- Mandatory complete server-save acceptance, typecheck and production build; deploy uses that same run's built artifact.

The old full/core/extended and default/fault browser entrypoints assume localStorage city loading and obsolete recovery/backup ownership. They are **not run and not reported passed** on this exact route. Their relevant traffic assertions are retained in the unit/worker/preflight tests and authenticated browser helper. The unrelated dense FPS matrix is not claimed. Unknown or mixed changes retain the existing full job requirements; this is not a global deletion or general traffic exemption.

The legacy storage-utility autosave regression remains a utility test, not a claim that current gameplay writes browser saves. It requires current primary-first publication and both exact lossless copies. Actual gameplay durability is checked against the server transaction ACK.

Independent bus motion is not redesigned here. Car-driven or birth overlaps fail. Any bus-driven intrusion must be separately classified from a previously clear pair, an unchanged admitted car pose, measured bus displacement/direction and the production intrusion diagnostic; unknown collisions fail. Such evidence is reported explicitly and is not a claim of universal shared bus right-of-way. Source regressions cover full car/truck/bus dimensions and turning/stopline/substep behavior.

The browser runs a light real-bus fixture and a separate canonical 32-family bottleneck session. The latter reuses the preflight road layout and is acknowledged only by the loopback mock service; the actual production Worker derives demand from the loaded city. It must show blocked/congested traffic before capture. No Worker input is overwritten, no long economic warmup is used, and the original light session is restored before the mandatory save failure/lifecycle cases.
