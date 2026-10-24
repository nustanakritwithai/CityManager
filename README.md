# CityManager

**สาขารุ่น 0.4.3 — ยังไม่ Merge/เผยแพร่:** แก้วงจรที่งานเต็มแล้วไม่เกิดกิจการใหม่ ด้วยการลงทุนขยายโรงงานจากเงินกิจการจริง พร้อมเหตุผลการรอและเซฟ `6 / growth-1` ที่อ่าน v1–v5 ได้ ดู [กติกาเติบโตและการย้ายเซฟ](docs/GROWTH.md) ตลาดยังเป็นพาณิชย์ **C ระดับ 1** ตาม [PR #14](https://github.com/nustanakritwithai/CityManager/pull/14) ที่เผยแพร่แล้ว ไม่มีโซน T แยก

ต้นแบบเกมสร้างเมือง 3D บนเว็บด้วย **PlayCanvas Engine + TypeScript** เขียนขึ้นใหม่ ได้แรงบันดาลใจด้านการเล่นจาก Cities: Skylines II ผู้เล่นสร้างถนนและกำหนดโซน ส่วนครัวเรือนและกิจการมีสถานะ เงิน และเงื่อนไขเติบโตที่ตรวจสอบได้ ไม่ใช้โค้ด Living City Lab หรือ novel engine และไม่อ้างว่าครบทุกระบบของ CSII

เว็บรุ่นที่เผยแพร่: [เล่น CityManager](https://nustanakritwithai.github.io/CityManager/)

## รุ่นที่เผยแพร่กับงานในสาขานี้

- GUI แยกบ้าน กิจการ ครัวเรือน และภาพรวมเมือง: [PR #4](https://github.com/nustanakritwithai/CityManager/pull/4); แผงมือถือกระชับและเปิดได้สูงขึ้น: [PR #5](https://github.com/nustanakritwithai/CityManager/pull/5)
- สมาชิกครัวเรือน ความจุบ้าน และการย้ายเข้า: [PR #7](https://github.com/nustanakritwithai/CityManager/pull/7), [กติกาครัวเรือน](docs/HOUSEHOLDS.md)
- แบ่งแรงงานตามความสามารถและกระจายไปหลายกิจการ: [PR #9](https://github.com/nustanakritwithai/CityManager/pull/9), [กติกาแรงงานและเซฟ v3](docs/LABOR.md)

ระบบเกษตรเผยแพร่แล้วใน [PR #12](https://github.com/nustanakritwithai/CityManager/pull/12) ใช้ schema `4 / agriculture-1` เพิ่มโซนฟาร์ม **F** และตลาดพืชผล **T** พืชผลใช้ได้ทั้งแปรรูปในโรงงานและบริโภคผ่านตลาด โดยครัวเรือนซื้อรวมเพียงหนึ่งตะกร้าต่อวัน ตลาดใช้ทุนและแรงงานของครัวเรือนเจ้าของ บัญชีครัวเรือนกับกิจการแยกกัน ดู [กติกาเกษตร/ตลาด](docs/AGRICULTURE.md) และ [การย้ายเซฟ v1–v3](docs/AGRICULTURE-SAVES.md)

GUI การ์ดตามประเภทเผยแพร่แล้วใน [PR #13](https://github.com/nustanakritwithai/CityManager/pull/13) เปลี่ยนภายในการ์ดตามบ้าน ครัวเรือน ร้านค้า ตลาด โรงงาน และฟาร์ม ภาพรวมเมืองยังเป็นหน้าแยก ดู [ขอบเขตการ์ด](docs/BUILDING-CARDS.md) และ [ภาพ/ผลตรวจ](docs/building-cards-preview/) รุ่นในสาขานี้ปรับตลาดให้เป็นพาณิชย์ระดับ 1 ต่อจากรุ่นนั้น

## รันและตรวจสอบ

ใช้ Node.js 24 และ npm โดย dependency ถูกล็อกใน `package-lock.json`:

```sh
npm ci
npm run dev
```

เปิด URL ที่ Vite แสดงภายใต้ `/CityManager/` ตรวจหน่วยจำลอง ไฟล์ asset และ production build:

```sh
npm test
npm run test:advisor
npm run assets:verify
npm run build
npm run preview
```

เปิด preview ที่ port 4173 แล้วรัน browser suites ในอีก terminal โดยใช้ Microsoft Edge ที่ติดตั้งอยู่ สคริปต์แยก profile และรายงานไว้ใน `.test-output/` ไม่ดาวน์โหลด browser:

```sh
npm run test:browser
npm run test:submenus
npm run test:context
npm run test:compact
npm run test:population
npm run test:worker
npm run test:agriculture
npm run test:building-cards
```

กำหนด `CITYMANAGER_BROWSER` ได้หากต้องระบุ executable เอง และตั้ง `CITYMANAGER_BLOCK_MODELS=1` เพื่อทวนชุดเดิมในกรณีโมเดลโหลดไม่ได้ การตรวจหน้าสัญญาณใช้ build แยกและ mock/offline ตาม [Signals](docs/SIGNALS.md) โดยไม่เปลี่ยน production `dist/` หรือเรียกผู้ให้บริการระหว่าง QA ผลผ่านต้องอ้างถึง source commit และ CI ของ PR จริง การจำลอง viewport/touch ไม่ใช่การทดสอบ Galaxy S22 เครื่องจริง

## ลองเล่น

1. ต่อถนนจากประตูสีทองด้านตะวันตก โซนต้องมีถนนข้างแปลงที่เชื่อมถึงประตู
2. วาง **R / C / I / F** สำหรับบ้าน พาณิชย์ โรงงาน และฟาร์ม พาณิชย์ใหม่เริ่มเป็นตลาดระดับ 1 โดยใช้ทุนและแรงงานเจ้าของ ฟาร์มต้องมี fertility อย่างน้อย 50% อาคารเกิดเองเมื่อผ่านเงื่อนไข ไม่ใช่การวางบ้านหรือกิจการโดยตรง
3. แตะอาคารเพื่อดูเฉพาะข้อมูลของอาคารนั้น แตะครัวเรือนเพื่อเปิดข้อมูลครอบครัว ส่วนยอดรวมและบัญชีทั้งเมืองอยู่ที่ **ภาพรวมเมือง** วิธีเล่นอยู่ใน **คู่มือ**
4. **กลับ / Esc** ยกเลิกจุดเริ่มถนนก่อน แล้วกลับเครื่องมือเลือก ใช้ **Pan** เพื่อลากกล้อง คลิกขวาลากเพื่อหมุน ล้อเมาส์หรือ pinch เพื่อซูม หรือใช้ปุ่มกล้อง
5. **Pause / 1× / 3× / 10×** ควบคุมเวลา เมนู **เกม** รวมบันทึก โหลด นำเข้าเซฟเดิม และเริ่มใหม่ เซฟอยู่เฉพาะ browser นั้น การโหลดไม่เขียนทับเซฟโดยอัตโนมัติ

## ขอบเขตและข้อมูล

แผนที่ราบ 24×24 ช่อง ใช้ถนนกริด โดย road graph และ parcels แยกจาก mesh ตัวจำลองไม่ขึ้นกับ renderer หนึ่ง tick เท่ากับหนึ่งวัน; 30 วันต่อเดือน เงินเป็นสตางค์จำนวนเต็ม การผลิตและซื้อสินค้าเกิดรายวัน ส่วนค่าจ้าง ค่าเช่า และภาษีจ่ายรายเดือน มี money/goods/crop journals ให้กระทบยอด ครัวเรือนเป็นหน่วยเศรษฐกิจร่วมของสมาชิกหลายคน ไม่จำลองคนทุกคนเป็นตัวละครแยก

เซฟ v6 ใช้ `citymanager.save.v6` และเก็บช่อง v1/v2/v3/v4/v5 เดิมไว้ การบันทึกหลังนำเข้าจะสำรอง bytes ต้นฉบับก่อน เซฟ v5 รักษาเงิน สินค้า เจ้าของ งาน และหมายเลขระดับเดิม ส่วนเซฟก่อนหน้านั้นยังย้ายตลาด T เป็น C ระดับ 1 และรักษาความจุงานของร้านค้าเก่าตามกติกา PR #14 ไม่แจกวัตถุดิบหรือสร้างฟาร์มให้เซฟเก่า การเปิดงานเพิ่มต้องผ่านเงื่อนไขและมีทุนจริง โรงงานยังหยุดได้เมื่อขาด input จนผู้เล่นจัดหาแหล่งผลิตจริง

ยังไม่มีรถรายคัน เส้นทาง A* บนเลน ถนนโค้ง เครือข่ายกำลังผลิตน้ำ/ไฟ วงจรชีวิตรายบุคคล หรือหลักฐานรองรับประชากรแสน–ล้านคน การซื้อขายใช้เครือข่ายที่เชื่อมถึงประตูร่วมกันและตลาดภายนอกแบบนามธรรม พารามิเตอร์เศรษฐกิจเป็นข้อเสนอของเกม ไม่ใช่สูตร CSII หรือแบบจำลองเศรษฐกิจที่สอบเทียบกับโลกจริง

ฉากมีเวลาในวัน เงา ไฟกลางคืนเฉพาะอาคารที่มีคนอยู่หรือมีแรงงาน ฤดูกาลตามเดือนในเกม และฝนแบบตกแต่ง ทั้งหมดเป็นภาพเท่านั้น ไม่มีผลต่อการจำลองหรือเซฟ ตั้งค่าได้จากปุ่มนาฬิกาในแถบเวลา: [บรรยากาศ](docs/ATMOSPHERE.md)

โมเดลเมืองและไอคอนใช้ Kenney CC0 พร้อมรูปทรงและพื้นดินที่สร้างเอง มี procedural fallback เมื่อโหลดโมเดลไม่ได้: [Assets](docs/ASSETS.md), [GUI assets](docs/GUI-ASSETS.md), [Terrain](docs/TERRAIN.md) ขอบเขตเดิมอ่านได้ที่ [Design](docs/DESIGN.md) และ [แผนภาษาไทย](docs/PLAN.th.md); สถานะเฉพาะรุ่นให้ยึดเอกสารรุ่นและ PR ล่าสุด

## เผยแพร่

`dist/` ใช้ base `/CityManager/` สำหรับ GitHub Pages การ build ในเครื่องยังไม่ใช่การเผยแพร่ PR ต้องผ่าน simulation tests, TypeScript/build และ Edge acceptance ของ source commit นั้นก่อน Merge จากนั้น workflow บน `main` ตรวจและเผยแพร่ tested artifact ตรวจผลล่าสุดได้จาก [GitHub Actions](https://github.com/nustanakritwithai/CityManager/actions) และต้องตรวจเว็บจริงก่อนรายงานว่าเผยแพร่สำเร็จ

อ้างอิง API: [PlayCanvas standalone](https://developer.playcanvas.com/user-manual/engine/standalone/), [AppBase](https://api.playcanvas.com/engine/classes/AppBase.html), [CameraComponent](https://api.playcanvas.com/engine/classes/CameraComponent.html)
