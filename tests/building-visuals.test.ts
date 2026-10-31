import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roomLights, luxuryTower, luxuryTowerLayout, aviationBeaconPulse, residentialVisualHeight, towerGlassGeometry, TOWER_ROOFS } from '../src/building-visuals.ts';

function towerData(name: string) {
  const bytes = readFileSync(new URL(`../public/assets/kenney-city/models/${name}.glb`, import.meta.url));
  const jsonSize = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const binary = 28 + jsonSize;
  function accessor(index: number): number[] {
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
    const count = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type as 'SCALAR' | 'VEC2' | 'VEC3'];
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
    const read = a.componentType === 5126 ? bytes.readFloatLE.bind(bytes) : a.componentType === 5125 ? bytes.readUInt32LE.bind(bytes) : bytes.readUInt16LE.bind(bytes);
    return Array.from({ length: a.count * count }, (_, n) => read(binary + (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + Math.floor(n / count) * (view.byteStride ?? count * size) + (n % count) * size));
  }
  const mesh = gltf.meshes[0].primitives[0];
  return { positions: accessor(mesh.attributes.POSITION), normals: accessor(mesh.attributes.NORMAL), uvs: accessor(mesh.attributes.TEXCOORD_0), indices: accessor(mesh.indices), gltf };
}

test('room choices are stable, include dark rooms and both warm/cool light, without global RNG', () => {
  const original = Math.random; Math.random = () => { throw new Error('Do not touch simulation or global randomness'); };
  try {
    const rooms = roomLights(); assert.deepEqual(rooms, roomLights());
    assert.ok(rooms.length > 12 && rooms.length < 25);
    assert.deepEqual(new Set(rooms.map(r => r.color)), new Set(['#ffe0a0', '#e6f0ff']));
    assert.equal(new Set(rooms.map(r => `${r.column},${r.row}`)).size, rooms.length);
    for (const room of rooms) assert.ok(room.column >= 0 && room.column < 5 && room.row >= 0 && room.row < 6);
  } finally { Math.random = original; }
});

test('residential tower levels preserve apartment/condo height and grow through every upgrade', () => {
  const heights = Array.from({ length: 7 }, (_, i) => residentialVisualHeight(i + 3));
  assert.deepEqual(heights.map(n => Math.round(n * 100) / 100), [2.35, 2.7, 3.3, 3.9, 4.4, 5, 5.6]);
  assert.ok(heights.every((h, i) => !i || h > heights[i - 1]));
});

