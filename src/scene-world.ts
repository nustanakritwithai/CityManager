import { Entity, Mesh, MeshInstance, StandardMaterial, Color, BLEND_NORMAL, type AppBase } from 'playcanvas';
import type { Atmosphere } from './atmosphere.ts';

/**
 * Decorative surroundings outside the 24 × 24 build grid: mainland and highway to the
 * west gateway, hills to the north/east, beaches and a shallow sea to the south.
 * Visual only: none of this is buildable, picked or simulated.
 */
const EXTENT = 112, STEP = 1.6, WATER_Y = -.32;

function hash(x: number, y: number, salt: number): number {
  let n = Math.imul(x + salt * 7919, 374761393) + Math.imul(y - salt, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, scale: number, salt: number): number {
  const gx = x / scale, gy = y / scale, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt) * (1 - u) + hash(ix + 1, iy, salt) * u, b = hash(ix, iy + 1, salt) * (1 - u) + hash(ix + 1, iy + 1, salt) * u;
  return a * (1 - v) + b * v;
}
const fbm = (x: number, z: number, salt: number) => noise(x, z, 26, salt) * .55 + noise(x, z, 11, salt + 3) * .3 + noise(x, z, 4.5, salt + 9) * .15;
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
type Rgb = [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const C = { deep: hex('#3d6b6e'), shallow: hex('#b8ad84'), sand: hex('#e2d3a2'), grass: hex('#78935f'), meadow: hex('#8aa36a'), forest: hex('#5a774c'), city: hex('#769267'), rock: hex('#8f8a78') };

export type WorldTreeSpot = { x: number; y: number; z: number; scale: number };

export class CityWorld {
  readonly root = new Entity('Decorative surroundings');
  readonly treeSpots: WorldTreeSpot[] = [];
  private readonly water: StandardMaterial;

  /** half = half the build grid width; gateZ = world z of the west gateway road. */
  constructor(app: AppBase, private readonly half: number, private readonly gateZ: number) {
    const n = Math.round(EXTENT * 2 / STEP) + 1, positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let row = 0; row < n; row++) for (let column = 0; column < n; column++) {
      const x = -EXTENT + column * STEP, z = -EXTENT + row * STEP, { y, beach } = this.surface(x, z);
      positions.push(x, y, z);
      const [r, g, b] = this.colour(x, y, z, beach); colors.push(r, g, b, 255);
    }
    for (let row = 0; row < n - 1; row++) for (let column = 0; column < n - 1; column++) {
      const a = row * n + column, b = a + n;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const normals = this.normals(positions, indices);
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(positions); mesh.setNormals(normals); mesh.setColors32(colors); mesh.setIndices(indices); mesh.update();
    const ground = new StandardMaterial(); ground.name = 'Surrounding terrain';
    ground.diffuse = new Color(1, 1, 1); ground.diffuseVertexColor = true; ground.gloss = .05; ground.update();
    const terrain = new Entity('Coast and hills');
    terrain.addComponent('render', { meshInstances: [new MeshInstance(mesh, ground)], castShadows: true, receiveShadows: true });
    this.root.addChild(terrain);

    this.water = new StandardMaterial(); this.water.name = 'Sea';
    this.water.diffuse = new Color(.16, .45, .55); this.water.opacity = .8; this.water.blendType = BLEND_NORMAL; this.water.depthWrite = false;
    this.water.specular = new Color(.75, .78, .8); this.water.gloss = .88; this.water.update();
    const sea = new Entity('Sea surface');
    sea.addComponent('render', { type: 'plane', material: this.water, castShadows: false, receiveShadows: true });
    sea.setLocalPosition(0, WATER_Y, 0); sea.setLocalScale(520, 1, 520);
    this.root.addChild(sea);

    for (let attempt = 0; attempt < 900 && this.treeSpots.length < 150; attempt++) {
      const x = -EXTENT + hash(attempt, 3, 41) * EXTENT * 2, z = -EXTENT + hash(attempt, 7, 43) * EXTENT * 2;
      const d = this.edgeDistance(x, z), y = this.height(x, z);
      if (d < 3 || d > 62 || y < .25 || this.onHighway(x, z) || noise(x, z, 14, 61) < .42) continue;
      this.treeSpots.push({ x, y, z, scale: .75 + hash(attempt, 11, 47) * .55 });
    }
    app.root.addChild(this.root);
  }

  /** Distance outside the square build area (0 at its edge). */
  private edgeDistance(x: number, z: number) {
    const dx = Math.max(0, Math.abs(x) - this.half), dz = Math.max(0, Math.abs(z) - this.half);
    return Math.hypot(dx, dz) + Math.min(0, Math.max(Math.abs(x), Math.abs(z)) - this.half);
  }
  private onHighway(x: number, z: number) { return x < -this.half && Math.abs(z - this.gateZ) < 3.2; }

  /** How far the land reaches from the grid edge in this direction before the beach. */
  private coastReach(x: number, z: number) {
    const angle = Math.atan2(z, x), west = Math.max(0, -Math.cos(angle)), north = Math.max(0, -Math.sin(angle)), east = Math.max(0, Math.cos(angle));
    const south = Math.max(0, Math.sin(angle));
    const reach = 2.6 + west * 70 + north * 16 + east * 9 - south * 1.2;
    return reach + (noise(x, z, 17, 5) - .5) * (6 + north * 10 + east * 10);
  }

  height(x: number, z: number): number { return this.surface(x, z).y; }

  /** Height plus the 0..1 beach blend used for colouring. */
  private surface(x: number, z: number): { y: number; beach: number } {
    const d = this.edgeDistance(x, z);
    if (d <= 0) return { y: -.02, beach: 0 };
    const reach = this.coastReach(x, z);
    const angle = Math.atan2(z, x), hilly = Math.max(0, -Math.sin(angle)) * .9 + Math.max(0, Math.cos(angle)) * .75 + Math.max(0, -Math.cos(angle)) * .2;
    let land = (fbm(x, z, 21) - .35) * 1.2 * smooth(2.5, 9, d) + Math.pow(fbm(x * .9, z * .9, 33), 1.8) * 17 * hilly * smooth(5, 18, d) * smooth(reach + 2, reach - 8, d);
    land = Math.max(.04, land) * smooth(0, 2.2, d);
    if (this.onHighway(x, z)) land = mix(land, .03, smooth(3.2, 1.6, Math.abs(z - this.gateZ)));
    const beach = smooth(reach - 1.5, reach + 3.5, d);
    const seabed = -.55 - smooth(reach + 3, reach + 18, d) * 2.4;
    return { y: mix(land, seabed, beach), beach };
  }

  private colour(x: number, y: number, z: number, beach: number): Rgb {
    const grain = (noise(x, z, 3.2, 71) - .5) * 18;
    let c: Rgb;
    if (y < WATER_Y - .05) c = mixRgb(C.shallow, C.deep, smooth(WATER_Y, -2.4, y));
    else {
      c = mixRgb(C.grass, C.meadow, noise(x, z, 9, 81));
      // Darker canopy where the decorative forest grows, rock on the highest ridges.
      c = mixRgb(c, C.forest, smooth(.36, .5, noise(x, z, 14, 61)) * .75 + smooth(1, 5, y) * .2);
      c = mixRgb(c, C.rock, smooth(7, 12, y) * .7);
      // Meet the baked build-grid meadow without a visible seam.
      c = mixRgb(c, C.city, smooth(9, 1.5, this.edgeDistance(x, z)) * .85);
      c = mixRgb(c, C.sand, smooth(.04, .3, beach));
    }
    if (this.onHighway(x, z) && Math.abs(z - this.gateZ) < 2.4 && y > 0) c = mixRgb(c, hex('#b7b596'), .55);
    // Vertex colours are linear in the shader; authored values here are sRGB.
    const linear = (v: number) => Math.round(Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2) * 255);
    return [linear(c[0] + grain), linear(c[1] + grain), linear(c[2] + grain * .7)];
  }

  private normals(positions: number[], indices: number[]): number[] {
    const normals = new Array(positions.length).fill(0);
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1, sign = normals[i + 1] < 0 ? -1 : 1;
      normals[i] *= sign / l; normals[i + 1] *= sign / l; normals[i + 2] *= sign / l;
    }
    return normals;
  }

  /** Sea colour follows the sky; it darkens at night but keeps a moonlit sheen. */
  apply(a: Atmosphere) {
    const day = 1 - a.night * .7, base: Rgb = [.15, .44, .55];
    this.water.diffuse.set(mix(base[0], a.skyZenith[0], .35) * day, mix(base[1], a.skyZenith[1], .35) * day, mix(base[2], a.skyZenith[2], .3) * day);
    this.water.update();
  }
}
