# Small GUI asset package

Four unmodified PNGs from [Kenney UI Pack](https://kenney.nl/assets/ui-pack), version 2.0, creation date recorded upstream as `12-06-2024`. Author: **Kenney**. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The bundled `public/assets/kenney-ui/License.txt` explicitly permits personal, educational and commercial use; attribution is optional. Credit is retained here. No Kenney logo is used.

Only these images and the original license are admitted. No complete UI pack, fonts, scripts or executable content are shipped.

| Runtime file | Original ZIP path | Dimensions | Bytes |
|---|---|---:|---:|
| `status-ok.png` | `PNG/Green/Default/icon_checkmark.png` | 20x18 | 377 |
| `status-alert.png` | `PNG/Red/Default/icon_cross.png` | 18x18 | 350 |
| `arrow-up.png` | `PNG/Extra/Default/icon_arrow_up_light.png` | 34x22 | 276 |
| `arrow-down.png` | `PNG/Extra/Default/icon_arrow_down_light.png` | 34x22 | 251 |

Runtime image budget: **1,254 bytes**, with a maximum dimension of 34 pixels. Including the 565-byte license, copied upstream payload is **1,819 bytes**. Manifest and receipt are small project-authored metadata. Images are byte-identical to upstream; UI CSS may rotate or scale their display without modifying the files.

The exact official archive was `kenney_ui-pack.zip`, 1,229,750 bytes, from:

`https://kenney.nl/media/pages/assets/ui-pack/f651646eab-1718203990/kenney_ui-pack.zip`

Archive SHA256: `a8a14a234911eb648c062622915c93e79e94e97cb7f9f375a70f6617f1174318`.

`manifest.json` records source/version, archive hash, original paths, sizes, dimensions and SHA256 for every file, with an empty modifications list. `receipt.json` binds the manifest bytes. `gui-asset-lock.json` binds the admitted manifest and receipt to this exact project destination.

## Admission and verification

The archive was inspected and only five exact entries were extracted to `%TEMP%/citymanager-gui-stage/candidate`. The candidate passed a dry-run before the specifically authorized copy:

```sh
node scripts/admit-ui-assets.mjs
node scripts/admit-ui-assets.mjs --confirm
node scripts/admit-ui-assets.mjs --verify
```

Default mode is dry-run; it never copies. `--confirm` admits only this exact package and refuses an existing destination or lock. `--verify` needs no source ZIP or network: it validates the project's closed seven-file roster (four PNGs, license, manifest, receipt), pinned byte hashes, PNG signature/IHDR/IEND and dimension bounds, CC0 marker, receipt and lock. Unknown files, missing files, symlinks, modified bytes or an escaped destination are rejected.

This is a project-specific copied-byte integrity gate. The `game-dev` CLI is unavailable and formal Game Development Studio admission is **not** claimed. Integrity does not establish browser rendering, artistic approval or accessibility; those are verified separately by the parent UI task. No simulation behavior is changed by this package.
