# Visual preview: city models, natural ground and Thai information cards

Review branch `feat/stylized-city-assets`; no merge or deployment requested for this visual change. Public `main` remains the previously released prototype. Original code and procedural fallback are retained; `src/sim.ts` and its tests are unchanged.

The preview adds six low-poly buildings, one tree and one streetlight from four official Kenney CC0 packs. Runtime GLBs total **568,696 bytes / 8,563 unique-file triangles**, with embedded palettes and shared model resources. Roads gain curbs and directional markings; colors, light, framing and mobile toolbar spacing are adjusted. See [asset sources, licenses and reproduction](../ASSETS.md).

The ground now has original low-contrast grass/soil variation, shared plot pads and soft road/plot transitions. Its three generated textures use about 1.5 MiB with mipmaps and no download. The full grid is hidden in Select/Pan and appears during construction, with separate placement outlines. Flat elevation, picking, road connectivity and saves are unchanged. [Terrain details](../TERRAIN.md).

Thai context cards show actual household/firm wallets, workers, stock, earned wage reserves, spendable cash and last closed-month profit. Rules and labeled money/goods rows are collapsible. Four downloaded [Kenney CC0 GUI icons](../GUI-ASSETS.md) total **1,254 bytes**; type illustrations are original abstract SVG symbols. On mobile, the inspector docks below the town at at most 38vh and temporarily replaces the tool/status bar. Close restores those controls; header/close and save controls stay accessible while details scroll. No fake graphs or new economic systems are added.

## Inspected screenshots

| View | Released procedural version | Visual branch |
|---|---|---|
| Desktop | [Before](before-desktop.png) | [After](after-desktop.png) |
| Mobile viewport | [Before](before-mobile.png) | [After](after-mobile.png) |

![City model close-up](after-closeup.png)

- [Construction grid and road placement](build-grid.png)
- [Household card](mobile-inspector.png), [firm card](mobile-firm.png), [scrolled transaction rows](mobile-ledger.png)
- [Previous asset-only ground/UI](https://github.com/nustanakritwithai/CityManager/blob/35674b6aaa0a218cf2c1e2c0424db242bb8bd7cb/docs/visual-preview/README.md), before this ground/info revision

The before images are retained from release `3e629fd06fa31162241533719344b7cf4ab1c803`. After images were captured from the built preview in installed **Microsoft Edge 155.0.4283.62**, then opened and visually inspected. The camera framing changes intentionally; these are presentation comparisons, not pixel-identical benchmark scenes. The mobile capture is an emulated 390×844 viewport at DPR2, not real-device mobile QA.

## Verification

- `npm test`: **11 passed**, including deterministic replay/save continuation, economic journals, disconnection and demolition.
- `npm run assets:verify`: **passed**, both city and GUI package hashes/licenses/receipts/locks agree: 12 city payload files plus 5 GUI payload files.
- `npm run build`: **passed**, TypeScript and Vite `/CityManager/` output. JS 1,195.81 kB / 320.37 kB gzip, CSS 15.01 kB. The existing Vite >500 kB chunk warning remains; no mobile GPU performance claim is made.
- Normal `npm run test:browser`: **15 groups passed**, eight models loaded, no runtime or console errors. [Machine-readable result and timestamp](browser-models.json).
- `CITYMANAGER_BLOCK_MODELS=1 npm run test:browser`: **15 groups passed** with all eight GLB requests intentionally failed. [Result and timestamp](browser-fallback.json). The eight expected PlayCanvas network-error messages are recorded separately; no unexpected errors occurred. [Procedural fallback screenshot](fallback-desktop.png) was opened and inspected.
- Independent static/integrity review: no blocking findings. `git diff --check`: passed.

Browser checks retain real pointer road drawing, repeated tools, Escape during drag, R/C/I zoning, bulldoze, disconnected explanation, exact save/load, purchases/wages, pan/rotate/zoom, summary keyboard behavior, >=44 CSS-pixel buttons and multi-touch cancellation. Construction tests zoom out through actual controls and assert that gesture endpoints hit the canvas, so HUD occlusion cannot silently pass.

New checks exercise all construction-grid modes without simulation mutation, verify that the selected home remains above the open mobile panel, compare household/firm cards against actual wallet/workforce/inventory/profit/payroll values, load GUI icons under the Pages base path, scroll real transaction rows into view and verify close-button/watermark layering. Selecting a different place resets its details to the top. Screenshots include both observation and construction modes.

Mobile save/load results stay visible and announced inside the open inspector while the tool bar is hidden. Acceptance covers successful saving, an intentionally injected storage-quota rejection, and exact load restoration; the temporary storage override is restored immediately. Review identified and fixed the initially hidden feedback before this revision was submitted.

CI runs normal and blocked-model acceptance against the exact PR source. The branch is a preview pending review; this document does not claim a public visual deployment. The optional game-dev CLI was unavailable; checks use pinned glTF Transform and project integrity scripts, not formal Khronos certification. Cross-browser and real-device performance testing remain future work.
