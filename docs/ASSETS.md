# CityManager visual assets

This visual branch combines original CityManager code/procedural geometry with eight **Kenney CC0** models. It changes presentation only: stable model variants derive from parcel coordinates, do not consume simulation RNG, and do not change economic rules or save schema. The branch is not merged or deployed; the existing `main` remains the public version. Preview evidence is collected in [visual-preview](visual-preview/).

## Sources and licenses

The models come from official Kenney downloads, recorded in the [full manifest](../public/assets/kenney-city/manifest.json). Each source archive's SHA-256, original model SHA-256, prepared file hashes, versions and source URLs are retained there. The license is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The four original license texts are preserved unmodified:

| Official pack | Version | Included original license |
|---|---|---|
| [City Kit Suburban](https://kenney.nl/assets/city-kit-suburban) | 2.0 | [suburban.txt](../public/assets/kenney-city/licenses/suburban.txt) |
| [City Kit Commercial](https://kenney.nl/assets/city-kit-commercial) | 2.1 | [commercial.txt](../public/assets/kenney-city/licenses/commercial.txt) |
| [City Kit Industrial](https://kenney.nl/assets/city-kit-industrial) | 2.0 | [industrial.txt](../public/assets/kenney-city/licenses/industrial.txt) |
| [City Kit Roads](https://kenney.nl/assets/city-kit-roads) | 2.2 | [roads.txt](../public/assets/kenney-city/licenses/roads.txt) |

Kenney is credited here although these license texts do not require attribution. These are not Cities: Skylines assets. Only the streetlight is taken from the Roads pack; the road surface/graph remains project geometry/data.

## Original files and runtime names

Original paths below are relative to each downloaded pack. Prepared files live under `public/assets/kenney-city/models/`.

| Pack | Original file | Runtime file | Bytes | Triangles |
|---|---|---|---:|---:|
| Suburban | `Models/GLB format/building-type-a.glb` | `house-a.glb` | 76,296 | 1,174 |
| Suburban | `Models/GLB format/building-type-e.glb` | `house-b.glb` | 104,240 | 1,731 |
| Commercial | `Models/GLB format/building-a.glb` | `shop-a.glb` | 80,336 | 1,252 |
| Commercial | `Models/GLB format/building-d.glb` | `shop-b.glb` | 73,660 | 1,100 |
| Industrial | `Models/GLB format/building-a.glb` | `factory-a.glb` | 124,696 | 2,046 |
| Industrial | `Models/GLB format/building-d.glb` | `factory-b.glb` | 77,096 | 1,158 |
| Suburban | `Models/GLB format/tree-small.glb` | `tree.glb` | 16,132 | 42 |
| Roads | `Models/GLB format/light-square.glb` | `streetlight.glb` | 16,240 | 60 |
| **Total** | | **8 GLBs** | **568,696** | **8,563** |

These are unique-file totals, not a whole-scene triangle or draw-call budget. The runtime-byte figure excludes the manifest, receipt and four license files. Each prepared GLB is self-contained, with its palette PNG embedded and no external image/buffer URI. Embedding the palette makes the tiny tree and streetlight files larger than their original GLBs; it avoids separate runtime palette requests.

Preparation uses pinned glTF Transform 4.5.1 `weld`, `dedup` and `prune`, then uniformly normalizes the largest horizontal footprint to one unit and centres the pivot on the ground. This is not triangle decimation: triangle counts remain unchanged. Runtime rendering fits models to their parcels, preserves the chosen silhouette across building upgrades, and changes visual height from the existing building level. Loaded instances share model resources. Missing, invalid or timed-out models leave the original procedural building/tree fallback available; asset loading does not block city simulation.

## Integrity and reproducibility

Run the existing-package check after installing the lockfile dependencies:

```sh
npm ci
npm run assets:verify
```

The command runs `node scripts/admit-city-assets.mjs --verify`. It checks the closed file roster, file byte sizes/SHA-256 values, manifest-to-receipt hash, manifest-to-[asset-lock.json](../asset-lock.json) hash, GLB header/version/length, self-contained image/buffer declarations, license markers, package limits, declared bounds and model counts. The [receipt](../public/assets/kenney-city/receipt.json) records 12 payload files: eight models plus four licenses. Manifest and receipt themselves are additional package metadata.

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
