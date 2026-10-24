# งานถัดไป: ชิ้น 4D ชีวิตในเมือง (สเปกพร้อมลงมือ)

สถานะ: **ทำแล้ว** (ใช้โมเดลกล่อง procedural สำหรับรถ ยังไม่ได้เพิ่ม Kenney Car Kit) · ต่อจาก PR #18 (4A–4C) ที่เผยแพร่แล้ว · แผนรวมอยู่ใน [VISUAL-REDESIGN-PLAN.th.md](VISUAL-REDESIGN-PLAN.th.md) ข้อ 8.6

เป้าหมาย: รถ รถบรรทุก คนเดิน และควันโรงงาน **เป็นภาพตกแต่งเท่านั้น** แต่จำนวนและตำแหน่งอิงข้อมูลจริงของวันนั้น ไม่เรียก `random()` ของ sim ไม่แก้ `City` ไม่เข้าเซฟ และต้องบอกในคู่มือว่าไม่ใช่การจำลองรถหรือคนรายตัว

## 1. ข้อมูลจริงที่ใช้ (อ่านอย่างเดียว)
| ภาพ | แหล่งข้อมูล | ที่อยู่ในโค้ด |
|---|---|---|
| รถยนต์ (ไป-กลับที่ทำงาน) | จำนวนแรงงานที่ได้งาน `c.employment` + `c.ownerLabor` | `summary(c).employed` ใน `src/sim.ts` |
| คนเดินบนทางเท้า | ประชากร `summary(c).population` ใกล้บ้าน/ตลาด | `homeOccupancy`, `isMarket` |
| รถบรรทุกสินค้า | `goodsLedger` วันนี้ reason `Wholesale stock delivery`, `Imported shop stock`, `Exported goods` | `src/sim.ts` ~บรรทัด 380–410 |
| รถบรรทุกพืชผล | `cropLedger` วันนี้ kind `trade` (from → to) | `src/agriculture-runtime.ts` ~บรรทัด 88 |
| ควันปล่อง | โรงงานที่ผลิตจริงวันนี้: `economicSignals(c)` reasonId `agriculture.recipe-ready` และ `firmWorkerCount > 0` | `economicSignals` ใน `src/sim.ts` |

เส้นทาง: ใช้เฉพาะถนนที่ `connectedRoads(c)` เชื่อมประตูเมือง หาเส้นทางด้วย BFS บนกริดถนน (ฝั่ง renderer) จากแปลงข้างอาคารต้นทางไปปลายทาง หรือไปประตูเมือง (`GATEWAY`) สำหรับนำเข้า/ส่งออก

## 2. ไฟล์ที่จะสร้าง/แก้
- `src/traffic-plan.ts` **(ใหม่ ฟังก์ชันล้วน ไม่มี PlayCanvas)**: `trafficPlan(city): { cars: number; walkers: Spot[]; trucks: Route[]; smoke: number[] }` และ `roadRoute(city, fromCell, toCell): number[]` (BFS) ใช้ seed จาก `city.seed + city.tick` ผ่าน hash ของตัวเอง
- `src/scene-traffic.ts` **(ใหม่)**: วาดด้วย mesh instance ที่ใช้ร่วมกัน เคลื่อนตาม route ระหว่าง tick; รถวิ่งเลนซ้าย ห่างกลางถนน ±0.35; ไฟหน้ารถตอนกลางคืนผูกกับ `SceneAtmosphere.registerGlow`
- `src/renderer.ts`: เรียก `traffic.update(dt)` และ `traffic.sync(plan)` เมื่อ tick เปลี่ยน ต้อง `renderNextFrame` ต่อเนื่องเฉพาะตอนมีรถวิ่งและคุณภาพ ≥ กลาง
- `src/atmosphere-controls.ts`: เพิ่มสวิตช์ "รถและคนเดิน (ภาพตกแต่ง)" ในเมนูบรรยากาศ เก็บใน `citymanager.visual.v1` (`traffic: boolean`)
- โมเดล: เพิ่มจาก Kenney **Car Kit** (CC0) 3–4 คัน + รถบรรทุก 1 คัน ผ่าน `scripts/prepare-city-assets.mjs` → package 2.1.0 (ปรับจำนวนใน `admit-city-assets.mjs` และ test ที่นับ 41) ถ้าไม่เพิ่ม asset ให้ใช้กล่อง procedural ก่อน
- ควัน: particle แบบ billboard โปร่งแสงเล็กๆ ลอยขึ้นจากตำแหน่งปล่อง (`chimney` ใน `renderer.ts` ตำแหน่ง .68,·,-.62 ของแปลง)
- `index.html` หน้าคู่มือ: เพิ่มย่อหน้า "รถ รถบรรทุก และคนเดินเป็นภาพตกแต่งจากจำนวนจริง ไม่ใช่การจำลองรายคัน/รายคน"

## 3. งบประสิทธิภาพ
- สูงสุด 40 รถ + 12 รถบรรทุก + 60 คนเดิน ต่อฉาก, ใช้ mesh/material ร่วมกัน
- คุณภาพต่ำ (รวมเครื่องที่ไม่มี GPU) **ปิดทั้งหมด** เพื่อไม่ให้ browser suite ที่จับเวลา (`compact`, `context` ช่วงรอ 200ms) ช้าลง
- หยุดอัปเดตเมื่อ pause หรือแท็บถูกซ่อน

## 4. การทดสอบ
- `tests/traffic-plan.test.ts`: จำนวนรถ = f(employed) มีเพดาน, route อยู่บนถนนที่เชื่อมเท่านั้น, ไม่มีรถเมื่อไม่มีถนนเชื่อม, ควันเฉพาะโรงงานที่ผลิตจริง, `serialize(city)` ก่อน/หลังเท่ากัน (ไม่แตะ state/RNG)
- browser suites ทั้ง 8 ชุด + `npm test` + `assets:verify` + build
- ภาพก่อน/หลัง กลางวันและกลางคืน ใน `docs/visual-redesign-preview/after-4d-*.png` (ใช้เมืองที่สร้างจาก sim ~480 วัน เพราะเซฟ ~900 วันเกินโควตา localStorage)

## 5. หลัง 4D
ตามแผน: เฟส 5 (ไอคอนสถานะเหนืออาคาร, overlay ความอุดมสมบูรณ์/การเชื่อมถนน/แปลงพร้อมเกิด/การเข้าพัก, กรอบเขียว-แดง + ราคาตอนวาง) แล้วเฟส 0–3 (CSS tokens, ฟอนต์ไทย, HUD ใหม่, แผงข้อมูลใหม่)
