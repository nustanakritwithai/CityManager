# Selected-entity explanation: activation review

This draft adds a read-only inspector explanation. Source baseline fe3072d920b8e56cf5273c7c34bc93c30e0a8770 includes agriculture/save-v4 and the six building cards. The commercial-level-one implementation is owned by another checkout/thread; this draft uses the canonical card projector rather than defining its own zone/level taxonomy and must be checked against that merged source before release.

## Current delivery boundary

The panel captures only after a manual click. Default production builds compute locally; entity remote calls are disabled unless VITE_CITY_ENTITY_ADVISOR_ONLINE is exactly true. Existing city reports and local fact questions keep their current behavior. Mock development may enable the new flag, with all report/provider traffic intercepted. No activation, upstream entity call, service/credential/security change, merge or public deployment is part of this draft.

## Proposed contract extension

Reuse POST https://157.85.96.139:5444/api/city-advisor/report. Schema1 city snapshots remain unchanged. A schema2 operation named entity-explanation would carry one bounded selected-entity snapshot: identity/type, captured tick, inclusive accounting window, allowlisted numeric facts/units, missing-data flags, evidence references and a content-bound snapshot key. Do not send the save, RNG, account table, wallet identifiers, raw ledgers, household arrays, entity names or arbitrary user prompts.

This is expanded data transmission and requires review before activation. The provider receives the allowlisted evidence/candidate catalog for this operation, not the full city state. It may select observed-fact, explicitly hypothetical cause and next-check IDs. Validators bind returned IDs to the captured evidence and exact snapshot identity; fixed Thai templates retain actual numbers, units and periods. Unavailable evidence remains missing, never zero. Cash boundary flows are not profit or a financial statement.

## Exact proposed deployment changes, after approval only

1. Copy reviewed server.mjs, entity-report.mjs and entity-contract.mjs into C:\ProgramData\CityManagerAdvisor\app\src, preserving the existing bootstrap/key source and all other services.
2. Explicitly enable CITY_ADVISOR_ENABLE_ENTITY_EXPLANATION=true in the isolated adapter process configuration. The proposed server defaults this capability to disabled even when the existing city upstream is enabled.
3. Restart only the CityManagerSignalReport task/process after reviewing the source/runtime file hashes. Existing official upstream https://api.opentyphoon.ai/v1/chat/completions and model typhoon-v2.5-30b-a3b-instruct remain fixed.
4. Publish the reviewed frontend with VITE_CITY_ENTITY_ADVISOR_ONLINE=true only after the adapter contract is active and validated.

No new API route, Apache mapping, hostname, TLS certificate, port, firewall rule, login, password, usage quota, credential or key-file copy is proposed. No shared WebAi service change is needed. Request/response/time bounds and fallback are operation reliability controls. Requests stay user-triggered; simulation and finance mutations remain deterministic game code.

Exact body fields, output ID catalogs, mock tests, screenshot evidence and final source heads are documented with the contract/test deliverables before activation. Any delta from this plan requires a new review; nothing above has executed on production.
