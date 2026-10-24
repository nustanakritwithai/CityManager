# Selected entity explanation contract — draft

This first slice explains only the selected building or linked household. The authoritative snapshot source is the current canonical card projection in `building-card-data.ts`, not a reconstructed ledger or a complete save. It covers house, household, shop, market, factory and farm cards and deliberately follows the card projector's kind, including future commercial level-one taxonomy changes.

## Request and identity

Proposed POST to the existing `/api/city-advisor/report` route:

```ts
{
  schemaVersion: 2,
  operation: 'entity-explanation',
  locale: 'th',
  snapshot: {
    schemaVersion: 1,
    entity: { kind, id, buildingId, firmId, householdId, cell },
    tick,
    window: { fromTick, toTick, inclusive: true, maxDays: 30, empty },
    facts: [{ id, value, unit, period }],
    missing: [{ id, reason }],
    snapshotKey
  }
}
```

The nested snapshot format and top-level operation version have different roles. Existing schema1 city reports remain untouched. The new body is bounded to16KiB with at most24 observed facts, allowlisted missing fields and an exact identity. Entity fields use local numeric IDs only. Household selection must still link to the exact source house or actual employer/owner workplace and cell; removed relationships cannot silently select another household. The snapshot describes the household and its current home, not the workplace from which its card was opened.

The snapshot key is the canonical complete bounded snapshot content, excluding the key itself. It is a comparison token, not an authentication token. The full snapshot is also compared on response acceptance. Changing a wallet total, stock or worker count on the same tick changes the key; a response for another entity, day, period or fact set is rejected. No wallet identifier, entity name, raw journal/reason, account table, household array, RNG, full save or arbitrary user question is in the contract.

## Facts and accounting meaning

`ENTITY_FACT_DEFINITIONS` in the browser/server-shared `server/city-advisor/src/entity-contract.mjs` is the allowlist. Money stays integer satang; display converts exactly to game credits. Unit values are satang, satang/goods, satang/crops, people, households, positions, goods, crops and boolean. Unit prices have explicit commodity denominators and cannot be confused with cash stocks. A fact's period is snapshot, window or today. Snapshots are client-reported projections, not independently server-verified ledgers; the service validates their schema, identity echo and grounded references rather than certifying the game accounting.

- Cash current is a stock. Inflow/outflow/net cover only the selected wallet boundary during the inclusive trailing window of up to30days. A house uses its currently linked households' combined boundary; it does not mean property ownership value. Internal transfers between those linked wallets are excluded by the canonical projector.
- Cash movements and their difference are never presented as operating profit, a complete financial statement or a forecast. Capital contributions, withdrawals or construction can be cash movements.
- Stocks, occupancy and workforce are current. Employee and owner labor remain separate; dependents are not unemployed. Physical job capacity is not a promise of funded or eligible hiring.
- Goods/crop flows use canonical period boundary sums. Today output/consumption uses actual tick-filtered physical journals. No missing day history is reconstructed.
- Unit prices appear only when the canonical projector can pair actual physical and cash journals unambiguously. Missing/unsafe/ambiguous/non-integer price evidence stays absent, not zero.
- At tick0 there is no period activity; window/today facts are missing with empty-period rather than zero. A genuine observed zero on a valid day stays zero.

Typical captured request sizes are about4KiB and contain20–22 observed facts. Labels, units, evidence text and cash semantics are fixed locally. `entityFactEvidence` resolves each allowlisted ID into a readable Thai number/unit/period or an explicit missing reason.

## Grounded output

The model may select only IDs from `entityExplanationCandidates(snapshot)`:

```ts
{
  observationIds: string[], // at most6, at least1 when observations exist
  hypothesisIds: string[],  // at most3, only conditionally eligible fixed hypotheses
  checkIds: string[]        // at most3, at least1 practical next check
}
```

The server produces `{schemaVersion:2, operation:'entity-explanation', mode, snapshot, report}`. Remote prose, extra values, unknown IDs and invented causes are rejected. Observations, explicitly uncertain possible causes and next checks are rendered from fixed Thai templates using the accepted snapshot. `entityExplanationRows` returns the three groups; every row contains `id`, `text` and `factRefs`.

Initial possible causes are modest and conditional: current cash outflow exceeding inflow may imply cash pressure, a disconnected road may matter to current eligibility, and no allocated workers may matter to current activity. They explicitly do not establish historical causation or a complete explanation of hiring/production. Practical checks link to cash records, access, labor, stocks or missing evidence; no action/mutation tool is returned. Insufficient evidence can produce no observations or hypotheses and a safe next-check message.

## Deployment boundary

This is a new entity-level transmission contract and is disabled by default. The proposed server orchestration strips local entity IDs, cell and snapshotKey before sending to the same official Typhoon endpoint; only kind, captured time/window, allowlisted facts/missing evidence and candidate IDs/text are needed upstream. The provider key, model and existing public no-login route remain server-side and unchanged.

No activation is part of this draft. Required reviewed runtime/frontend changes are listed separately in `ENTITY-EXPLANATION-ACTIVATION.md`. Mock tests cover normal and insufficient evidence, identity/key/period/ref forgery, absent values, same-tick changes, frozen-source immutability and exact money formatting. Existing city report and local fact question contracts remain independent.
