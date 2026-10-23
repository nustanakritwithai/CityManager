# First playable verification

Verified locally on 23 October 2026. This bounded prototype is submitted as a draft PR, with no gameplay deployment or merge.

## Commands and outcomes

- `npm test`: **11 passed, 0 failed** (Node 24). Covers seeded replay/save continuation, roads/repeated costs, disconnected growth, utilities, individual transactions, money/stock reconciliation, demolition, corrupt saves, prorated wages/payroll reserves, forged claims/journals, and the UI seed plus eight other seeds through 65/180 days.
- `npm run build`: **passed**, including TypeScript checking and Vite production bundling for `/CityManager/`. Largest JS chunk: 1,100.29 kB, 289.42 kB gzip; Vite reports its standard >500 kB chunk warning.
- `npm run test:browser` (with `npm run preview` on port 4173): **12 acceptance groups passed**, 0 runtime/console errors. Installed headless Microsoft Edge `155.0.4283.62`, PlayCanvas `2.23.3`. Final run: `2026-10-23T22:02:26.901Z`. Machine-readable result: [browser-report.json](browser-report.json).
- `git diff --check`: no whitespace errors.

## Browser coverage

Real WebGL2 startup; pause/speeds; new-city cancel/Escape; two-stage road cancel; repeated road costs; Escape while dragging a pending road; R/C/I zoning; repeated bulldoze; drag roads/picking; disconnected-growth explanation; exact local save/load; growth, household purchases and monthly wages; pan/rotate/zoom/reset; keyboard Space on help; mobile layout and pinch without accidental construction.

Desktop was 1440x1000. Mobile was an emulated 390x844 viewport at DPR2, with visible controls at least 44 CSS pixels and an unobstructed outside gateway. The mobile camera panel collapses to preserve the playfield. **This is not real-device mobile QA**, and does not establish mobile GPU performance or cross-browser compatibility.

## Visual evidence

- [Desktop city and transaction panel](screenshots/desktop-city.png)
- [Disconnected road and growth blocker](screenshots/desktop-disconnected.png)
- [Mobile viewport](screenshots/mobile-city.png)

Screenshots were opened and visually inspected. The playfield, original buildings, zones, road states, controls and explanation panel are visible. Review fixed a wrapped pause label, mobile framing/obstruction and distant grid depth artifacts. An earlier browser failure exposed the UI seed's shop-worker starvation; a nine-seed regression now guards it.

## Remaining limits

24x24 flat grid, one abstract good, outside market, universally available outside power/water flags, no lane traffic, congestion, curved roads, utility-capacity networks, autonomous closures or full CSII parity. Complete ledgers are bounded by the 12,000,000-character save limit and the browser's lower storage quota. Larger cities and long-duration soak/performance testing remain future stages. No release/deployment workflow is included.
