# Workforce candidate validation

Local base `2431ba31ca7e34474233703643936132c66e8072`; branch `park-workforce`.

Completed:

- `npm run build`: TypeScript and production build passed. Existing large-chunk warning remains. Log: `build-final.log`.
- Focused workforce/parks/city-stats/overview run: 20/20 passed. Log: `focused-final.log`.
- Final workforce scenarios after adding the recruiting status: 6/6 passed. Log: `park-workforce-final.log`.
- Independent Astra review: 31/31 workforce/labor/park tests passed after correcting its finding. Exact double-paid/owed corrupted-save reproduction now rejects. No remaining findings in the reviewed scope.
- Both existing 360-day no-park baseline hashes match upstream main, for seeds 61025 and 20261023.
- `git diff --check` passed.

Covered synthetic scenarios: real residual workers and combined skill-pool uniqueness; owner/firm priority; off-road park and applicant hiring; empty applicant pool; insufficient shared treasury budget; earned payroll protection against construction; monthly payroll and tax; nonwage maintenance; removal and repeated removal; save/load deterministic continuation; v14 migration without changed economic state; exact pre-upgrade backup and quota failure; malformed/overlapping workers and unsupported/duplicate settlement rejection.

Incomplete checks:

- Whole-repository test run was stopped after prolonged machine contention. Completed groups showed no failure, but this is not a full-suite pass. Logs: `full-tests.log` (first attempt), `full-tests-bounded.log` (bounded attempt).
- Browser smoke attempted twice against isolated local Vite port 4187 and new headless Edge test profiles (debug ports 9459 / 9461). Both failed at CDP `Runtime.enable` before navigation/page verification, with 30s and 60s timeouts. Outcome: UI verification NOT RUN, not an application assertion failure. Logs: `browser-workforce.log`, `browser-workforce-retry.log`. The enhanced browser test is included for the integrator to rerun.

Integration still requires the canonical combined save-version assignment and leisure activity-clock use of the workforce contract. No upstream push, merge, deployment, live player data or secrets were used. Apply only the workforce diff above the local base to canonical core PR 69, not the reconstructed base history.
