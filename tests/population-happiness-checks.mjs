import assert from 'node:assert/strict';

/** Browser-visible facts must match this household, not an unrelated no-job fallback. */
export function assertPopulationHappiness(section,row,facts) {
  assert.equal(section.exists,true);assert.equal(section.direct,true);assert.equal(section.inDetails,false);
  const text=section.text;assert.ok(text.includes('ความสุขในพื้นที่'));
  if(!row){assert.ok(text.includes('ความสุขเริ่มคำนวณหลังผ่านหนึ่งวันจำลอง'));return;}
  assert.ok(facts,'Current happiness facts exist');
  for(const value of [`${row.score} / 100`,`เป้าหมายปัจจุบัน ${facts.target} / 100`,'สวนใกล้บ้าน:','โรงเรียนที่เปิดใกล้บ้าน:'])assert.ok(text.includes(value),`Visible happiness fact: ${value}`);
  if(facts.workers){
    for(const value of [
      `แบบจำลองเส้นทางทำงานของแรงงาน ${facts.workers} คน`,
      `${facts.unreachableWorkers} คนไม่มีเส้นทางไป–กลับ`,
      `เวลาเฉลี่ยทางที่ช้ากว่าประมาณ ${facts.commuteSeconds===null?'ไม่มีเส้นทาง':`${Math.round(facts.commuteSeconds/60*10)/10} นาที`}`,
      `เวลาล่าช้าจากความหนาแน่นประมาณ ${facts.delaySeconds===null?'ไม่มีข้อมูล':`${Math.round(facts.delaySeconds)} วินาที`}`,
      'งานดูแลสวนใช้เส้นทางเดินเท้าได้เมื่อรถไป–กลับไม่ได้',
      'แบบจำลองใช้แรงงานที่มีเส้นทางรถ 75% คำนวณการจราจรชั่วโมงเร่งด่วน',
      'ยังไม่ได้รวมรถโดยสารหรือรถไฟ',
    ])assert.ok(text.includes(value),`Visible modeled-commute fact: ${value}`);
    assert.ok(!text.includes('ยังไม่มีงานที่ได้รับมอบหมาย'),'A working household cannot use the no-job explanation');
  } else assert.ok(text.includes('ยังไม่มีงานที่ได้รับมอบหมายให้ประมาณเส้นทางเดินทาง'));
}
