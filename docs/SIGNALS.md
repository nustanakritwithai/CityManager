# Read-only city signal pilot

The pilot is opt-in. Open the game with `?signals=1`, then City overview > City signals. A reviewed build may instead set `VITE_CITY_SIGNALS=true`. The ordinary page keeps the experimental entry hidden. This branch has not been merged or deployed.

The panel captures actual aggregate values without advancing or modifying simulation: households, business establishments, treasury credits, and treasury inflow/outflow recorded at the captured tick. It does not treat the existing household count as a count of individual people. One tick is one day; integer satang are converted to game credits. Current-tick flows include grants and construction when recorded, rather than claiming recurring revenue. See [exact mapping](SIGNAL-MAPPING.md).

Reports retain units, observation/comparison windows, deterministic signal IDs/rules, provenance, missing metrics and missing history. The first capture has no invented prior snapshot. A later distinct-day capture enables comparisons. Loading or creating a city resets panel history. The panel labels stale captures when the game clock advances. It has no accounting or simulation mutation tools.

Offline calculations work without a server, key or account. Optional Typhoon output may only select/group existing signal IDs; frontend acceptance checks all deterministic data and references, discards remote prose and renders local Thai templates as text. Invalid, unavailable or unauthenticated responses preserve the local report.

## Online activation is deliberately incomplete

`VITE_CITY_ADVISOR_ONLINE` defaults false and `VITE_CITY_ADVISOR_ENDPOINT` defaults empty. A future approved deployment must also supply an in-memory `getAccessToken` callback from an actual verified login flow. No callback, issuer or account is invented here. The callback supplies a short-lived user JWT, never a Typhoon key. The query feature flag cannot enable network access. The endpoint must be HTTPS with exact path `/api/city-advisor/report`, without query, fragment or userinfo. No shared API secret belongs in Vite variables, browser storage, source or URLs.

Do not use the VPS shared unauthenticated WebAi proxy. The isolated backend contract is `POST /api/city-advisor/report`, schema version 1, known aggregate metrics only. Browser requests have a 20-second timeout, no retries, credentials omitted, redirects rejected and a 64 KiB response cap. Production backend owner authentication, quotas and TLS route need separately reviewed configuration. The separately approved one-shot synthetic upstream test is already complete; this frontend work performs no further real provider calls.

Before online deployment the owner must identify: a controlled HTTPS hostname/certificate; the existing provider's exact issuer, audience, public JWKS URL and owner subject; an approved runtime identity and key-delivery method; and manual aggregate-report call authority/caps. No service, DNS, firewall, credential store or security setting is changed by this branch.

## Verification

`npm test`, `npm run build`, and `npm run assets:verify` check the source. Start an isolated preview on `127.0.0.1:4187`, then run `npm run test:signals`. The browser test uses installed Edge with its own loopback CDP port 9357/profile, captures desktop/mobile screenshots and checks read-only behavior, metric mapping, missing/stale history, navigation, layout and zero report/provider traffic. Physical handset behavior is not established by viewport emulation.

The VPS encountered disk exhaustion during this task's dependency installation. Only this task's generated cache/incomplete install was removed. QA reused compatible installed package versions read-only; no shared dependencies were changed. No additional install is needed in that executor. A fresh development environment should use the repository's lockfile and normal documented installation.
