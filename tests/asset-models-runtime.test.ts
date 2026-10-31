import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { AppBase, NullGraphicsDevice, RenderComponentSystem, Entity, Mesh, MeshInstance, StandardMaterial, BLEND_ADDITIVE } from 'playcanvas';

// Vite supplies import.meta.env exactly as the browser build does. NullGraphicsDevice
// checks real PlayCanvas component ownership/lifetime without claiming pixel/GPU QA.
test('real engine tower assembly preserves base meshes, occupancy, shared rooms and rebuild lifetime', async () => {
  await mkdir(resolve('.test-output'), { recursive: true });
  const out = await mkdtemp(resolve('.test-output/condo-runtime-'));
  await build({ configFile: false, logLevel: 'silent', build: { ssr: resolve('src/asset-models.ts'), outDir: out, emptyOutDir: true } });
  const { CityAssets, disconnectedBuildingMaterial } = await import(pathToFileURL(resolve(out, 'asset-models.js')).href);
  const canvas = { id: 'condo-runtime-test', width: 1, height: 1 } as HTMLCanvasElement;
  const app = new AppBase(canvas);
  app.init({ graphicsDevice: new NullGraphicsDevice(canvas), componentSystems: [RenderComponentSystem], resourceHandlers: [] });
  const oldDocument = globalThis.document;
  const fills: string[] = [];
  globalThis.document = { createElement() { return { width: 512, height: 512, getContext() { return { fillStyle: '', fillRect() { fills.push(this.fillStyle); } }; } }; }, removeEventListener() {} } as unknown as Document;
  const assets = new CityAssets(app), registered: { material: StandardMaterial; strength: number; blink?: boolean }[] = [];
  assets.glowRegistrar = (material: StandardMaterial, strength: number, blink?: boolean) => registered.push({ material, strength, blink });
  const mesh = new Mesh(app.graphicsDevice);
  mesh.setPositions([-.5,0,0, .5,0,0, .5,3,0, -.5,3,0]);
  mesh.setNormals([0,0,1, 0,0,1, 0,0,1, 0,0,1]);
  mesh.setUvs(0,[.71875,.3, .71875,.3, .71875,.3, .71875,.3]);
  mesh.setIndices([0,1,2,0,2,3]); mesh.update(); mesh.incRefCount();
  const material = new StandardMaterial();
  for (const name of ['tower-a','tower-b','tower-c']) assets.resources.set(name, {
    instantiateRenderEntity() {
      const entity = new Entity(name, app);
      entity.addComponent('render', { meshInstances: [new MeshInstance(mesh, material, entity)] }); return entity;
    }
  });
  try {
    const dark = assets.building('R',7,0,false) as Entity; assert.ok(dark); app.root.addChild(dark);
    assert.equal(dark.findByName('Tower room overlays'), null);
    assert.ok(dark.findByName('Luxury podium')); assert.ok(dark.findByName('Turquoise infinity pool')); assert.equal(registered.length, 0);
    const first = assets.building('R',7,0,true) as Entity; app.root.addChild(first);
    const renders = first.findComponents('render') as any[];
    assert.equal(renders.filter(r => r.entity.name === 'Tower room overlays').length, 2, 'podium and shaft share occupied room overlays');
    assert.equal(renders[0].meshInstances[0].mesh, mesh, 'adding overlays must not destroy base render instances');
    assert.equal(renders[0].meshInstances[0].material, material);
    const overlay = renders[1].meshInstances[0], sharedMesh = overlay.mesh;
    assert.equal(overlay.castShadow, false); assert.equal(overlay.receiveShadow, false);
    assert.equal(overlay.node, renders[0].meshInstances[0].node, 'overlay follows the original model node transforms');
    assert.equal(overlay.material.blendType, BLEND_ADDITIVE); assert.equal(overlay.material.depthWrite, false);
    assert.equal(overlay.material.depthTest, true); assert.equal(overlay.material.useFog, false, 'fog must not make additive sheets visible by day'); assert.equal(overlay.material.emissiveMapChannel, 'rgb');
    assert.equal(overlay.material.emissiveIntensity, 0, 'day starts dark');
    assert.equal(registered.length, 1); assert.equal(registered[0].strength, 2.2);
    registered[0].material.emissiveIntensity = registered[0].strength;
    assert.equal(overlay.material.emissiveIntensity, 2.2, 'atmosphere registrar drives night illumination');
    const faded = disconnectedBuildingMaterial(overlay.material);
    assert.equal(faded.emissiveIntensity, 0); assert.deepEqual([faded.diffuse.r, faded.diffuse.g, faded.diffuse.b], [0,0,0]);
    assert.equal(overlay.material.emissiveIntensity, 2.2, 'disconnect clone never mutates connected shared rooms'); faded.destroy();
    const fadedBase = disconnectedBuildingMaterial(material);
    assert.deepEqual([fadedBase.diffuse.r,fadedBase.diffuse.g,fadedBase.diffuse.b],[.52,.54,.58]); fadedBase.destroy();
    const second = assets.building('R',9,0,true) as Entity; app.root.addChild(second);
    assert.equal((second.findComponents('render')[1] as any).meshInstances[0].mesh, sharedMesh);
    assert.equal(registered.length, 1); const fillCount = fills.length;
    first.destroy(); second.destroy(); assert.equal(sharedMesh.refCount, 1, 'cache pin survives all visible instances destroyed');
    for (let n = 0; n < 48; n++) {
      const rebuilt = assets.building('R',7 + n % 3,n,true) as Entity; assert.ok(rebuilt); app.root.addChild(rebuilt);
      assert.equal((rebuilt.findComponents('render')[1] as any).meshInstances[0].mesh, sharedMesh);
      rebuilt.destroy();
    }
    assert.equal(sharedMesh.refCount,1); assert.equal(assets.glassMeshes.size,1); assert.equal(fills.length,fillCount);
    assert.equal(registered.length,1, 'no material/texture allocation per parcel or rebuild');
    const materials = assets.luxuryMaterials.size;
    for (let n = 0; n < 24; n++) {
      const commercial = assets.building('C', 3 + n % 4, n, n % 2 === 0) as Entity; app.root.addChild(commercial);
      assert.ok(commercial.findByName('Aviation spire'));
      assert.equal(commercial.findByName('Turquoise infinity pool'), null);
      const beacon = (commercial.findByName('Aviation beacon') as Entity).render!.meshInstances[0].material as StandardMaterial;
      assert.equal(beacon, assets.luxuryMaterials.get('beacon'));
      const fadedBeacon = disconnectedBuildingMaterial(beacon);
      beacon.emissiveIntensity = 4; assert.equal(fadedBeacon.emissiveIntensity, 0);
      fadedBeacon.destroy(); commercial.destroy();
    }
    assert.equal(assets.luxuryMaterials.size, materials + 1, 'only one shared beacon material for all commercial towers');
    assert.equal(registered.length, 2); assert.equal(registered[1].blink, true);
    assert.equal(registered[1].strength, 4);
    const low = assets.building('R', 4, 0, false) as Entity;
    assert.equal(low.findByName('Luxury podium'), null); low.destroy();
    for (let n = 0; n < 30; n++) {
      const apartment = assets.building('R', 4 + n % 3, n, n % 2 === 0) as Entity; app.root.addChild(apartment);
      assert.equal(apartment.findByName('Luxury podium'), null);
      const windows = (apartment.findComponents('render') as any[]).filter(r => r.entity.name === 'Apartment warm window');
      assert.equal(windows.length, (3 + n % 3) * 2);
      const windowMaterial = windows[0].meshInstances[0].material as StandardMaterial;
      assert.equal(windowMaterial, assets.apartmentMaterials.get(`window:${n % 2 === 0}`));
      const disconnected = disconnectedBuildingMaterial(windowMaterial);
      windowMaterial.emissiveIntensity = n % 2 === 0 ? 1.8 : 0;
      assert.equal(disconnected.emissiveIntensity, 0); disconnected.destroy(); apartment.destroy();
    }
    assert.equal(assets.apartmentMaterials.size, 9, 'bounded shared palette across all apartment levels and occupancy');
    assert.equal(registered.length, 4, 'one occupied apartment window and one courtyard lamp registration');
    dark.destroy(); assert.equal(mesh.refCount,1, 'source mesh remains owned by asset cache');
    app.destroy(); assert.equal(assets.glassMeshes.size,0); assert.equal(assets.apartmentMaterials.size,0); assert.equal(assets.luxuryMaterials.size,0); assert.equal(sharedMesh.refCount,0);
  } finally {
    globalThis.document = oldDocument;
    if (app.root) app.destroy();
    mesh.decRefCount(); if (mesh.refCount < 1) mesh.destroy(); material.destroy();
    await rm(out, { recursive: true, force: true });
  }
});

