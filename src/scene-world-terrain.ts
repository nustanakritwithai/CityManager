/** Pure functions used by the existing decorative terrain. */
export function hash(x: number, y: number, salt: number): number {
  let n = Math.imul(x + salt * 7919, 374761393) + Math.imul(y - salt, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
export function noise(x: number, y: number, scale: number, salt: number): number {
  const gx = x / scale, gy = y / scale, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt) * (1 - u) + hash(ix + 1, iy, salt) * u, b = hash(ix, iy + 1, salt) * (1 - u) + hash(ix + 1, iy + 1, salt) * u;
  return a * (1 - v) + b * v;
}
const fbm = (x: number, z: number, salt: number) => noise(x, z, 26, salt) * .55 + noise(x, z, 11, salt + 3) * .3 + noise(x, z, 4.5, salt + 9) * .15;
export const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function worldEdgeDistance(x: number, z: number, half: number) {
  const dx = Math.max(0, Math.abs(x) - half), dz = Math.max(0, Math.abs(z) - half);
  return Math.hypot(dx, dz) + Math.min(0, Math.max(Math.abs(x), Math.abs(z)) - half);
}
export const worldOnHighway = (x: number, z: number, half: number, gateZ: number) => x < -half && Math.abs(z - gateZ) < 3.2;
export const COAST = Object.freeze({ base: 2.6, west: 70, north: 16, east: 9, south: 1.2, noiseBase: 6, noiseNorth: 10, noiseEast: 10, beachStart: 1.5 });
function coastReach(x: number, z: number) {
  const angle = Math.atan2(z, x), west = Math.max(0, -Math.cos(angle)), north = Math.max(0, -Math.sin(angle)), east = Math.max(0, Math.cos(angle));
  const south = Math.max(0, Math.sin(angle));
  const reach = COAST.base + west * COAST.west + north * COAST.north + east * COAST.east - south * COAST.south;
  return reach + (noise(x, z, 17, 5) - .5) * (COAST.noiseBase + north * COAST.noiseNorth + east * COAST.noiseEast);
}
export function worldSurface(x: number, z: number, half: number, gateZ: number): { y: number; beach: number } {
  const d = worldEdgeDistance(x, z, half);
  if (d <= 0) return { y: -.02, beach: 0 };
  const reach = coastReach(x, z);
  const angle = Math.atan2(z, x), hilly = Math.max(0, -Math.sin(angle)) * .9 + Math.max(0, Math.cos(angle)) * .75 + Math.max(0, -Math.cos(angle)) * .2;
  let land = (fbm(x, z, 21) - .35) * 1.2 * smooth(2.5, 9, d) + Math.pow(fbm(x * .9, z * .9, 33), 1.8) * 17 * hilly * smooth(5, 18, d) * smooth(reach + 2, reach - 8, d);
  land = Math.max(.04, land) * smooth(0, 2.2, d);
  if (worldOnHighway(x, z, half, gateZ)) land = mix(land, .03, smooth(3.2, 1.6, Math.abs(z - gateZ)));
  const beach = smooth(reach - COAST.beachStart, reach + 3.5, d);
  const seabed = -.55 - smooth(reach + 3, reach + 18, d) * 2.4;
  return { y: mix(land, seabed, beach), beach };
}

/** Prepare only the previously decorative north extension for the flat construction plane. */
export function playableWorldSurface(x:number, z:number, half:number, gateZ:number): {y:number;beach:number} {
  const original=worldSurface(x,z,half,gateZ);
  const dx=Math.max(0,Math.abs(x)-half), dz=Math.max(0,-half-8-z,z+half);
  const weight=1-smooth(0,2,Math.hypot(dx,dz));
  return {y:weight===1?-.02:mix(original.y,-.02,weight),beach:original.beach};
}