for (const [name, expectedTriangles] of [['tower-a', 14], ['tower-b', 20], ['tower-c', 16]] as const) {
  test(`${name}: actual admitted glass is bounded, projected into rooms and does not include wall/roof triangles`, () => {
    const data = towerData(name), overlay = towerGlassGeometry(data.positions, data.normals, data.uvs, data.indices);
    assert.equal(overlay.indices.length / 3, expectedTriangles);
    assert.ok(overlay.positions.every(Number.isFinite));
    assert.ok(overlay.uvs.every(n => n >= 0 && n <= 1));
    assert.ok(new Set(overlay.uvs.filter((_, i) => i % 2 === 0)).size > 1, 'UV horizontal projection is not the original single palette column');
    assert.equal(overlay.positions.length, overlay.normals.length);
    for (let i = 1; i < overlay.normals.length; i += 3) assert.ok(Math.abs(overlay.normals[i]) < .1, 'roof never glows');
    const dark = towerGlassGeometry(data.positions, data.normals, data.uvs.map(() => 0), data.indices);
    assert.equal(dark.indices.length, 0, 'no overlay on non-glass texels');
  });

  test(`${name}: authored roof props sit on the deck, clear machinery, inside the original parcel`, () => {
    const data = towerData(name), p = data.positions;
    const width = Math.max(...p.filter((_, i) => i % 3 === 0)) - Math.min(...p.filter((_, i) => i % 3 === 0));
    const depth = Math.max(...p.filter((_, i) => i % 3 === 2)) - Math.min(...p.filter((_, i) => i % 3 === 2));
    const scale = 1.35 / Math.max(width, depth), minY = Math.min(...p.filter((_, i) => i % 3 === 1));
    const maxY = Math.max(...p.filter((_, i) => i % 3 === 1));
    const cx = (Math.max(...p.filter((_, i) => i % 3 === 0)) + Math.min(...p.filter((_, i) => i % 3 === 0))) / 2;
    const cz = (Math.max(...p.filter((_, i) => i % 3 === 2)) + Math.min(...p.filter((_, i) => i % 3 === 2))) / 2;
    function roofAt(x: number, z: number) {
      let top = -Infinity;
      for (let i = 0; i < data.indices.length; i += 3) {
        const points = data.indices.slice(i, i + 3).map(v => [(p[v * 3] - cx) * scale, (p[v * 3 + 1] - minY) * scale, (p[v * 3 + 2] - cz) * scale]);
        const [a,b,c] = points;
        if (Math.abs(a[1]-b[1]) > 1e-5 || Math.abs(a[1]-c[1]) > 1e-5) continue;
        const den = (b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
        if (Math.abs(den) < 1e-10) continue;
        const u = ((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
        const v = ((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;
        if (u >= -1e-5 && v >= -1e-5 && u+v <= 1.00001) top=Math.max(top,a[1]);
      }
      return top;
    }
    const roof = TOWER_ROOFS[name], expected = (maxY - minY) * scale * roof.deckRatio;
    for (const [anchor, width] of [[roof.lounge, .36], [roof.garden, .24]] as const) {
      for (const dx of [-width/2, 0, width/2]) for (const dz of [-width/2, 0, width/2]) {
        const x = anchor[0]+dx, z = anchor[1]+dz;
        assert.ok(Math.abs(roofAt(x,z)-expected)<.002, `deck support at ${x},${z}: ${roofAt(x,z)} vs ${expected}`);
        assert.ok(Math.abs(x) < .675 && Math.abs(z) < .675);
      }
    }
  });
}


test('luxury scope uses real R7+/C4+ levels without changing industrial tiers', () => {
  assert.equal(luxuryTower('R', 3), false); assert.equal(luxuryTower('R', 4), false); assert.equal(luxuryTower('R', 6), false); assert.equal(luxuryTower('R', 7), true);
  assert.equal(luxuryTower('C', 2), false); assert.equal(luxuryTower('C', 3), true);
  assert.equal(luxuryTower('I', 9), false);
});
test('setback envelope retains height and parcel footprint; crown supports all pool corners', () => {
  for (const height of [2.35, 2.7, 3.3, 3.9, 4.4, 5, 5.6, 6.8]) {
    const l = luxuryTowerLayout(height);
    assert.ok(Math.abs(l.podiumHeight + l.shaftHeight + l.crownHeight - height) < 1e-12);
    assert.ok(Math.abs(l.crownBase + l.crownHeight - height) < 1e-12);
    assert.equal(l.roofY, height); assert.equal(l.podiumWidth, 1.35);
    assert.ok(l.shaftWidth < l.crownWidth && l.crownWidth < l.podiumWidth);
    for (const x of [.22 - .25, .22 + .25]) for (const z of [.23 - .28, .23 + .28]) {
      assert.ok(Math.abs(x) <= l.crownWidth / 2 && Math.abs(z) <= l.crownWidth / 2);
    }
    for (const x of [-.25 - .15, -.25 + .15]) for (const z of [-.22 - .15, -.22 + .15]) {
      assert.ok(Math.abs(x) <= l.crownWidth / 2 && Math.abs(z) <= l.crownWidth / 2);
    }
  }
});
test('aviation beacon actually alternates at night, never emits during daylight', () => {
  for (const t of [0, .2, .55, 1, 1.99, 2, 2.2, 20]) assert.equal(aviationBeaconPulse(t, 0), 0);
  assert.equal(aviationBeaconPulse(.2, .49), 0);
  assert.equal(aviationBeaconPulse(.2, 1), 1); assert.equal(aviationBeaconPulse(.6, 1), 0);
  assert.equal(aviationBeaconPulse(1.9, 1), 0); assert.equal(aviationBeaconPulse(2.2, 1), 1);
  assert.equal(aviationBeaconPulse(2.2, .75), .75);
});
