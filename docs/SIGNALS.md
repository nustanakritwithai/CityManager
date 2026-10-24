# Public city signal reports

Open the pilot with `?signals=1`, then City overview > City signals. The approved production defaults show the entry and use the public endpoint. For offline QA set VITE_CITY_SIGNALS=false and VITE_CITY_ADVISOR_ONLINE=false. Publication is tracked by the feature PR.

The report is public and requires no login, signup, password, JWT, access token or cookie. The upstream Typhoon key remains on the server. All public callers share the provider quota; there are no custom per-user/global/IP usage quotas or application concurrency gates. Provider errors/limits preserve the local report without automatic retry.

The panel captures nine actual aggregate values without modifying simulation: people from household members, household records, business establishments, employed people, unemployed workforce, treasury credits, current-day treasury inflow/outflow and housing person capacity. People and households remain separate; dependents are not counted as unemployed. One tick is one day; integer satang become game credits. Current-day flows include grants and construction when recorded. See [exact mapping](SIGNAL-MAPPING.md).

Reports retain units, windows, deterministic signal IDs/rules, provenance and missing data/history. First capture has no invented prior. Later distinct-day captures allow comparisons. Load/new-city resets history; advancing the clock marks reports stale. There are no mutation tools, invented severity or causal claims.

The approved production default uses `https://157.85.96.139:5444/api/city-advisor/report`, on the existing certificate-verified TLS listener. The isolated process and exact Apache route are activated under the recorded approval; the feature PR publishes the game control. No identity system is needed. The query feature flag alone cannot enable requests. Never put a Typhoon key in Vite variables, browser storage, source, URLs or logs.

The browser sends aggregate JSON only. It omits cookies/authorization, rejects redirects, bounds responses to64KiB and waits at most20seconds. Returned deterministic data/references must match local calculations. Remote prose is discarded; Thai text comes from templates. The backend fixes the official upstream/model, input16KiB and provider timeout15seconds. It does not proxy arbitrary URLs/prompts. These are operation bounds, not usage quotas.

The isolated backend source is in `server/city-advisor/`, disabled unless its server environment enables the provider. It loads no credential file itself. Approved deployment will inherit only the existing named server key in process memory; no shared env copy or generic WebAi proxy is used. The approved single synthetic live test is complete; frontend/public-access development made no further provider requests.

Verification: `npm test`, `npm run build`, `npm run assets:verify`, `npm run test:advisor`. Start a preview at127.0.0.1:4187, then `npm run test:signals` for installed-Edge desktop/mobile acceptance. Emulated mobile viewports are not physical handset tests.