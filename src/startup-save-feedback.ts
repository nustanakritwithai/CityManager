/** Persistent startup diagnostics: allowlisted explanations, never raw save/error contents. */
export function startupSaveFailureMessage(error: string): string {
  const reason = error === 'พบเซฟช่องเดิมกับสำเนาอัตโนมัติต่างกัน กรุณาเลือกโหลดชุดที่ต้องการก่อน'
    ? 'เซฟหลักกับสำเนาอัตโนมัติไม่ตรงกัน ต้องตรวจและเลือกชุดที่ต้องการก่อน'
    : error === 'Recovery copy could not be decoded; original save preserved'
      ? 'อ่านสำเนากู้คืนไม่ได้ ยังไม่เขียนทับข้อมูลเดิม'
      : error === 'City save exceeds the prototype limit'
        ? 'เซฟเดิมมีขนาดเกินขีดจำกัดที่เกมอ่านได้'
        : 'ยังอ่านหรือตรวจสอบเซฟเดิมไม่ผ่าน จึงยังระบุสาเหตุเฉพาะไม่ได้';
  return `โหลดเซฟเดิมไม่สำเร็จ: ${reason} · ปิด autosave เพื่อรักษาต้นฉบับ · ตอนเปิดเกมแสดงเมืองชั่วคราว ไม่ใช่เซฟเดิม · การส่งออกก่อนกู้คืนส่งออกเมืองชั่วคราว · กรุณากู้คืน ห้ามล้างข้อมูลเว็บไซต์`;
}
