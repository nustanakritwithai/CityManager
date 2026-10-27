---
name: map-story-motion
description: Turn a news story, history article or "what if" explainer into a vertical map motion-graphic video (MP4) in the style of Thai Facebook Reels / TikTok knowledge pages — satellite map background, camera flying between places, glowing historical borders, pins, routes, faction army tokens and spreading war zones, 3D tilted battle scenes with unit formations and arrow volleys, illustration cards, big Thai titles, highlighted Thai subtitles and Thai voice-over. Use this skill whenever the user wants a clip, reel, short, motion graphic or animated map video that explains events across places — wars, migrations, trade routes, disasters, border changes, the origin of a province's name — even if they only paste an article and say "make a video from this", "ทำคลิปจากเนื้อหานี้", "ทำ motion graphic เล่าเรื่อง", or show screenshots of map videos they like.
---

# map-story-motion

Make a 9:16 map video from source text. The engine in `engine/` renders a `story.yaml` frame by frame in headless Chromium (every frame is a pure function of time, so `window.seek(t)` is exact) and encodes with ffmpeg. Your job is mostly writing a good `story.yaml` and keeping the user in the loop at two checkpoints.

## Workflow

Run every script from inside `engine/` (copy it into the user's project if the skill folder is read-only). The story folder can live anywhere — scripts take its path, and `geo/`, `media/` and `out/` resolve next to `story.yaml`. Paths below write it as `<story>/story.yaml`.

1. **Setup** — `node scripts/setup.mjs`. Installs npm packages and downloads Natural Earth data (~100 MB, once; re-running only checks). It needs node, ffmpeg and Playwright with Chromium; if Playwright is missing, say so rather than improvising another renderer.

2. **Storyboard (checkpoint 1)** — Read the source and draft a table: scene · seconds · what the map shows · card/illustration · subtitle · reference to the source paragraph. Read `references/storytelling.md` first: it covers structure, scene length, which scenes deserve 3D, and the accuracy rules (keep the author's hedges like "อาจ", "น่าจะ", label reconstructions). Show the table and ask the user to confirm before building — wrong facts or places cost a full render.
   Also ask, once, what you can't infer: target length (short reels work best at 60–90 s), whether to credit the author/sources, whether original images the user supplied may appear in the clip.
   If the user says not to wait ("ไม่ต้องรอยืนยัน"), carry on with sensible defaults and put every assumption — places, invented routes, credits, length — in your reply instead.

3. **Places** — `node scripts/geocode.mjs "Guangzhou, China" "Luang Prabang, Laos" …` prints `places:` lines. Ancient places map to a modern stand-in; list every interpretation and anything not found in the storyboard notes so the user can correct it.

4. **Write `story.yaml`** — follow `references/story-schema.md` (every field, with examples). Start from `examples/tai-kadai-war/story.yaml`, which uses almost every feature. Put `build:` specs on river/area layers so the geometry comes from Natural Earth, then:
   ```bash
   node scripts/build-geo.mjs <story>/story.yaml
   node scripts/validate.mjs <story>/story.yaml
   ```
   Geo outputs are never overwritten; choose a new `src` when rebuilding and preserve any existing files. Fix every ERROR. Warnings about long subtitles mean "shorten or split into a list". `build-geo` prints where each river starts and ends: if a river misses its source, the upper reach has its own Natural Earth name — find it with `node scripts/build-geo.mjs --list-rivers w,s,e,n` and add it to `rivers:`.

5. **Stills (checkpoint 2)** — `node scripts/render.mjs <story>/story.yaml --stills` writes one PNG per scene (taken 80% into the scene; `--at 0.3` shows earlier moments, e.g. the first part of a list subtitle) and a contact sheet in a new `out/stills-*/` directory in ~2 minutes. The command prints the exact paths; `scenes.json` maps numbered PNGs to scene IDs and times, and earlier runs remain intact. Look at the sheet yourself first (labels colliding, cards covering the action, a 3D scene where the units are tiny, wrong colours), fix, re-run, then show the user. This is the cheap place to iterate; a video render is not.

6. **Voice (optional, Thai)** — give each scene a `voice:` line: the spoken version of the subtitle with numbers written as words ("ห้าแสน", "ปีเจ็ดร้อยยี่สิบแปด", "คริสต์ศักราช"). Then `node scripts/voice.mjs <story>/story.yaml` reports how each line fits its scene. If many lines run long, either tighten the wording or write a fitted copy with `--fit fitted.yaml` and render that (scenes get longer). Default tempo is 1.5× because Google's Thai voice is slow; `voiceTempo:` on a scene overrides it. The voice is Google Translate TTS — fine for drafts, tell the user to use a licensed voice or their own recording for monetised pages.

7. **Render** — tell the user the time first: on a machine without a GPU expect roughly 1 frame per second (3D scenes slower), so a 90 s clip at 24 fps ≈ 35–60 minutes. Run it in the background and report progress from `out/render.log`:
   ```bash
   node scripts/render.mjs <story>/story.yaml --workers 2 --out <name>
   ```
   Two workers is the sweet spot on 4 cores; more workers fight over the CPU and get slower. Use `--from/--to` to re-render one section while iterating. Each run writes to a fresh `out/render-*/` directory and prints its MP4 path. The `--out` name is a simple filename without a path or extension.

8. **Deliver** — mux the voice without re-rendering video: `node scripts/voice.mjs <story>/story.yaml --mux <printed-mp4-path>`. The mux is written in a fresh `voice-*/` directory next to the input; the command prints the exact path. `--mp3 <file>.mp3` exports the narration alone, the same length and timing as the clip (for editing apps). `--fit` and `--mp3` refuse to overwrite existing files. If the file must go through a chat upload, re-encode to stay under ~30 MB:
   `ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 29 -c:a copy -movflags +faststart small.mp4`.
   Send the MP4 and the `.srt`, and say plainly what you checked (frame count, duration, sampled frames) and what you did not (you cannot watch or listen to it).

## What to be careful about

- **Keep the facts the source's.** Every number, date and place on screen should trace to the source; nothing invented. Battle formations, unit positions and war-zone outlines are illustrations — mark those scenes `era: "… · ภาพจำลองการรบ"` and say in the end card that positions are approximate. Historical borders get `approx: true`.
- **Licences.** Basemaps are NASA Blue Marble (public domain) and Sentinel-2 cloudless 2016 by EOX (CC BY 4.0 — keep the credit line on screen). Do not switch to later EOX years (non-commercial licence) or Esri/Google imagery without telling the user. Images from books are the user's call; don't commit them to a public repository.
- **Render cost drives design.** Stills first, small fixes, then one full render. If the user asks for many changes, batch them.

## Files

- `engine/player/` — `app.js` (timeline, camera, layers, cards, text), `tactical.js` (units, formations, zones, volleys, HUD, callout), `kit.js` (vector illustrations and polaroid icons), `style.css`.
- `engine/scripts/` — `setup`, `geocode`, `build-geo`, `validate`, `render`, `voice`, `serve` (live preview: `node scripts/serve.mjs <story>/story.yaml` then open `http://127.0.0.1:5180/?preview=1`, Space plays).
- `references/story-schema.md` — every story.yaml field.
- `references/storytelling.md` — structure, pacing, style presets, accuracy rules.
- `references/rendering.md` — performance, troubleshooting, delivery.
- `examples/tai-kadai-war/story.yaml` — an 88 s history clip with tactical and 3D scenes.
- `evals/` — three test cases (river explainer, tactical + 3D battle, keeping the source's hedges).
