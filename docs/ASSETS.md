# CityManager visual assets

This visual branch combines original CityManager code/procedural geometry with 41 **Kenney CC0** models (package 2.0.0). It changes presentation only: stable model variants derive from parcel coordinates, do not consume simulation RNG, and do not change economic rules or save schema. The branch is not merged or deployed; the existing `main` remains the public version. Preview evidence is collected in [visual-preview](visual-preview/).

## Sources and licenses

The models come from official Kenney downloads, recorded in the [full manifest](../public/assets/kenney-city/manifest.json). Each source archive's SHA-256, original model SHA-256, prepared file hashes, versions and source URLs are retained there. The license is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The four original license texts are preserved unmodified:

| Official pack | Version | Included original license |
|---|---|---|
| [City Kit Suburban](https://kenney.nl/assets/city-kit-suburban) | 2.0 | [suburban.txt](../public/assets/kenney-city/licenses/suburban.txt) |
| [City Kit Commercial](https://kenney.nl/assets/city-kit-commercial) | 2.1 | [commercial.txt](../public/assets/kenney-city/licenses/commercial.txt) |
| [City Kit Industrial](https://kenney.nl/assets/city-kit-industrial) | 2.0 | [industrial.txt](../public/assets/kenney-city/licenses/industrial.txt) |
| [City Kit Roads](https://kenney.nl/assets/city-kit-roads) | 2.2 | [roads.txt](../public/assets/kenney-city/licenses/roads.txt) |

Kenney is credited here although these license texts do not require attribution. These are not Cities: Skylines assets. From the Roads pack, the streetlight and seven road tiles are used as road surfaces; the road graph, connectivity and costs remain project data, and the tile choice/rotation is derived from each parcel's real road neighbours (`src/road-tiles.ts`). Procedural road boxes remain the fallback.

## Original files and runtime names

Original paths below are relative to each downloaded pack. Prepared files live under `public/assets/kenney-city/models/`.

Package 2.0.0 keeps the eight 1.0.0 runtime files byte-identical and adds per-level building families, market details, factory details, a large tree, a planter and road tiles. Visual level picks the family (R 1–3, retail C 2–4 → 1–3, I 1–3); a parcel hash picks the variant inside it, so a higher level is always a larger model and the sim RNG is never used.

| Pack | Original file | Runtime file | Bytes | Triangles |
|---|---|---|---:|---:|
| Suburban | `Models/GLB format/building-type-a.glb` | `house-a.glb` | 76,296 | 1,174 |
| Suburban | `Models/GLB format/building-type-e.glb` | `house-b.glb` | 104,240 | 1,731 |
| Suburban | `Models/GLB format/building-type-h.glb` | `house-c.glb` | 55,600 | 770 |
| Suburban | `Models/GLB format/building-type-m.glb` | `house-d.glb` | 74,384 | 1,112 |
| Suburban | `Models/GLB format/building-type-c.glb` | `house-e.glb` | 77,064 | 1,196 |
| Suburban | `Models/GLB format/building-type-u.glb` | `house-f.glb` | 88,760 | 1,332 |
| Suburban | `Models/GLB format/building-type-k.glb` | `house-g.glb` | 68,160 | 1,024 |
| Suburban | `Models/GLB format/building-type-r.glb` | `house-h.glb` | 69,736 | 1,030 |
| Suburban | `Models/GLB format/building-type-l.glb` | `house-i.glb` | 82,132 | 1,310 |
| Commercial | `Models/GLB format/building-a.glb` | `shop-a.glb` | 80,336 | 1,252 |
| Commercial | `Models/GLB format/building-d.glb` | `shop-b.glb` | 73,660 | 1,100 |
| Commercial | `Models/GLB format/building-b.glb` | `shop-c.glb` | 81,120 | 1,276 |
| Commercial | `Models/GLB format/building-c.glb` | `shop-d.glb` | 76,504 | 1,195 |
| Commercial | `Models/GLB format/building-f.glb` | `shop-e.glb` | 110,596 | 1,794 |
| Commercial | `Models/GLB format/building-g.glb` | `shop-f.glb` | 119,868 | 2,006 |
| Commercial | `Models/GLB format/building-h.glb` | `shop-g.glb` | 93,636 | 1,512 |
| Commercial | `Models/GLB format/building-skyscraper-a.glb` | `tower-a.glb` | 84,856 | 1,292 |
| Commercial | `Models/GLB format/building-skyscraper-e.glb` | `tower-b.glb` | 78,704 | 1,156 |
| Commercial | `Models/GLB format/building-skyscraper-c.glb` | `tower-c.glb` | 108,076 | 1,704 |
| Commercial | `Models/GLB format/detail-parasol-a.glb` | `parasol-a.glb` | 17,736 | 96 |
| Commercial | `Models/GLB format/detail-parasol-b.glb` | `parasol-b.glb` | 19,096 | 120 |
| Commercial | `Models/GLB format/detail-awning.glb` | `awning.glb` | 15,160 | 40 |
| Industrial | `Models/GLB format/building-a.glb` | `factory-a.glb` | 124,696 | 2,046 |
| Industrial | `Models/GLB format/building-d.glb` | `factory-b.glb` | 77,096 | 1,158 |
| Industrial | `Models/GLB format/building-h.glb` | `factory-c.glb` | 53,740 | 698 |
| Industrial | `Models/GLB format/building-g.glb` | `factory-d.glb` | 82,120 | 1,242 |
| Industrial | `Models/GLB format/building-l.glb` | `factory-e.glb` | 118,748 | 1,896 |
| Industrial | `Models/GLB format/building-f.glb` | `factory-f.glb` | 100,196 | 1,552 |
| Industrial | `Models/GLB format/chimney-medium.glb` | `chimney.glb` | 21,656 | 160 |
| Industrial | `Models/GLB format/detail-tank.glb` | `tank.glb` | 31,704 | 310 |
| Suburban | `Models/GLB format/tree-small.glb` | `tree.glb` | 16,132 | 42 |
| Suburban | `Models/GLB format/tree-large.glb` | `tree-large.glb` | 16,136 | 42 |
| Suburban | `Models/GLB format/planter.glb` | `planter.glb` | 25,080 | 204 |
| Roads | `Models/GLB format/light-square.glb` | `streetlight.glb` | 16,240 | 60 |
| Roads | `Models/GLB format/road-straight.glb` | `road-straight.glb` | 15,408 | 44 |
| Roads | `Models/GLB format/road-end.glb` | `road-end.glb` | 15,180 | 42 |
| Roads | `Models/GLB format/road-bend-sidewalk.glb` | `road-corner.glb` | 23,392 | 220 |
| Roads | `Models/GLB format/road-intersection-path.glb` | `road-tee.glb` | 21,704 | 204 |
| Roads | `Models/GLB format/road-crossroad-path.glb` | `road-cross.glb` | 24,756 | 276 |
| Roads | `Models/GLB format/road-crossing.glb` | `road-crossing.glb` | 17,944 | 104 |
| Roads | `Models/GLB format/road-square.glb` | `road-square.glb` | 14,840 | 36 |
| **Total** | | **41 GLBs** | **2,472,488** | **35,558** |

These are unique-file totals, not a whole-scene triangle or draw-call budget. The runtime-byte figure excludes the manifest, receipt and four license files. Each prepared GLB is self-contained, with its palette PNG embedded and no external image/buffer URI. Embedding the palette makes the tiny tree and streetlight files larger than their original GLBs; it avoids separate runtime palette requests.

Preparation uses pinned glTF Transform 4.5.1 `weld`, `dedup` and `prune`, then uniformly normalizes the largest horizontal footprint to one unit and centres the pivot on the ground. This is not triangle decimation: triangle counts remain unchanged. Runtime rendering fits models to their parcels, preserves the chosen silhouette across building upgrades, and changes visual height from the existing building level. Loaded instances share model resources. Missing, invalid or timed-out models leave the original procedural building/tree fallback available; asset loading does not block city simulation.

## Integrity and reproducibility

Run the existing-package check after installing the lockfile dependencies:

```sh
npm ci
npm run assets:verify
```

The command runs `node scripts/admit-city-assets.mjs --verify` and the separate [GUI package gate](GUI-ASSETS.md). The city gate checks the closed file roster, file byte sizes/SHA-256 values, manifest-to-receipt hash, manifest-to-[asset-lock.json](../asset-lock.json) hash, GLB header/version/length, self-contained image/buffer declarations, license markers, package limits, declared bounds and model counts. The [receipt](../public/assets/kenney-city/receipt.json) records 45 payload files: 41 models plus four licenses. Manifest and receipt themselves are additional package metadata. Original runtime-generated ground textures are described in [Terrain](TERRAIN.md).

`.gitattributes` preserves this package's bytes without newline conversion, including whitespace in the original license texts. The staged Git payload and manifest hashes were also checked, so Windows checkout normalization cannot invalidate the receipt.

To prepare the same selection from original archives, use [prepare-city-assets.mjs](../scripts/prepare-city-assets.mjs). It takes no arguments and does not download archives. Place the four archives as `suburban.zip`, `commercial.zip`, `industrial.zip` and `roads.zip` under the operating-system temporary directory's `citymanager-kenney-stage/`. Compare their hashes with `sources.*.archiveSha256` in the committed manifest first. For each pack, place the selected source GLBs directly under `citymanager-kenney-stage/raw/<pack>/`, together with the archive's `License.txt` and the GLBs' relative `Textures/colormap.png`. The manifest retains their original archive paths even though staging is flattened.

```sh
node scripts/prepare-city-assets.mjs
node scripts/admit-city-assets.mjs
```

The first command writes `citymanager-kenney-stage/candidate/`; the second performs a **dry run** against that candidate without copying it into the project. There is no `--dry-run` flag. To admit into a project where `public/assets/kenney-city/` does not already exist:

```sh
node scripts/admit-city-assets.mjs --confirm
```

`--confirm` copies the candidate and writes `asset-lock.json`; it refuses to overwrite an existing destination. For this already-vendored checkout, use `npm run assets:verify` instead. Preparation records fresh timestamps, so a regenerated manifest/receipt hash can differ even when the prepared model bytes match. Keep the regenerated receipt and lock consistent rather than claiming byte-identical metadata.

The optional **game-dev CLI was unavailable**, so these project scripts and glTF Transform were used. This is a project integrity/geometry policy check, not formal Khronos glTF Validator certification or game-dev CLI admission. Browser rendering and mobile-viewport evidence are reported separately by the parent QA workflow; viewport simulation is not real-device mobile QA.
