# ตัวอย่างเมนูย่อย Inspector

ดู [แผน GUI ตามภาพอ้างอิง](../CityManager-GUI-Plan-TH.md) และ [ที่มา/ขอบเขตที่รับงานรอบนี้](../GUI-PLAN-SOURCE.md) แผนรวมมีงานระยะถัดไปที่ยังไม่ได้พัฒนา ไม่ใช่รายการฟีเจอร์ที่รับรองแล้ว

หลักฐานชุดนี้บันทึกตอนส่ง `feat/inspector-submenus` ให้ review ก่อน Merge โดยเริ่มจาก `main` ที่เผยแพร่ก่อนหน้า (`737653b`, [PR #2](https://github.com/nustanakritwithai/CityManager/pull/2)) ดู [บัญชีแบบเดิม](../visual-preview/mobile-ledger.png) และ [ภาพ/รายงานรุ่น PR #2](../visual-preview/) เพื่อเปรียบเทียบ สถานะเผยแพร่ล่าสุดตรวจได้จาก GitHub Actions ของ `main`

## สิ่งที่เปลี่ยน

| เมนู | ข้อมูลที่อ่านจากเมืองจริง |
|---|---|
| เงิน | เหตุผล วัน จำนวนเงิน ต้นทางและปลายทาง เริ่ม 12 รายการล่าสุด |
| สินค้า | เหตุผล วัน จำนวนหน่วย ต้นทางและปลายทาง เริ่ม 10 รายการล่าสุด |
| กระเป๋าเงิน | ทุกบัญชี แบ่งคลังเมือง ครัวเรือน บริษัท คู่บัญชีภายนอก และระบบ/บัญชีอื่น |
| วิธีเล่น | ถนน โซน เงื่อนไขเติบโต กล้อง ปุ่มควบคุม และการบันทึก |
| สมมติฐาน | เวลา น้ำ/ไฟภายนอก เงินตั้งต้น สินค้านามธรรม ขอบเขตเมือง และเครดิตภาพ |

เงินและสินค้ามีปุ่ม **เพิ่มรายการ / ดูทั้งหมด / กลับรายการล่าสุด** เพิ่มครั้งละ 12 และ 10 ตามลำดับ การแสดงผลเรียงใหม่ไปเก่าโดยเก็บ index ของ journal เดิม วัน จำนวน และลำดับเดิมไว้ครบ ไม่สร้างยอดขาย รายได้ กราฟ หรือข้อมูลเศรษฐกิจเพิ่มเติม เมื่อไม่มีรายการจะแสดงข้อความว่างที่อธิบายได้

`src/inspector-data.ts` เป็นส่วนจัดข้อมูลล้วน ไม่แก้เมือง: เงินยังเป็นสตางค์จำนวนเต็ม มีทศนิยมสองตำแหน่งและเครื่องหมายตามยอดจริง ทุกบัญชีรวมยอดศูนย์ บัญชีในประวัติ และ `outside` ที่ติดลบยังแสดงครบ ยอดติดลบของ outside เป็นคู่บัญชีในแบบจำลอง ไม่ใช่การอ้างว่าเป็นหนี้เมือง บัญชีบริษัทอาจมีค่าจ้างที่จองไว้ จึงไม่ได้แปลว่าใช้จ่ายได้ทั้งหมด

ทุกหน้าบัญชีระบุชัดว่าเป็น **ข้อมูลทั้งเมือง** การเลือกอาคารไม่ได้กรองให้เป็นบัญชีอาคารนั้น หน้าสถานที่ยังเป็นบริบทเริ่มต้น เมื่อเปิดเมนูย่อยจะเข้าหน้าอ่านเฉพาะส่วนนั้นและซ่อนข้อมูลข้างเคียงชั่วคราว ปุ่ม Back หรือ Esc กลับหน้าสถานที่; Esc ถัดไปปิด inspector กลับแผนที่ การเปลี่ยนสถานที่ปิดเมนูย่อยและเลื่อนกลับด้านบน การเปิดอ่านไม่เปลี่ยนนาฬิกาหรือสถานะ simulation

## หน้าจอและขอบเขต

ใช้ Kenney CC0 GUI เดิม 4 ภาพและสัญลักษณ์ SVG ที่เขียนเอง ไม่มีไฟล์ภาพดาวน์โหลด dependency กฎ simulation หรือ save schema ใหม่ ดู [เครดิต GUI](../GUI-ASSETS.md) หน้าสมมติฐานมีเครดิตและลิงก์ Kenney/CC0 ด้วย

ตัวอักษรเนื้อหาใช้ฐาน 14px และ controls อย่างน้อย 44px พร้อมพื้นที่เลื่อนภายใน การตรวจหนึ่งกรณีใช้ layout กว้าง **980 CSS px** ร่วมกับ `screen.width=390` และ touch=true: UI ปรับขนาดตามหน้าจอเพื่อให้ข้อความ/controls มีขนาดเทียบเท่าฐาน 14/44 บนหน้าจอแคบ นี่คือเงื่อนไขที่ทดสอบจริง ไม่ได้ยืนยันว่าเป็น browser desktop mode ของผู้ใช้หรือทดสอบบนโทรศัพท์จริง

จอสัมผัสแนวนอนที่เตี้ยจำกัด inspector ทั้งหน้ารายการเข้าเมนูและหน้าอ่านด้วย `max-height: calc(100dvh - 20px)` เพื่อให้เลื่อนอ่านและเข้าถึงปุ่มกลับ/ปิดได้ แผงมือถือซ่อนเครื่องมือด้านล่างระหว่างเปิดและคืนให้เมื่อปิด

## หลักฐานสำหรับ review

ภาพและรายงานต่อไปนี้จัดเก็บโดย QA ของ branch นี้ เปิดตรวจภาพของทั้งห้าเมนูแล้ว รวมยอดภายนอกติดลบ วิธีเล่น เครดิตภาพ จอแคบ จอกว้าง และจอแนวนอน ภาพแสดงเนื้อหาจริงที่อ่านและเลื่อนได้ ไม่ได้ถือว่าชื่อไฟล์เพียงอย่างเดียวเป็นหลักฐานว่าผ่าน

| สิ่งที่ตรวจ | ภาพ |
|---|---|
| เงิน / สินค้า | [phone-money](phone-money.png), [phone-goods](phone-goods.png) |
| ทุกกระเป๋าและ outside | [phone-wallets](phone-wallets.png), [phone-wallet-outside](phone-wallet-outside.png) |
| วิธีเล่นและ controls | [phone-guide](phone-guide.png), [phone-guide-controls](phone-guide-controls.png) |
| สมมติฐานและเครดิต | [phone-assumptions](phone-assumptions.png), [phone-attribution](phone-attribution.png) |
| layout 980 บน screen 390 + touch | [เงิน](phone-wide-money.png), [กระเป๋า](phone-wide-wallets.png) |
| จอสัมผัสแคบ / แนวนอน | [touch-360](touch-360.png), [touch-844](touch-844.png) |
| Desktop | [desktop-money](desktop-money.png) |

ผล local ที่รายงานระหว่างเตรียม review:

- `npm test`: **15 ผ่าน** — simulation เดิม 11 และ presenter ใหม่ 4; ตรวจจำนวนเงินแม่นตรง ลำดับรายการ บัญชีครบ และไม่แก้ state
- `npm run assets:verify`: **ผ่าน** โดยไม่เพิ่ม asset
- `npm run build`: **ผ่าน**; CSS 29.25 kB / gzip 6.26 kB, JS 1,219.37 kB / gzip 328.35 kB คำเตือน Vite chunk >500 kB ยังอยู่
- Normal browser acceptance: **15 กลุ่มผ่าน**; [normal-browser.json](normal-browser.json)
- Focused submenu checks: **7 กลุ่มผ่าน** ครอบคลุมจำนวน/ลำดับจริง ทุกบัญชี empty state, Back และ viewport; [normal-submenus.json](normal-submenus.json)
- Blocked-model fallback: **15 กลุ่มเกมเดิมและ 7 กลุ่มเมนูย่อยผ่าน**; [fallback-browser.json](fallback-browser.json), [fallback-submenus.json](fallback-submenus.json) ไม่มี unexpected error; ข้อผิดพลาดโหลดโมเดลที่ตั้งใจบล็อก 8 รายการบันทึกแยกไว้

รันซ้ำหลังเปิด production preview ที่ port 4173:

```sh
npm test
npm run assets:verify
npm run build
npm run preview
```

อีก terminal:

```sh
npm run test:browser
npm run test:submenus
```

ทั้งสองสคริปต์ใช้ Microsoft Edge ที่ติดตั้งไว้และรองรับ `CITYMANAGER_BLOCK_MODELS=1` สำหรับตรวจรูปทรงสำรอง การทดสอบ touch/viewport ไม่ใช่ real-device หรือ cross-browser QA ผล CI และการเผยแพร่ของ commit สุดท้ายต้องตรวจจาก GitHub Actions; รายงาน local เหล่านี้เป็นหลักฐานตอนส่ง review
