import type { ServerCityRequest, ServerCityMetadata } from './server-city-save.ts';

export type CitySaveSlot = 1 | 2 | 3;
export type CitySlot =
  | { slot: CitySaveSlot; state: 'empty' }
  | { slot: CitySaveSlot; state: 'occupied'; cityId: string; metadata: ServerCityMetadata };

const savePath = '/v1/city-save';
const slotsPath = `${savePath}/slots`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function listCitySaveSlots(request: ServerCityRequest): Promise<CitySlot[] | null> {
  let response: unknown;
  try {
    response = await request(slotsPath, { cache: 'no-store' });
  } catch (error) {
    // The legacy server has no slots route. Never downgrade an auth or service error.
    if ((error as {status?:number})?.status === 404) return null;
    throw error;
  }
  const rows = (response as {slots?:unknown})?.slots;
  if (!Array.isArray(rows) || rows.length !== 3) throw Error('รายชื่อช่องเซฟไม่ครบ');
  const cities = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row?.slot !== index + 1) throw Error('ลำดับช่องเซฟไม่ถูกต้อง');
    if (row.state === 'empty') continue;
    const metadata = row.metadata;
    if (row.state !== 'occupied' || typeof row.cityId !== 'string' || !uuid.test(row.cityId) || cities.has(row.cityId)
      || typeof metadata?.name !== 'string' || metadata.name.length > 120
      || !Number.isSafeInteger(metadata.population) || metadata.population < 0
      || !Number.isSafeInteger(metadata.tick) || metadata.tick < 0) throw Error('ข้อมูลช่องเซฟไม่ถูกต้อง');
    cities.add(row.cityId);
  }
  return rows as CitySlot[];
}

export function requestForCitySlot(request: ServerCityRequest, slot: CitySaveSlot): ServerCityRequest {
  return (path, init) => {
    if (path !== savePath && !path.startsWith(`${savePath}/archives`)) throw Error('invalid-city-slot-path');
    return request(`${slotsPath}/${slot}${path.slice(savePath.length)}`, init);
  };
}
