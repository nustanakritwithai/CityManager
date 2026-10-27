# story.yaml reference

A story has six top-level keys. Only `meta`, `places` and `scenes` are required.

```yaml
meta: { ... }       # frame, basemap, credits
places: { ... }     # named points
layers: { ... }     # rivers, areas and lines drawn by the map
factions: { ... }   # sides in a conflict: colour + glyph on their flags
zones: { ... }      # territory that spreads from a point (war zones, campaigns)
scenes: [ ... ]     # the timeline
```

Coordinates are always `[lng, lat]` (longitude first). Colours are names (`gold red violet blue teal orange white river`) or any CSS colour (`"#c9a0ff"` — quote hex values).

## Contents
1. meta · 2. places · 3. layers · 4. factions · 5. zones · 6. scenes (camera, map layers, pins, routes, dots, units, formations, volleys, cards, HUD, text, effects, voice)

## 1. meta
```yaml
meta:
  title: สงครามและการอพยพของไทกะได
  width: 1080          # the player is laid out for 1080×1920; keep these
  height: 1920
  fps: 24              # 24 renders 20% faster than 30 and looks fine for maps
  basemap: bluemarble  # bluemarble (NASA, smooth, max zoom 8) | sentinel2016 (sharper, has cloud patches)
  mapPixelRatio: 0.7   # map canvas resolution; text stays sharp. 0.7 saves time, quality holds
  tint: { color: "#1f3f9a", opacity: 0.32 }   # blue "tactical map" wash over imagery; fades out in 3D scenes
  terrain: { exaggeration: 1.7, shade: 0.4 }  # enables relief + hillshade in tilted scenes
  credits: "ภาพ: NASA Blue Marble · Sentinel-2 cloudless 2016 by EOX · Terrain Tiles (AWS) · Natural Earth"
```
The credit line is shown small above the subtitles on every map scene. Keep the EOX credit whenever any scene uses `imagery: sentinel2016` (CC BY 4.0).

## 2. places
```yaml
places:
  guangzhou: { name: กวางโจว, lng: 113.259, lat: 23.129 }
  kuang:     { name: กวาง, lng: 113.259, lat: 23.129 }   # same spot, different label for another era
  qin_north: { lng: 111.6, lat: 33.4 }                   # no name = a point for arrows/units only
```
`name` is the label pins show. Use `scripts/geocode.mjs` to look places up.

## 3. layers
Drawn by MapLibre, below all overlays. A scene lists the layers it shows in `map:`; a layer fades in when it first appears and out when a scene stops listing it. Rivers draw themselves from source to mouth the first time they appear.

```yaml
layers:
  mekong: { type: river, src: river-mekong, color: river, label: แม่น้ำโขง, labelAt: [99.9, 23.2], labelAngle: 72, draw: 2.6,
            build: { rivers: [Mekong], upstream: [97, 32], clip: [88, 8, 125, 36] } }
  baiyue: { type: area, src: region-baiyue, color: gold, style: hatch, fill: 0.12, label: ไป่เยว่ (คนใต้), labelAt: [113.6, 26.6], approx: true,
            build: { provinces: [{ country: China, names: [Zhejiang, Fujian] }, { country: Vietnam, minLat: 19.9 }] } }
  thai:   { type: area, src: country-thai, color: gold, label: ไทย, labelAt: [101, 15.5],
            build: { countries: [Thailand] } }
  tropic: { type: line, coords: [[95, 23.44], [125, 23.44]], color: white, label: Tropic of Cancer, labelAt: [106.4, 23.62], labelSize: 30 }
```
| field | meaning |
|---|---|
| `type` | `river` (glowing line that draws itself), `area` (filled polygon with neon edge), `line` (dashed line from `coords`) |
| `src` | file name in `<story>/geo/` without `.json` — written by `build-geo.mjs` |
| `build` | how to make `src` from Natural Earth: `rivers: [names]` (+ `upstream: [lng,lat]` to set the drawing direction, `clip: [w,s,e,n]`), `countries: [names or ISO3]`, `provinces: [{country, names?, minLat?, maxLat?, minLng?, maxLng?}]` (+ `clip`). Names are Natural Earth English names (`name_en`), e.g. `Guangxi`, `Nam Ou` |
| `color`, `fill` | area fill opacity (default 0.22) |
| `style: hatch` | diagonal stripes, for a claimed/hypothetical/merged area |
| `pulse: true` | edge glow breathes |
| `label`, `labelAt`, `labelSize` | big coloured name; `approx: true` adds "แนวโดยประมาณ" under it — use for every historical border |
| `draw` | seconds a river takes to draw (default 2.2) |

