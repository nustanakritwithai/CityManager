# map-story-motion engine (ต้นแบบรอบทดสอบ)

ตัวเล่นคลิปแผนที่ที่ทุกภาพเป็นฟังก์ชันของเวลา t ตัวเดียว `window.seek(t)` ให้ภาพเดิมทุกครั้ง จึงเรนเดอร์ทีละเฟรมด้วย Chromium แบบ headless ได้

```bash
npm install
# ดาวน์โหลด Natural Earth 10m ลง .cache/ne แล้ว
node scripts/prepare-geo.mjs                                  # สร้าง geo/*.json
node scripts/serve.mjs ../tai-kadai-war/story.yaml            # preview: http://127.0.0.1:5180/?preview=1 (Space = เล่น)
node scripts/render.mjs ../tai-kadai-war/story.yaml --stills  # ภาพนิ่งและ contact sheet อยู่ใน out/stills-* ใหม่ ดูตำแหน่งจากผลคำสั่ง
node scripts/render.mjs ../tai-kadai-war/story.yaml --workers 4 --out clip   # MP4 + .srt
```

| ไฟล์ | หน้าที่ |
|---|---|
| `player/app.js` | ไทม์ไลน์ กล้อง (fly/pan/hold, pitch, orbit, focus) ชั้นแผนที่ หมุด เส้นทาง การ์ด ซับ ป้ายกันชน |
| `player/tactical.js` | ธงหน่วยทัพ บล็อกทัพจัดแถวบนพื้น (3 มิติ) เขตศึกที่ลุกลาม วิถีธนู กล่องความสูญเสีย คำบรรยายกลางจอ |
| `player/kit.js` | ภาพประกอบเวกเตอร์ (ทัพเดินแถว ป่ากลางคืน ผู้ลี้ภัย เมืองท่า) และไอคอนโพลารอยด์ |
| `scripts/serve.mjs` | เซิร์ฟเวอร์ preview + แคชภาพดาวเทียมและข้อมูลความสูง |
| `scripts/render.mjs` | เรนเดอร์ขนานหลายแท็บ → ffmpeg → MP4, ไฟล์ซับ .srt |

แหล่งข้อมูล: NASA Blue Marble และ Sentinel-2 cloudless 2016 (EOX, CC BY 4.0), Terrain Tiles (AWS open data), Natural Earth (สาธารณสมบัติ), ฟอนต์ Kanit / IBM Plex Sans Thai / Noto Serif SC (OFL)
