# Storytelling, pacing and accuracy

## Shape of a clip
Short knowledge reels that work follow the same arc:
1. **Hook (3–5 s)** — big title on a wide map, one sentence that frames the question.
2. **Setting (1–2 scenes)** — who was where: areas, rivers, the key definition (e.g. "ไทกะได = ผู้พูดภาษาตระกูลนี้ ไม่ใช่เชื้อชาติ").
3. **Events in order (most of the clip)** — one event per scene: camera moves to it, the thing happens (march, uprising, siege), one number or quote lands.
4. **Consequence** — what changed on the map (migration routes, new borders).
5. **Summary + note (5–9 s)** — recap card, then a short note card (approximations, imagery credits).

Use chapter titles (`title:`) to mark periods; the era pill (`era:`) carries the date. A ticking era (`era: { count: [...] }`) sells a long period in one scene.

## Length and pacing
- 60–90 s total for reels (the user asked to cut a 4:40 draft down — long clips also take hours to render). Pick the 12–15 strongest beats; drop secondary dates rather than speeding everything up.
- 4–8 s per scene. A scene needs roughly: camera move 1.5–2.5 s + the line read. With Thai TTS at 1.5× a 50-character line takes ~4–5 s.
- One idea per subtitle, ≤ 2 lines (~60 base characters). Highlight 1–3 words with `**…**`: names, numbers, the key verb.
- Write `voice:` after the subtitles, then run `voice.mjs` to see which scenes are too short.

## Choosing the look
| content | look |
|---|---|
| wars, invasions, campaigns | `tint` blue tactical map, faction `units`, `zones`, casualty `hud`; 1–3 tilted 3D battle scenes for the climaxes |
| kingdoms and borders | glowing `area` layers with `approx: true`, ticking era |
| migration / trade | `routes` with `people`/`trade` styles, many pins, a wide final zoom |
| one province or town | close zoom, `imagery: sentinel2016`, polaroid cards, `words` cards for names |
| hypothetical ("what if") | `style: hatch` for the imagined part, and say "สมมติ" in the title |

3D scenes are expensive to render (≈2× a flat scene) and only read well at zoom 11.5–12.5 with `focus: 0.5`, so use them for 1–3 key moments, not for every event.

## Accuracy rules
These matter more than polish — the clips get shared as facts.
- Everything shown as fact (numbers, dates, names, who did what) traces to the source. Add `ref:` to each scene so it can be checked.
- Keep the source's hedges. If it says "อาจ", "น่าจะ", "มีส่วน", "แม้ไม่ใช่ทั้งหมด", the subtitle and the voice say it too.
- Anything you constructed is labelled: historical borders (`approx: true` → "แนวโดยประมาณ"), battle layouts and unit positions (`era: … · ภาพจำลองการรบ`; if the source names no location, say "ต้นฉบับไม่ระบุสถานที่"), war zones (`approx: true`). The end card repeats this.
- Ancient place names map to modern stand-ins; list each mapping for the user at checkpoint 1 and flag what you could not find.
- Casualty numbers appear as numbers only — no gore in illustrations.
- Present-day disputed borders: draw with a dashed `line`, don't assign them.
- Fix obvious typos in on-screen text (keep a list for the user), never change the meaning.
- Credits: the map imagery credit stays on screen (licence). Author/source credit is the user's decision — ask once.
- Images the user supplies from books or other channels: use them only if the user says so; don't push them to public repositories.
