# CityManager signal report pilot

Isolated, dependency-free Node 24+ backend prepared for review. It has not been installed as a service, persistently connected to a credential file, or exposed publicly. After separate informed approval, one supervised nonHTTP test used the existing server key in process memory with synthetic signals: HTTP 200, the specified Typhoon 2.5 model, 1.583 seconds, and validated references. Sanitized test metadata was retained in the private execution handoff. No raw provider body or credential was saved. It does not modify CityManager simulation state or accounting. Model use is **disabled by default**.

The first pilot transforms game aggregates into explicit data and neutral signals before advice. The backend calculates trends, three objective threshold conditions, units, observation/comparison windows and missing-data flags. The model may only select existing signal IDs and classify them into their existing category. All Thai/English explanatory text comes from deterministic templates. There are no free-form model claims, severity labels, recommendations, tools or simulation mutations. `hypotheses` is an empty array in this version.

## HTTP contract

`POST /api/city-advisor/report`, `Content-Type: application/json`. No login, signup, password, token or cookie is required. Maximum body is 16 KiB. Unknown fields, arbitrary instructions, entity records and client-selected provider/model/URL are rejected.

```json
{
  "schemaVersion": 1,
  "locale": "th",
  "snapshot": {
    "tick": 120,
    "window": { "startTick": 60, "endTick": 120 },
    "metrics": [
      { "id": "treasury", "value": 500, "unit": "currency", "source": "citymanager.aggregate.v1" },
      { "id": "population", "value": 100, "unit": "people", "source": "citymanager.aggregate.v1" }
    ],
    "prior": {
      "tick": 60,
      "metrics": [
        { "id": "treasury", "value": 700, "unit": "currency", "source": "citymanager.aggregate.v1" }
      ]
    }
  }
}
```

`prior` is optional; its tick must precede `tick` and be inside the declared window. Current values are observations at `tick`; a trend window is exactly prior tick → current tick. Declaring a wider window does not turn snapshot values into period averages or totals. Counts are nonnegative integers; finite currency values are bounded to ±1e12; index values are 0–100. Missing metrics remain missing and are never filled with zero. Every list is bounded to 16 unique known IDs.

| Metric ID | Required unit | Category |
| --- | --- | --- |
| population, employed, unemployed, housingCapacity | people | population/economy as defined in code |
| households | households | population |
| businesses | establishments | economy |
| treasury | currency | economy |
| incomePerTick, expensesPerTick | currency/tick | economy |
| averageHappiness | index_0_100 | wellbeing |
| pollution | index_0_100 | environment |
| trafficPressure | index_0_100 | mobility |

The frontend must map only actual simulation aggregates with these meanings. Unsupported or unavailable game values must be omitted. It must preserve the existing per-household/per-establishment micro simulation. `currency` is the game's unit, not a claim about a fiat currency. `source` records the declared adapter version; the backend explicitly marks these inputs `client_reported_unverified`, not verified ledger evidence.

Response shape:

```json
{
  "schemaVersion": 1,
  "mode": "fallback",
  "snapshotTick": 120,
  "data": {
    "window": { "startTick": 60, "endTick": 120 },
    "provenance": { "input": "citymanager.aggregate.v1", "trust": "client_reported_unverified", "derivation": "city-advisor.rules.v1", "comparisonPriorTick": 60 },
    "metrics": [], "priorMetrics": [], "signals": [], "missingData": []
  },
  "report": {
    "summarySignalIds": [], "groups": [], "observations": [],
    "hypotheses": [], "limitations": []
  }
}
```

Arrays above are illustrative placeholders. Actual output retains all supplied metrics with units/source/observation window, prior values with their own window, deterministic signals, and missing-data flags. Trend IDs are `trend.<metricId>` with numeric `delta`, `direction`, `metricRefs`, category, unit, window and rules provenance. Threshold IDs are `threshold.treasury-negative` (`treasury < 0`), `threshold.net-flow-negative` (`incomePerTick - expensesPerTick < 0`), and `threshold.housing-capacity-exceeded` (`population - housingCapacity > 0`), each with exact rule/value/condition, references and observation window. A true condition is not a severity judgment or a causal conclusion.

