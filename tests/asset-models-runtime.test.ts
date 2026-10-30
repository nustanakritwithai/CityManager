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
  const assets = new CityAssets(app), registered: { material: StandardMaterial; strength: number }[] = [];
  assets.glowRegistrar = (material: StandardMaterial, strength: number) => registered.push({ material, strength });
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
    assert.equal(dark.findComponents('render').length, 1); assert.equal(registered.length, 0);
    const first = assets.building('R',7,0,true) as Entity; app.root.addChild(first);
    const renders = first.findComponents('render') as any[];
    assert.equal(renders.length, 2);
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
    dark.destroy(); assert.equal(mesh.refCount,1, 'source mesh remains owned by asset cache');
    app.destroy(); assert.equal(assets.glassMeshes.size,0); assert.equal(sharedMesh.refCount,0);
  } finally {
    globalThis.document = oldDocument;
    if (app.root) app.destroy();
    mesh.decRefCount(); if (mesh.refCount < 1) mesh.destroy(); material.destroy();
    await rm(out, { recursive: true, force: true });
  }
});
