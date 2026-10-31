/** Non-serialized guard, rebuilt from a validated rail session. It never changes
 * road connectivity/capacity, trips, money, or serialized core City fields. */
const reservations=new WeakMap<object,ReadonlySet<number>>();
export function replaceRailReservations(city:object,cells:Iterable<number>){reservations.set(city,new Set(cells));}
export function isRailReserved(city:object,cell:number){return reservations.get(city)?.has(cell)??false;}
export const RAIL_PARCEL_MESSAGE='ช่องนี้สงวนไว้สำหรับสถานีหรือรางรถไฟ กรุณาจัดการแผนรถไฟก่อน';