test('central beacon animation uses shared material, requests frames only on transitions and respects night/fade', async () => {
  const out = await mkdtemp(resolve('.test-output/beacon-runtime-'));
  await build({ configFile: false, logLevel: 'silent', build: { ssr: resolve('src/scene-atmosphere.ts'), outDir: out, emptyOutDir: true } });
  const { SceneAtmosphere } = await import(pathToFileURL(resolve(out, 'scene-atmosphere.js')).href);
  // Exercise the actual central animation methods, without pretending NullGraphicsDevice renders pixels.
  const atmosphere = Object.create(SceneAtmosphere.prototype);
  atmosphere.glow = new Map(); atmosphere.blinking = new Set(); atmosphere.beaconSeconds = 0;
  atmosphere.current = { night: 0 }; atmosphere.app = { renderNextFrame: false };
  const beacon = new StandardMaterial(), room = new StandardMaterial();
  try {
    atmosphere.registerGlow(beacon, 4, true); atmosphere.registerGlow(room, 2.2);
    atmosphere.animateBeacons(.2); assert.equal(beacon.emissiveIntensity, 0);
    assert.equal(atmosphere.app.renderNextFrame, false);
    atmosphere.current = { night: 1 }; atmosphere.animateBeacons(.1);
    assert.equal(beacon.emissiveIntensity, 4); assert.equal(atmosphere.app.renderNextFrame, true);
    atmosphere.app.renderNextFrame = false; atmosphere.animateBeacons(.1);
    assert.equal(atmosphere.app.renderNextFrame, false, 'steady pulse does not dirty material/frame');
    atmosphere.animateBeacons(.2); assert.equal(beacon.emissiveIntensity, 0);
    atmosphere.animateBeacons(1.5); assert.equal(beacon.emissiveIntensity, 4);
    atmosphere.current = { night: 0 }; atmosphere.animateBeacons(.01);
    assert.equal(beacon.emissiveIntensity, 0); assert.equal(room.emissiveIntensity, 0, 'beacon clock does not animate rooms');
    assert.equal(atmosphere.glow.size, 2); assert.equal(atmosphere.blinking.size, 1);
  } finally { beacon.destroy(); room.destroy(); await rm(out, { recursive: true, force: true }); }
});
