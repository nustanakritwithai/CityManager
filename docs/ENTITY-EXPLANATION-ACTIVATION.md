# Selected-entity explanation: activation runbook

This release adds a read-only inspector explanation on commercial-L1/save-v5 main8fd3367ad2cf387e2d3fc3134e9b4d69409800dd. It uses the canonical card projector/isMarket/capacity rather than defining its own zone/level taxonomy. No separateT tool or automatic market-to-shop upgrade is added. Migration-aware tests retain old retail card coverage.

## Current delivery boundary

The panel captures only after a manual click. Entity remote calls are disabled unless VITE_CITY_ENTITY_ADVISOR_ONLINE is exactly true. The approved release enables that non-secret flag in the production build step of .github/workflows/citymanager.yml. Existing city reports and local fact questions keep their current behavior. Mock development enables the flag with all report/provider traffic intercepted; those screenshots are explicitly labeled mock evidence. Production publishing requires the real adapter acceptance below first.

## Proposed contract extension

Reuse POST https://157.85.96.139:5444/api/city-advisor/report. Schema1 city snapshots remain unchanged. A schema2 operation named entity-explanation would carry one bounded selected-entity snapshot: identity/type, captured tick, inclusive accounting window, allowlisted numeric facts/units, missing-data flags, evidence references and a content-bound snapshot key. Do not send the save, RNG, account table, wallet identifiers, raw ledgers, household arrays, entity names or arbitrary user prompts.

This is expanded data transmission and requires approval before activation. The provider receives the allowlisted evidence/candidate catalog for this operation, not the full city state. It may select observed-fact, explicitly hypothetical cause and next-check IDs. Validators bind returned IDs to the captured evidence and exact snapshot identity; fixed Thai templates retain actual numbers, units and periods. Unavailable evidence remains missing, never zero. Cash boundary flows are not profit or a financial statement.

## Exact proposed deployment changes, after approval only

1. Copy reviewed server.mjs, entity-report.mjs and entity-contract.mjs into C:\ProgramData\CityManagerAdvisor\app\src, preserving the existing bootstrap/key source and all other services.
2. Add process.env.CITY_ADVISOR_ENABLE_ENTITY_EXPLANATION = 'true' before the existing configFromEnv() call in C:\ProgramData\CityManagerAdvisor\app\bootstrap.mjs. Preserve its key-loading code and source unchanged. The server defaults this capability to disabled even when the existing city upstream is enabled.
3. Restart only the CityManagerSignalReport task/process after reviewing the source/runtime file hashes. Existing official upstream https://api.opentyphoon.ai/v1/chat/completions and model typhoon-v2.5-30b-a3b-instruct remain fixed.
4. Verify CORS, preserved schema1 validation and a single fixed synthetic schema2 request over the existing public route, requiring real mode ai and validated snapshot/evidence references. A safe fallback does not count as successful live-provider acceptance. Do not retry an uncertain request automatically.
5. Publish the reviewed frontend with VITE_CITY_ENTITY_ADVISOR_ONLINE=true only after the adapter contract is active and validated; then check one actual public inspector interaction and mobile rendering.

No new API route, Apache mapping, hostname, TLS certificate, port, firewall rule, login, password, usage quota, credential or key-file copy is proposed. No shared WebAi service change is needed. Request/response/time bounds and fallback are operation reliability controls. Requests stay user-triggered; simulation and finance mutations remain deterministic game code.

Exact body fields, output ID catalogs, mock tests and screenshot evidence are documented with the contract/test deliverables. [Synthetic browser-to-adapter example](entity-example-request.json) and [provider-visible example](entity-example-provider.json) show the actual field boundary without any credential or full save. Keep a private rollback copy of the prior server/bootstrap and sanitized deployment/acceptance metadata. Any change to the credential source, network or transmission scope requires review.