Labels are placed with collision avoidance (pins win over regions, regions over rivers); a label that cannot fit is skipped for that frame, so if a label never shows, move `labelAt`.

## 4. factions
```yaml
factions:
  qin:     { name: จิ๋น, color: red, glyph: 秦 }
  yue:     { name: ไป่เยว่, color: gold, glyph: 越 }
  local:   { name: คนพื้นเมือง, color: gold }        # no glyph = a dot in the flag
```
Used by `units`, formations and the HUD. One colour per side, consistent through the whole clip. Glyphs render in Noto Serif SC (Chinese characters); keep them to one character.

## 5. zones
Territory revealed by a circle growing out of `from` — reads as a front line or campaign spreading. Drawn in SVG above layers.
```yaml
zones:
  han:     { src: region-nanyue, color: red, from: [113.0, 28.6], grow: 3.0, at: 0.6, fill: 0.42, label: ฮั่นปราบรัฐทางใต้, labelAt: [110.0, 24.6], labelSize: 44 }
  nanzhao: { coords: [[102.0, 23.3], [103.5, 22.9], [105.4, 21.1], [108.6, 23.2], [104.8, 23.4], [102.0, 23.3]], color: violet, from: [102.4, 24.2], grow: 3.4, label: ศึกหนานเจา, labelAt: [105.3, 22.6], approx: true }
```
`src` (with optional `build`) or hand-drawn `coords` (closed ring). `at` = delay after the zone appears, `grow` = seconds to fill. Scenes list zones in `zones: [ids]`.

## 6. scenes
```yaml
scenes:
  - id: s05
    dur: 6                       # seconds
    title: ["ราชวงศ์จิ๋นและฮั่นลงใต้"]      # stays until a later scene sets a new title; "!" prefix = red line
    era: ราว 221 ปีก่อน ค.ศ.               # pill under the title; or { count: [622, 866], prefix: "ค.ศ. ", dur: 3 } to tick
    camera: { center: [112.4, 27.2], zoom: 5.2, move: pan }
    map: [yangtze, baiyue]
    units: [...]
    hud: { title: กำลังพล, rows: [{ f: qin, value: "500,000", note: ทัพของถูซุย }], at: 1.4 }
    sub: "ราว 221 ปีก่อน ค.ศ. จิ๋นให้ **ถูซุย** นำทัพ **500,000** ลงใต้"
    voice: "ราวสองร้อยยี่สิบเอ็ดปีก่อนคริสตกาล จิ๋นให้ถูซุย นำทัพห้าแสนลงใต้"
    ref: §1                      # where in the source this comes from (not rendered)
```

### camera
| field | meaning |
|---|---|
| `center`, `zoom` | target. Zoom 4.8–5.5 = region, 6.5–7.5 = province, 10–12.5 = battlefield |
| `move` | `fly` (default: zooms out mid-way on long jumps), `pan`, `cut` (jump), `hold` (no move). A scene without `camera` keeps the last view and drifts |
| `moveDur` | seconds of the move (default min(2.4, 42% of dur)) |
| `drift` | zoom added slowly during the hold (default 0.12) — keeps still shots alive |
| `pitch`, `bearing`, `orbit` | tilt (0–60), heading, degrees of slow rotation during the hold. Pitch > 0 turns on terrain |
| `focus` | where the target sits on screen, 0–1 from top (default 0.37 so cards and subtitles fit below). Use 0.5 for 3D battle scenes |

### pins
```yaml
pins:
  - { place: guangzhou, style: ripple, color: gold, sub: (ปัจจุบัน), at: 1.8 }
  - { place: annam, color: red, label: อานหนาน (ฮานอย) }
```
`style`: `dot` · `ripple` (rings) · `flash` (pulsing, for uprisings/attacks) · `siege` (rotating ring of diamonds). `small: true` for minor names. A pin with the same `place` (or `id`) in consecutive scenes stays put without popping in again.

