# Changelog

## 1.0.0 — 2026-10-25
รุ่นเบื้องต้นที่ปิดงาน: เกมมีเป้าหมาย ตอนจบ และเศรษฐกิจที่ไม่ล่มในระยะยาว รูปแบบเซฟ v7 / `chain-2` ตรึงไว้ตลอดรุ่น 1.x

### เป้าหมายและตอนจบ ([#40](https://github.com/nustanakritwithai/CityManager/pull/40))
- เมือง 5 ระดับ ป้ายระดับใต้ชื่อเกม การ์ด "เป้าหมายเมือง" และหน้าจอชนะที่สรุปสถิติจากบัญชีจริง ชนะแล้วเล่นต่อได้

### สมดุล ([#41](https://github.com/nustanakritwithai/CityManager/pull/41))
- ฟาร์มขายพืชผลให้ตลาดล็อตละ 2 ฿ (เดิม 1.50) และขยายระดับเมื่อกำไรพอจ่ายค่าจ้างเพิ่ม เมืองไม่ล่มในวันที่ 500–650 อีก
- ป้าย "เงินกิจการหมด" พร้อมวิธีแก้ (รื้อแล้ววางโซนใหม่)

### ประสบการณ์เล่นครั้งแรก ([#42](https://github.com/nustanakritwithai/CityManager/pull/42))
- ฟีเจอร์ทดลองปิดไว้หลังสวิตช์ในเมนูเกม ข้อความในการ์ดเป็นภาษาไทย ตัวช่วยสอนบอกเป้าหมาย

### ห่วงโซ่สินค้า ([#36](https://github.com/nustanakritwithai/CityManager/pull/36)–[#39](https://github.com/nustanakritwithai/CityManager/pull/39))
- ร้านค้าเปิดในเมืองใหม่เมื่อโรงงานมีคนงาน ป้ายคอขวด (ชั้นว่าง นำเข้าสินค้า)
- เซฟ v7: ฟาร์มระดับ 1–3 ครัวเรือนเปิดร้านเองด้วยเงินออม ตลาดที่มีกำไรยกระดับเป็นร้านค้า

### ภาพและหน้าจอ ([#18](https://github.com/nustanakritwithai/CityManager/pull/18)–[#35](https://github.com/nustanakritwithai/CityManager/pull/35))
- HUD และแผงข้อมูลใหม่ ธีมน้ำเงิน สถิติเมือง แดชบอร์ด กราฟ ไอคอนแทนข้อความ
- บรรยากาศ: เวลาในวัน ฤดูกาล ฝน รถ คนเดิน ควันโรงงาน หลังคา ม้านั่ง
- เครือข่ายเมือง 3D แผนที่ย่อ (มือถือด้วย) ปุ่มลัดบนเดสก์ท็อป

### ระบบเจ้าของ Typhoon ([#17](https://github.com/nustanakritwithai/CityManager/pull/17), [#21](https://github.com/nustanakritwithai/CityManager/pull/21), [#31](https://github.com/nustanakritwithai/CityManager/pull/31), [#32](https://github.com/nustanakritwithai/CityManager/pull/32))
- ข้อเสนอเติมทุน/ถอนกำไรของเจ้าของตลาด โหมดอัตโนมัติรายเดือน บันทึกเล่นซ้ำได้

### เศรษฐกิจพื้นฐาน ([#4](https://github.com/nustanakritwithai/CityManager/pull/4)–[#16](https://github.com/nustanakritwithai/CityManager/pull/16))
- ครัวเรือน สมาชิก ความจุบ้าน การย้ายเข้า แรงงานตามทักษะ เกษตรและพืชผล ตลาดระดับ 1 ของครัวเรือน การ์ดอาคารตามประเภท สัญญาณเมืองและคำอธิบายจาก AI โรงงานขยายด้วยเงินของตัวเอง

### รุ่นแรก
- เกมเล่นได้รุ่นแรกบน GitHub Pages: ถนน โซน R/C/I อาคาร เงินคลัง บัญชีคู่ และเซฟในเบราว์เซอร์
