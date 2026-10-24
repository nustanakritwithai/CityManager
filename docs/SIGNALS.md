# Public city signal reports

Open the pilot with `?signals=1`, then City overview > City signals. The approved production defaults show the entry and use the public endpoint. For offline QA set VITE_CITY_SIGNALS=false and VITE_CITY_ADVISOR_ONLINE=false. Publication is tracked by the feature PR.

The report is public and requires no login, signup, password, JWT, access token or cookie. The upstream Typhoon key remains on the server. All public callers share the provider quota; there are no custom per-user/global/IP usage quotas or application concurrency gates. Provider errors/limits preserve the local report without automatic retry.

The panel captures nine actual aggregate values without modifying simulation: people from household members, household records, business establishments, employed people, unemployed workforce, treasury credits, current-day treasury inflow/outflow and housing person capacity. People and households remain separate; dependents are not counted as unemployed. One tick is one day; integer satang become game credits. Current-day flows include grants and construction when recorded. See [exact mapping](SIGNAL-MAPPING.md).

Reports retain units, windows, deterministic signal IDs/rules, provenance and missing data/history. First capture has no invented prior. Later distinct-day captures allow comparisons. Load/new-city resets history; advancing the clock marks reports stale. There are no mutation tools, invented severity or causal claims.

The approved production default uses `https://157.85.96.139:5444/api/city-advisor/report`, on the existing certificate-verified TLS listener. The isolated process and exact Apache route are activated under the recorded approval; the feature PR publishes the game control. No identity system is needed. The query feature flag alone cannot enable requests. Never put a Typhoon key in Vite variables, browser storage, source, URLs or logs.

The browser sends aggregate JSON only. It omits cookies/authorization, rejects redirects, bounds responses to64KiB and waits at most20seconds. Returned deterministic data/references must match local calculations. Remote prose is discarded; Thai text comes from templates. The backend fixes the official upstream/model, input16KiB and provider timeout15seconds. It does not proxy arbitrary URLs/prompts. These are operation bounds, not usage quotas.

The isolated backend source is in `server/city-advisor/`, disabled unless its server environment enables the provider. It loads no credential file itself. Approved deployment will inherit only the existing named server key in process memory; no shared env copy or generic WebAi proxy is used. The approved single synthetic live test is complete; frontend/public-access development made no further provider requests.

Verification: `npm test`, `npm run build`, `npm run assets:verify`, `npm run test:advisor`. Start a preview at127.0.0.1:4187, then `npm run test:signals` for installed-Edge desktop/mobile acceptance. Emulated mobile viewports are not physical handset tests.

## Captured-signal reading draft

The follow-up draft leads with plain Thai observations and a link to each signal's numeric explanation. Technical IDs, formulas and provenance remain available inside a second disclosure. Snapshot comparisons show the actual before/current values and their difference; missing earlier values remain unavailable. Income/expense comparisons are differences between two captured single-day totals, never a cumulative period total. Housing headroom describes aggregate person capacity, without asserting that every household can be allocated a home.

The S22 label bug came from the global `summary span { font-size:9px }` rule: it overrode inherited summary sizing and did not use the phone reader scale. Signal title and explanation styles now explicitly use the same 14-unit typography. The mock browser suite measures computed and reader-normalized font sizes, visible summary rows, 44px controls and overflow at ordinary phone and wide-layout/narrow-screen sizes.

Loading preserves the immediately available local report. Cancel aborts the current request and ignores late replies. Retry is explicit and resends the exact captured snapshot, even if the city clock advances; capture-new creates the next comparison. Timeout, network/provider failure and invalid references retain deterministic fallback and expose retry without login or automatic repeat requests. Loading another city clears history and pending state.

Run `node --experimental-strip-types tests/signal-reading-smoke.mjs` against a loopback preview. The suite intercepts every report request and blocks direct provider requests; it does not call the public API. The separate Signal reading workflow verifies the exact PR head. This draft changes neither the wire contract nor production adapter/service configuration.