Each observation contains existing `signalRefs`, `metricRefs`, `emphasized` and safe template text. Render text as text, never HTML. Keep authoritative balances and state wholly independent of this output. `mode: ai` means validated model selection/grouping succeeded; `fallback` preserves the same deterministic data when disabled, timed out, unavailable or invalid. Malformed input returns an explicit 4xx error. Upstream quota, timeout and provider errors preserve the deterministic fallback report without returning raw provider details. `GET /healthz` never invokes the model and returns only health/configuration booleans.

## Public access and deployment approval

The requested CityManager report route is public: no login, signup, password, JWT, API access token or cookie. CORS is * with Content-Type permitted and no credential mode. All public callers share the upstream provider quota. There are no custom per-user/global/IP usage quotas, account allowlists, or application concurrency gates. Provider limits determine provider availability; quota responses return the local report fallback with no retry.

This remains a specific, read-only signal report API. Client-selected endpoints, models, prompts, arbitrary tool calls, entity records and simulation mutations are rejected by the schema. The provider URL is fixed to **POST https://api.opentyphoon.ai/v1/chat/completions** and model is fixed to **typhoon-v2.5-30b-a3b-instruct**. The server constructs its own Authorization header from its server-only key; the browser does not receive or supply that key. No secret may be placed in client code, public repositories, URLs or logs.

The listener binds only 127.0.0.1, default port8791, separate from existing shared proxy8787. These files do not change a service/task, persistent process, Apache configuration, firewall or credential-file ACL. Parent is reviewing a proposed exact HTTPS route at https://157.85.96.139:5444/api/city-advisor/report on the existing verified TLS5444 endpoint. That route is a proposal, not a deployment claim. Persistently connecting the existing credential and applying network/service configuration still require exact action-time approval. No additional live call was made for this public-access revision.

Server process environment names:

| Name | Meaning |
| --- | --- |
| CITY_ADVISOR_ENABLE_UPSTREAM | Exactly true enables provider calls; defaultfalse |
| TYPHOON_API_KEY | Existing server-only key inherited in process memory; this code never reads or writes an env file |
| CITY_ADVISOR_PORT | Loopback port, default8791 |

No identity-provider, authentication, origin allowlist or model selection configuration is needed. The fixed model ignores any stale model configuration property supplied to the server. The one-shot operator helper rejects a model different from the fixed model.

Operation bounds remain: input16KiB, finite known aggregates and bounded arrays, HTTP request timeout20seconds, header timeout10seconds, provider timeout15seconds, provider response32KiB and maximum output1200tokens. No automatic retry. These bound each operation; they are not user/account usage quotas. Server errors and provider bodies are never logged or returned. There are no request logs. The model can only select/group validated signal IDs; deterministic explanation templates and fallback preserve reference grounding, units, provenance and missing-data flags.

The existing key assignment is at C:\ProgramData\WebAi\typhoon-proxy.env. This adapter does not load that file or copy its multi-project environment. Later approved launch must inherit only TYPHOON_API_KEY from that source into the isolated process, with no second persistent key copy and no unrelated environment values. Do not change the shared WebAi task/configuration as part of this preparation.

## Offline verification and operator interface

npm test uses local ephemeral HTTP listeners and mocked upstream responses only. It does not read the credential file or perform live provider/JWKS calls. npm start is a future manual launch and has not been run for this revision; upstream is disabled by default.

examples/request.json and examples/response.json are paired fictitious fixture data and a real local fallback response. Run npm run example to print that report entirely offline. To save a new report, run node src/offline.mjs examples/request.json --out examples/operator-report.json. The CLI refuses to overwrite existing output, accepts bounded JSON, reads no environment key, and opens no listener or network connection. Pure validateInput, deriveData and buildLocalReport exports remain available.

A nonHTTP supervised one-shot export remains available: await buildOperatorReport(input, {upstreamEnabled:true, apiKey:memoryOnlyKey, model:'typhoon-v2.5-30b-a3b-instruct', maxTokens:400}). It uses the same fixed official destination,15second timeout,no retry,bounded output and selection validation. Enablement is false by default; output cap is1-1200(default500). It reads no environment/file,opens no listener and persists nothing. No live call was repeated during this revision; the prior separately approved synthetic test and its sanitized historical evidence remain valid.

Remaining deployment work: align frontend aggregate mapping/units, obtain exact approval for isolated credential inheritance and persistent runtime/Apache route configuration, then verify the public route without changing the shared simulation/accounting. No new deployed runtime is claimed by these source changes.
