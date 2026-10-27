# Rendering, performance and delivery

## How a frame is made
`render.mjs` starts the local server (`serve.mjs`), opens N Chromium pages at 1080×1920, and for each frame calls `window.seek(t)`, waits until every tile source (imagery, terrain, GeoJSON) is loaded and drawn, takes a JPEG screenshot and pipes it to ffmpeg. Segments are concatenated at the end and an `.srt` is written from the subtitles. Satellite and terrain tiles are cached in `engine/.cache/`, so a second render of the same area is faster.

## Expected speed (no GPU, 4 cores)
| scene type | ≈ per frame |
|---|---|
| flat map scene | 0.8–1.2 s |
| tilted 3D scene with terrain | 1.5–3 s |
| first frame of a new area | +5–15 s (tile download) |

A 90 s clip at 24 fps (2,160 frames) took about 60 minutes. Always tell the user the estimate before starting, run it in the background, and quote progress from `out/render.log` when asked.

What actually helps:
- `--workers 2`. Four workers were slower than two (software GL already uses all cores).
- `fps: 24` and `mapPixelRatio: 0.7` in `meta`.
- Terrain is switched on only around scenes with `pitch > 0`.
- Iterate with `--stills` and `--from/--to` on one section; render the whole clip once.
- A machine with a GPU is many times faster: drop the `--use-angle=swiftshader` flags in `render.mjs` there.

## Troubleshooting
| symptom | cause / fix |
|---|---|
| `validate` says geo file missing | add a `build:` spec and run `build-geo.mjs`; check the Natural Earth English name |
| river draws backwards | set `upstream:` near the source |
| a label never appears | it collides with a pin, HUD or era pill — move `labelAt` |
| 3D units tiny / far away | zoom 11.5–12.5, `focus: 0.5`, bigger `tile` |
| grey or white patches in close-ups | Sentinel-2 2016 clouds — move the camera or stay on `bluemarble` |
| Chinese glyphs show as boxes | Noto Serif SC not installed — run `setup.mjs` again |
| render stuck on first frames | tile host slow; the cache fills and it speeds up. Check network with `curl -I https://tiles.maps.eox.at` |
| TTS fails with certificate or WebSocket errors | behind a proxy, set the proxy's CA for node (`NODE_EXTRA_CA_CERTS`); edge-tts style WebSocket voices may be blocked — `voice.mjs` uses plain HTTPS |

## Delivery
- `voice.mjs --mux clip.mp4` adds the voice track without re-encoding video.
- Chat uploads often cap around 30 MB: `ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 29 -c:a copy -movflags +faststart small.mp4` (≈ 20 MB for 90 s). Keep the full-quality file too.
- Facebook/TikTok accept 1080×1920 H.264 + AAC directly; upload the `.srt` separately if the platform supports captions.
