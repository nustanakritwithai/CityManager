# Compact mobile GUI

งานบน `feat/compact-mobile-gui` เริ่มจากรุ่นสาธารณะ `d40cd6982ce644ed1e555565d48cf2c1efbdc047` เพื่อแก้ปัญหาที่ผู้ใช้พบจริงบน Galaxy S22: แถวข้อมูลใหญ่เกินไป แถบ Save/Load ค้างกินพื้นที่ และแผงที่เปิดเตี้ยจนต้องเลื่อนมาก งานนี้เตรียมเป็น draft PR ยังไม่ merge หรือ deploy และไม่เปลี่ยนประชากร เศรษฐกิจ save schema, asset หรือ dependencies

## พฤติกรรมที่ปรับ

- ย่อ padding, ภาพสัญลักษณ์ และหัวข้อซ้ำภายในแผง ให้ KPI รายชื่อครัวเรือน และรายการบัญชีกระชับขึ้น โดยคงพื้นที่กดอย่างน้อย 44px และข้อความที่อ่านได้
- แถวเงิน/สินค้าแสดงสรุปเหตุการณ์ จำนวน และทิศทางก่อน แตะเพื่อขยายรายละเอียดจริง ไม่ลบวัน คู่บัญชี เหตุผล หน่วย หรือประวัติเดิม การแบ่งหน้าและขอบเขตบัญชีเมือง/ครัวเรือน/บริษัทยังคงเดิม
- แผงบ้าน ครัวเรือน เมือง ความช่วยเหลือ และเกมที่ **เปิดอยู่** ใช้ความสูงเกือบเต็มพื้นที่ `100dvh` โดยเผื่อ safe area มีหัวข้อ/Back/ปิดที่เข้าถึงได้และ body เลื่อนภายใน แผงอาจบังแผนที่ขณะอ่าน; เมื่อปิดต้องคืนแผนที่และเครื่องมือให้ใช้ได้
- ย้าย Save, Load, New และผลการบันทึกไปที่เมนู **เกม** อย่างชัดเจน ไม่คง footer นี้ไว้ในทุกหน้าข้อมูล พฤติกรรม storage เดิมและกล่องยืนยัน New/Cancel ยังคงเดิม
- หน้าจอที่ปิดแผงอยู่ยังเป็น HUD กระชับ การอ่าน/ขยายแถวไม่ควรเปลี่ยนยอดเงิน stock, tick, RNG หรือการเลือกข้อมูลผิดเจ้าของ และการกดค้างระหว่าง 10× ต้องไม่สูญหายเมื่อข้อมูล refresh

ข้อมูลทั้งหมดมาจาก simulation เดิม การย่อแถวคือการเปลี่ยนรูปแบบการอ่าน ไม่ใช่การลดความละเอียดของ journal หรือเติมตัวเลขใหม่ ไม่สร้างจำนวนคนหรือความจุบ้านที่ยังไม่มีในโมเดล

## Baseline ที่ตรวจที่มาแล้ว

[baseline.json](compact-preview/baseline.json) วัดจากเว็บที่เผยแพร่จริงเมื่อ `2026-10-24T07:54:15Z` ด้วย Edge `155.0.4283.62` และ fixture seed `61025` วันที่ `65` ซึ่งมี 6 ครัวเรือนและ 2 บริษัท ค่า SHA-256 ของ fixture คือ `4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0`