### routes
```yaml
routes:
  - { id: qin, path: [qin_north, [112.9, 24.2]], style: army, color: red, curve: 0.08, at: 0.4, draw: 2.2 }
  - { id: tr1, path: [muanglai, luangprabang, nan, sukhothai], style: trade, color: gold, at: 1.0, draw: 2.6 }
```
`style`: `army` (thick, arrowhead) · `people` (dashed migration) · `trade` (light dashed) · `faint` (thin connector; add `arrow: false`). Two points curve by `curve` (− bends the other way); more points pass smoothly through each one. Routes are drawn on the ground, so they foreshorten in 3D.

### dots
Point clusters, e.g. settlements copied from a source map.
```yaml
dots:
  - { id: zhuang, color: blue, at: 1.6, points: [[104.05, 23.79], [104.10, 23.44]], label: จ้วง, labelAt: [104.3, 23.95] }
```

### units (flag tokens)
```yaml
units:
  - { id: qin1, f: qin, at: qin_north, to: [112.8, 26.6], move: [0.5, 7.5], n: 8, r: 40 }
  - { id: qport, f: qin, kind: ship, at: [113.75, 22.55], n: 3, r: 40, appear: 2.4 }
```
`n` tokens scattered within radius `r` px; `to` + `move: [start, seconds]` marches them. `appear` delays the pop-in. Keep the same `id` across scenes to keep a group on screen (give the next scene `at:` = previous `to`).

### formations (3D battle blocks)
`kind: formation` lays a rows × cols block of tiles flat on the ground, with an icon per tile and the faction flag in front. Use in tilted scenes.
```yaml
  - { id: ngN, f: nong, kind: formation, tile: 520, gap: 120, at: [113.26, 23.185], to: [113.26, 23.158], move: [2.8, 3.5], rows: 2, cols: 6, icon: spear }
```
`tile`/`gap` in metres (≈ 500–800 m at zoom 11.5–12.5 makes tiles ~25 px), `icon`: `spear` · `horse` · `bow`, `heading` (degrees, 0 = facing north; defaults to the direction of `to`), `flag: false` hides the flag.

### volleys
Arrow arcs rising between two ground points, staggered over time.
```yaml
volleys:
  - { from: [110.27, 25.14], to: [110.33, 25.18], at: 5.6, dur: 4, n: 20, spread: 500 }
```
`spread` metres of scatter, `flight` seconds per arrow (1.1), `lift` arc height (0.5).

### cards
Pop up in a zone below the map focus (y 860–1360) and leave in the scene's last 0.35 s. Common fields: `at` (delay, default staggered), `until`, `color` (accent), `tilt`.
| type | fields | use |
|---|---|---|
| `panel` | `scene`: `army` (`tunic`, `helmet`, `flag`, `sky: dusk/day`, `count`, `buildings`) · `nightForest` · `refugees` · `port`; `leader: place` draws a dotted line from the pin | wide animated illustration |
| `polaroid` | `icon`: `brokenFlag` `junk` `surname` `stele` `question`; `caption`; place with `xy: [x, y]` or `near: place` + `offset` | small tilted photo-card |
| `stat` | `value` (counts up), `label` | a number |
| `badge` | `text` | pill |
| `quote` | `text`, `by` | quotation from a chronicle |
| `words` | `items: [{w, n}]`, `lead: true` makes the first big | glossary / name cards |
| `image` | `src: /media/file.jpg` (file in `<story>/media/`), `caption` | user-supplied map or photo |
| `titlecard` | `text`, `sub` | named event |
| `summary` | `title`, `items` | numbered recap |
| `sources` | `title`, `items` | end notes / credits |

### HUD and big caption
`hud: { title, rows: [{ f, value, note }], at }` — top-left casualty/strength box, numbers count up from `at`. Map labels avoid it.
`callout: ซุ่มโจมตีกลางคืน` — large italic word in the lower middle, for 3D scenes.

### text
- `title`: list of lines; the first is gold, the next white; prefix `!` for red.
- `sub`: subtitle, `**word**` = gold highlight. A list splits the scene time between parts — use it when a line exceeds ~60 base characters (2 lines).
- `credits: false` hides the credit line (end card).

### effects and imagery
- `fx: [night]` darkens (strength `night: 0.3`), `fx: [shake]` shakes the first 0.9 s.
- `imagery: sentinel2016` cross-fades to sharper Sentinel-2 imagery — use for close-ups (zoom ≥ 9). It has cloud patches in some regions (southern China), so check the still.

### voice
- `voice`: the spoken line (numbers as words). `voiceTempo`: per-scene speed override.
