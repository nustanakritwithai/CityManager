/** Exact raw-city UTF-8 limit enforced by the existing save service (not the JSON request envelope). */
export const SERVER_CITY_MAX_BYTES=8*1024*1024;
export const serverCityBytes=(raw:string)=>new TextEncoder().encode(raw).byteLength;
export function assertServerCitySize(raw:string):void {
 const bytes=serverCityBytes(raw);
 if(bytes>SERVER_CITY_MAX_BYTES)throw Object.assign(Error(`เซฟเมืองมีขนาด ${(bytes/1024/1024).toFixed(2)} MiB เกินขีดจำกัด 8 MiB · ยังไม่ได้ส่งหรือยืนยันบันทึก กรุณาส่งออกไฟล์และอย่าปิดหน้านี้`),{status:413,code:'save-too-large',bytes});
}
