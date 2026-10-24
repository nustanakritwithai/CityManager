# Local city fact questions (draft)

This second slice is stacked on the captured-signal reading draft PR. Open City > City signals > the city/house/business fact-question disclosure. Pick one of five supported questions and explicitly read the current data. No free-text prompt is sent to Typhoon and no additional API fields or calls are introduced by these question controls.

The local contract accepts schemaVersion1 and a supported intent: city.housing, city.workforce, city.businesses, house.detail or business.detail. Entity questions require an actual building or firm ID. Answers contain a captured day, copied scalar facts with units/source/IDs, explicit missing data, empty hypotheses and limitations. Unsupported intent, missing entity or invalid number is reported honestly rather than becoming zero or an invented explanation.

Housing separates buildings, households and people, including displaced households. Workforce uses actual members, dependents, worker allocations and the disjoint general/manufacturing/retail capability pools from save-v3. Imported assumed capabilities are counted separately; education and training are unavailable. Business facts follow actual firm records and their building/worker references, without fabricating financial statements or causes.

Entity choices refresh when real houses/businesses appear. Reading captures data; the clock only marks that answer stale. Selecting another question/entity or loading a city clears the previous answer. Evidence IDs and source expressions remain optional disclosures. Main labels and controls use at least14 reader units, touch targets44, with normal and wide-layout phone emulation.

Validation:9 focused tests plus inherited regression tests; TypeScript and production build. Start preview at127.0.0.1:4188 and run `node --experimental-strip-types tests/city-questions-smoke.mjs` with CITYMANAGER_SIGNALS_COMMIT set to the tested full SHA. The suite intercepts all inherited report traffic and blocks provider URLs. It checks the five questions against actual state, growth from an empty selector, displaced households, save-v3, stale captures, immutable reads and phone typography. The dedicated City fact questions workflow runs against the exact PR head.

This draft changes no backend contract, provider request, credentials or deployed service. Future free-text/AI answers need a separately reviewed grounding contract before sending any entity data. No merge or deployment is part of this draft.
