/** Label old snapshots as updating while worker work is pending; zero is not a
 * stable traffic reading until the first usable frame has arrived. */
export function trafficGameStatus(d:{failure:string|null;ready:boolean;updating:boolean;step:number;demandRate:number;clippedRate:number;waiting:number;blocked:number;congestedLinks:number;dropped:number;modal:{taxiDiverted:number;roadBefore:number;roadAfter:number}|null}):string {
 if(d.failure)return 'แบบจำลองไม่พร้อม · แสดงรถตกแต่งแทน';
 if(!d.ready||(d.updating&&d.step===0))return 'กำลังอัปเดตแบบจำลองการจราจร…';
 return `ความต้องการ ${(d.demandRate+d.clippedRate).toFixed(1)} หน่วย/รอบ · รอ ${d.waiting.toFixed(1)} · รถติด ${d.blocked} คันตัวแทน · ถนนแออัด ${d.congestedLinks} ช่วง${d.clippedRate>0||d.dropped>0?' · ความต้องการบางส่วนเกินขีดจำลอง':''}${d.modal&&d.modal.taxiDiverted>0?` · แท็กซี่จำลอง: ภาระถนน ${d.modal.roadBefore.toFixed(1)} → ${d.modal.roadAfter.toFixed(1)} (รวมรถรับส่งและรถเปล่า)`:''}${d.updating?' · กำลังอัปเดต':''}`;
}