Baseline ระบุ source commit `d40cd6982ce644ed1e555565d48cf2c1efbdc047` และ [deployment run 40073201082](https://github.com/nustanakritwithai/CityManager/actions/runs/40073201082) ตรวจเทียบกับ readback ของ deployment artifact ใน `.test-output/release-public/asset-readback.json` แล้ว **HTML hash ตรงกัน และ JS/CSS ตรงทั้ง hash และขนาด** จึงใช้เป็น baseline แบบตรึง ไม่พึ่งเนื้อหาเว็บที่อาจเปลี่ยนภายหลัง:

| ไฟล์ | SHA-256 |
|---|---|
| `index.html` | `c0df6f7fba48942426201703fced4caf2ca27946637f91592a01b9739a1d3604` |
| `assets/index-DiIuMumN.js` | `b1dd3e58ee482d358c6428493fea4c6ca2a11bfca81ab4cd0256b6e97e934565` |
| `assets/index-BRcLCBOp.css` | `fb6fe9d12fe77249d60e5e3d43015e598b3ae423ae466932e5b5ef36fa8464ab` |

กรณี baseline ใช้ viewport **360×740 CSS px**, screen **360×780**, ratio 1 เป็นสมมติฐาน S22-like ที่กำหนดเพื่อทดสอบ ไม่ได้อนุมานจากความละเอียด JPEG หรืออ้างว่าเป็นค่าจอ/zoom จริงของผู้ใช้ จำนวน “เต็มแถว” หมายถึงอยู่ครบภายในพื้นที่ scroll body ณ การเปิดครั้งแรก:

| หน้า | ความสูง body เดิม → Candidate | เนื้อหาที่เห็นเต็มในหน้าแรก: เดิม → Candidate |
|---|---:|---|
| บัญชีเงิน | 412.89 → 675px | แถวเต็ม **1/12 → 12/12** |
| บริษัท | 128.91 → 669.20px | KPI **0/6 → 6/6**; ครัวเรือน **0/5 → 5/5** |
| บ้าน | 128.91 → 669.20px | KPI **0/3 → 3/3**; ครัวเรือน **0/1 → 1/1** |
| ครัวเรือน | 394.50 → 675px | KPI **5/5 → 5/5** |

ภาพ baseline เป็น game-only captures: [เงิน](compact-preview/baseline/s22-ledger.png), [บริษัท](compact-preview/baseline/s22-firm.png), [บ้าน](compact-preview/baseline/s22-house.png), [ครัวเรือน](compact-preview/baseline/s22-household.png) ไม่คัดลอกภาพโทรศัพท์ดิบของผู้ใช้ลงเอกสารหรือ repository

## การตรวจและข้อจำกัด

ผล Candidate ปกติที่บันทึกใน [report.json](compact-preview/candidate/report.json) เมื่อ `2026-10-24T08:14:16.157Z` ใช้ Edge `155.0.4283.62` และ fixture เดียวกับ baseline จึงเปรียบเทียบจำนวนแถวและเนื้อหาบนหน้าแรกได้โดยไม่เปลี่ยนเมือง ตัวเลขในตารางเป็นผลวัดจริง ไม่ใช่ค่าคาดการณ์

| ภาพก่อน | ภาพ Candidate |
|---|---|
| [บัญชีเงิน](compact-preview/baseline/s22-ledger.png) | [บัญชีเงินกระชับ](compact-preview/candidate/s22-ledger.png) |
| [บริษัท](compact-preview/baseline/s22-firm.png) | [KPI และครัวเรือนของบริษัท](compact-preview/candidate/s22-firm.png) |
| [บ้าน](compact-preview/baseline/s22-house.png) | [บ้านและครัวเรือน](compact-preview/candidate/s22-house.png) |
| [ครัวเรือน](compact-preview/baseline/s22-household.png) | [รายละเอียดครัวเรือน](compact-preview/candidate/s22-household.png) |

รายละเอียดเพิ่มเติม: [ขยายรายการเมือง](compact-preview/candidate/global-row-expanded.png), [ขยายรายการบริษัท](compact-preview/candidate/firm-row-expanded.png), [เมนูเกม](compact-preview/candidate/game-menu.png), [viewport สูง 600](compact-preview/candidate/browser-height.png), [viewport สูง 420](compact-preview/candidate/keyboard-height.png), [แนวนอน](compact-preview/candidate/landscape.png), [layout 980 บน screen 390](compact-preview/candidate/wide-request.png) ผู้รวมงานเปิดตรวจภาพหลักทั้งสี่และภาพ wide แล้ว ภาพทั้งหมดเป็น game-only captures ไม่มีภาพโทรศัพท์ดิบของผู้ใช้ถูก commit

- Unit tests **21 ผ่าน**, asset verification และ production build **ผ่าน**
- Browser suites เดิมรวม **33 กลุ่มผ่าน** ทั้ง normal และ blocked-model fallback
- Compact suite ใหม่ **5 กลุ่มผ่าน** ทั้ง normal และ fallback รวมทั้งหมด **38 กลุ่มต่อโหมด**; normal ไม่มี unexpected errors, fallback ไม่มี unexpected errors และมี model-load errors ที่จงใจบล็อก 8 รายการตามคาด
- Fallback compact รอบสุดท้ายบันทึกเวลา `08:15:16 UTC` ใน `.test-output/compact-final/fallback/compact/compact-report.json` ผู้รวมงานตรวจยืนยันผลแล้ว
- Independent review ไม่พบประเด็นค้าง ผล CI ของ commit ที่จะส่ง draft PR ยังรอตรวจหลัง push; เอกสารนี้ไม่อ้างว่าผ่าน CI หรือเผยแพร่ candidate แล้ว

Compact suite ใช้ native expandable disclosures และ trusted browser input จริงทั้ง mouse และ touch แบบจำลอง โดยกดค้าง 200ms ขณะเวลาเดิน 10×: รอบ mouse tick เดิน `74 → 79` และ touch `77 → 82` แต่ DOM row/summary และ journal identity ที่กำลังกดยังคงเดิมจนปล่อยและขยายได้ถูกต้อง นี่ไม่ใช่การเรียก handler ตรงหรือการยืนยันฮาร์ดแวร์ touch ของโทรศัพท์

การตรวจเมนูเกมครอบคลุม Save จริงและ New/Cancel ที่ไม่ทำลายเมือง รวมถึงกรณี layout กว้างซึ่ง targets เทียบกับหน้าจออยู่ประมาณ 44px และกรณี dynamic height เหลือ 420px ที่ปุ่มกลับ/ปิดยังเข้าถึงได้ ปิดแผงแล้วแผนที่และการควบคุมกลับมาใช้ได้

สถานการณ์ที่ suites ครอบคลุม: 360×740 แบบ baseline, viewport เตี้ยลงเมื่อ browser chrome/keyboard กินพื้นที่, แนวนอน, layout กว้าง 980 บน screen 390, รวมถึงจอ desktop ตรวจจำนวนแถว/KPI/ครัวเรือนที่เห็นก่อนเลื่อน การขยายรายละเอียด/scroll เป้ากด 44px เมนูเกมและผล Save/Load/New ปุ่ม Back/Esc และแผนที่/กล้องที่กลับมาใช้ได้หลังปิดแผง ไม่ปิด pinch zoom หรือกำหนด `user-scalable=no`

```sh
npm test
npm run assets:verify
npm run build
npm run preview
```

เมื่อ preview ที่ port 4173 ทำงาน ให้รันอีก terminal **ทีละ suite**:

```sh
npm run test:browser
npm run test:submenus
npm run test:context
npm run test:compact
```

`test:compact` เป็น suite ของ branch นี้ ใช้ `CITYMANAGER_BLOCK_MODELS=1` เพื่อตรวจรูปทรงสำรองควบคู่กัน ผล CI ต้องผูกกับ source commit สุดท้าย การจำลอง viewport/touch ใน Edge ช่วยตรวจ layout/interaction แต่ **ไม่ใช่ physical-phone QA บน S22** และไม่ยืนยัน browser mode หรือ zoom ของผู้ใช้ ต้องให้ผู้ใช้ลองรุ่นที่เผยแพร่แล้วอีกครั้งเมื่ออนุมัติการเผยแพร่
