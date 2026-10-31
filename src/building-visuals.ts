/** Pure renderer geometry: no city state, clock or simulation randomness. */
export const TOWER_ROOFS = {
  'tower-a': { deckRatio: 2.7794117647 / 2.8588235294, lounge: [-.25, -.25], garden: [.25, -.35] },
  'tower-b': { deckRatio: 4.169882 / 4.253282, lounge: [-.25, -.25], garden: [.25, -.35] },
  'tower-c': { deckRatio: 3.501706 / 3.968609, lounge: [-.25, -.25], garden: [.25, -.35] },
} as const;
export type TowerName = keyof typeof TOWER_ROOFS;
export function residentialVisualHeight(level: number): number {
  return level <= 3 ? 2.35 : level <= 6 ? 2.1 + (level - 3) * .6 : 3.8 + (Math.min(9, level) - 6) * .6;
}
export function roomLights(seed = 19): readonly { column: number; row: number; color: string }[] {
  const rooms: { column: number; row: number; color: string }[] = [];
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let row = 0; row < 6; row++) for (let column = 0; column < 5; column++) {
    const on = random() > .35, warm = random() > .3;
    if (on) rooms.push({ column, row, color: warm ? '#ffe0a0' : '#e6f0ff' });
  }
  return rooms;
}

/** The Kenney palette uses point UVs. Project actual vertical glass triangles instead. */
export function towerGlassGeometry(positions: readonly number[], normals: readonly number[], uvs: readonly number[], indices: readonly number[]) {
  const out = { positions: [] as number[], normals: [] as number[], uvs: [] as number[], indices: [] as number[] };
  let low = Infinity, high = -Infinity, span = 0;
  for (let v = 0; v < positions.length; v += 3) {
    low = Math.min(low, positions[v + 1]); high = Math.max(high, positions[v + 1]);
    span = Math.max(span, Math.abs(positions[v]), Math.abs(positions[v + 2]));
  }
  if (!(high > low && span > 0)) return out;
  const glass = (i: number) => uvs[i * 2] * 512 >= 320 && uvs[i * 2] * 512 < 384 && uvs[i * 2 + 1] * 512 >= 128 && uvs[i * 2 + 1] * 512 < 256;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const face = indices.slice(t, t + 3);
    if (!face.every(glass) || face.some(i => Math.abs(normals[i * 3 + 1]) > .1)) continue;
    for (const i of face) {
      const p = positions.slice(i * 3, i * 3 + 3), n = normals.slice(i * 3, i * 3 + 3);
      if (p.length !== 3 || n.length !== 3) continue;
      out.indices.push(out.indices.length);
      out.positions.push(...p.map((value, axis) => value + n[axis] * .0015));
      out.normals.push(...n);
      const horizontal = Math.abs(n[0]) > Math.abs(n[2]) ? p[2] * -Math.sign(n[0]) : p[0] * Math.sign(n[2]);
      out.uvs.push(.5 + horizontal / (span * 2), (p[1] - low) / (high - low));
    }
  }
  return out;
}

/** Retail's renderer tier is its actual level minus one. */
export function luxuryTower(zone: 'R' | 'C' | 'I', visualLevel: number): boolean {
  return zone === 'R' ? visualLevel >= 7 : zone === 'C' && visualLevel >= 3;
}
/** The envelope retains its original height/footprint; fittings sit on a supported flat crown. */
export function luxuryTowerLayout(height: number) {
  return { podiumHeight: height * .22, shaftHeight: height * .72, crownHeight: height * .06,
    shaftBase: height * .22, crownBase: height * .94, roofY: height,
    podiumWidth: 1.35, shaftWidth: 1.0, crownWidth: 1.08 };
}
/** One slow pulse per two real seconds, including when the simulation clock is paused. */
export function aviationBeaconPulse(seconds: number, night: number): number {
  return night >= .5 && ((seconds % 2) + 2) % 2 < .55 ? night : 0;
}
