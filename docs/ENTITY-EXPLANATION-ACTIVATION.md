# Selected-entity explanation: activation review

This draft adds a read-only inspector explanation on commercial-L1/save-v5 main8fd3367ad2cf387e2d3fc3134e9b4d69409800dd. PR14 was merged by its owner; this branch was rebased afterwards and uses the canonical card projector/isMarket/capacity rather than defining its own zone/level taxonomy. No separateT tool or automatic market-to-shop upgrade is added. Migration-aware tests retain old retail card coverage.

## Current delivery boundary

The panel captures only after a manual click. Default production builds compute locally; entity remote calls are disabled unless VITE_CITY_ENTITY_ADVISOR_ONLINE is exactly true. Existing city reports and local fact questions keep their current behavior. Mock development may enable the new flag, with all report/provider traffic intercepted. No activation, upstream entity call, service/credential/security change, merge or public deployment is part of this draft.

## Proposed contract extension

Reuse POST https://157.85.96.139:5444/api/city-advisor/report. Schema1 city snapshots remain unchanged. A schema2 operation named entity-explanation would carry one bounded selected-entity snapshot: identity/type, captured tick, inclusive accounting window, allowlisted numeric facts/units, missing-data flags, evidence references and a content-bound snapshot key. Do not send the save, RNG, account table, wallet identifiers, raw ledgers, household arrays, entity names or arbitrary user prompts.

This is expanded data transmission and requires review before activation. The provider receives the allowlisted evidence/candidate catalog for this operation, not the full city state. It may select observed-fact, explicitly hypothetical cause and next-check IDs. Validators bind returned IDs to the captured evidence and exact snapshot identity; fixed Thai templates retain actual numbers, units and periods. Unavailable evidence remains missing, never zero. Cash boundary flows are not profit or a financial statement.

## Exact proposed deployment changes, after approval only

1. Copy reviewed server.mjs, entity-report.mjs and entity-contract.mjs into C:\ProgramData\CityManagerAdvisor\app\src, preserving the existing bootstrap/key source and all other services.
2. Add the non-secret setting CITY_ADVISOR_ENABLE_ENTITY_EXPLANATION=true to the configuration passed to configFromEnv by the existing isolated Node bootstrap at C:\ProgramData\CityManagerAdvisor\app\bootstrap.mjs. Preserve its key-loading code and source unchanged. The proposed server defaults this capability to disabled even when the existing city upstream is enabled. This is a proposed bootstrap configuration change; the production bootstrap has not been edited for this draft.
3. Restart only the CityManagerSignalReport task/process after reviewing the source/runtime file hashes. Existing official upstream https://api.opentyphoon.ai/v1/chat/completions and model typhoon-v2.5-30b-a3b-instruct remain fixed.
4. Publish the reviewed frontend with VITE_CITY_ENTITY_ADVISOR_ONLINE=true only after the adapter contract is active and validated.

No new API route, Apache mapping, hostname, TLS certificate, port, firewall rule, login, password, usage quota, credential or key-file copy is proposed. No shared WebAi service change is needed. Request/response/time bounds and fallback are operation reliability controls. Requests stay user-triggered; simulation and finance mutations remain deterministic game code.

Exact body fields, output ID catalogs, mock tests, screenshot evidence and final source heads are documented with the contract/test deliverables before activation. [Synthetic browser-to-adapter example](entity-example-request.json) and [provider-visible example](entity-example-provider.json) show the actual field boundary without any credential or full save. Any delta from this plan requires a new review; nothing above has executed on production.
