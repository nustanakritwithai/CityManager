/**
 * Districts: named groups of parcels the player paints on the map. They change nothing in the simulation yet;
 * they let the player read the city by neighbourhood. Stored only in the optional `city.districts` section, so a city
 * that never names a district saves byte-identically.
 */
export const MAX_DISTRICTS = 8;
export const DISTRICT_TONES = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'] as const;
export type DistrictTone = typeof DISTRICT_TONES[number];
/** Distinct, colour-blind-friendly hues, one per slot. */
export const DISTRICT_COLORS: Record<DistrictTone, string> = {
  d1: '#4e79a7', d2: '#f28e2b', d3: '#59a14f', d4: '#e15759', d5: '#b07aa1', d6: '#76b7b2', d7: '#edc948', d8: '#ff9da7',
};
export type District = { id: number; name: string; cells: number[] };
export type DistrictState = { version: 1; list: District[] };
type Host = { districts?: DistrictState; cells: readonly unknown[] };

export const districtTone = (id: number): DistrictTone => DISTRICT_TONES[(id - 1) % DISTRICT_TONES.length];
export const districtAt = (c: Pick<Host, 'districts'>, cell: number): District | undefined => c.districts?.list.find(d => d.cells.includes(cell));
const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 24);

/** A new district with the lowest free slot id; null when all slots are used or the name is empty. */
export function createDistrict(c: Host, name: string): District | null {
  const list = c.districts?.list ?? [], clean = cleanName(name);
  if (!clean || list.length >= MAX_DISTRICTS) return null;
  let id = 1; while (list.some(d => d.id === id)) id++;
  const district = { id, name: clean, cells: [] };
  c.districts = { version: 1, list: [...list, district].sort((a, b) => a.id - b.id) };
  return district;
}
export function renameDistrict(c: Host, id: number, name: string): boolean {
  const district = c.districts?.list.find(d => d.id === id), clean = cleanName(name);
  if (!district || !clean) return false;
  district.name = clean; return true;
}
export function deleteDistrict(c: Host, id: number): boolean {
  if (!c.districts?.list.some(d => d.id === id)) return false;
  const list = c.districts.list.filter(d => d.id !== id);
  if (list.length) c.districts = { version: 1, list }; else delete c.districts;
  return true;
}
/** Put parcels into a district (taking them out of any other), or out of every district when `id` is null. */
export function paintDistrict(c: Host, id: number | null, cells: readonly number[]): number {
  if (!c.districts) return 0;
  const target = id === null ? null : c.districts.list.find(d => d.id === id);
  if (id !== null && !target) return 0;
  const valid = [...new Set(cells.filter(cell => Number.isSafeInteger(cell) && cell >= 0 && cell < c.cells.length))];
  let changed = 0;
  for (const cell of valid) {
    const current = districtAt(c, cell);
    if (current === target) continue;
    if (current) current.cells = current.cells.filter(x => x !== cell);
    if (target) target.cells.push(cell);
    changed++;
  }
  for (const d of c.districts.list) d.cells.sort((a, b) => a - b);
  return changed;
}

/** Throws on a malformed districts section. Runs only when `districts` is present. */
export function validateDistricts(value: unknown, cellCount: number): asserts value is DistrictState {
  const fail = (why: string): never => { throw new Error(`Invalid districts save: ${why}`); };
  const s = value as DistrictState;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== 'list,version' || s.version !== 1 || !Array.isArray(s.list)) fail('envelope');
  if (!s.list.length || s.list.length > MAX_DISTRICTS) fail('count');
  const ids = new Set<number>(), cells = new Set<number>();
  for (const d of s.list) {
    if (!d || typeof d !== 'object' || Object.keys(d).sort().join(',') !== 'cells,id,name') fail('fields');
    if (!Number.isSafeInteger(d.id) || d.id < 1 || d.id > MAX_DISTRICTS || ids.has(d.id)) fail('id');
    if (typeof d.name !== 'string' || cleanName(d.name) !== d.name || !d.name) fail('name');
    if (!Array.isArray(d.cells)) fail('cells');
    for (let i = 0; i < d.cells.length; i++) {
      const cell = d.cells[i];
      if (!Number.isSafeInteger(cell) || cell < 0 || cell >= cellCount || cells.has(cell) || (i && cell <= d.cells[i - 1])) fail('cell');
      cells.add(cell);
    }
    ids.add(d.id);
  }
  for (let i = 1; i < s.list.length; i++) if (s.list[i].id <= s.list[i - 1].id) fail('order');
}
