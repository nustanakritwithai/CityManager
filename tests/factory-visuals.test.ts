import test from 'node:test';
import assert from 'node:assert/strict';
import { AppBase, NullGraphicsDevice, RenderComponentSystem, Entity, StandardMaterial } from 'playcanvas';
import { FactoryVisuals, factoryBounds, factoryVisualTier, factoryWorking } from '../src/factory-visuals.ts';
import { factoryLevel } from '../src/factory-levels.ts';
import type { CityAssets } from '../src/asset-models.ts';

test('factory visual progression uses absolute levels without changing economy/model data', () => {
  for (let level = 4; level <= 9; level++) {
    const tier = factoryVisualTier(level);
    assert.equal(tier.chimneys, level >= 6 ? 2 : 1); assert.equal(tier.annex,level >= 6); assert.equal(tier.lights,level >= 8);
    assert.equal(factoryLevel(level).model,3); assert.equal(factoryLevel(level).jobs,level + 3);
  }
  for (const level of [0,10,4.5]) assert.throws(() => factoryVisualTier(level));
});
test('smoke activity requires workers, road, utilities and actual recipe input', () => {
  const crops = { rice: 2, vegetables: 0, sugarcane: 0 };
  assert.equal(factoryWorking(1,true,true,'rice-mill',crops),true);
  assert.equal(factoryWorking(1,true,true,'cannery',crops),false);
  for (const [workers,road,power] of [[0,true,true],[1,false,true],[1,true,false]] as const) assert.equal(factoryWorking(workers,road,power,'rice-mill',crops),false);
  assert.equal(factoryWorking(1,true,true,undefined,crops),false);
});
test('real engine assembly: fit, support, bounds, smoke origins, bounded shared lifecycle and no lights', () => {
  const canvas = { id:'factory-test',width:1,height:1 } as HTMLCanvasElement, app = new AppBase(canvas);
  app.init({ graphicsDevice:new NullGraphicsDevice(canvas),componentSystems:[RenderComponentSystem],resourceHandlers:[] });
  const registered: {material:StandardMaterial; strength:number; blink?:boolean}[] = [];
  const visuals = new FactoryVisuals(app,(material,strength,blink) => registered.push({material,strength,blink}));
  const material = new StandardMaterial();
  const mock = (name: string) => { const e = new Entity(name); e.addComponent('render',{type:'box',material}); e.setLocalScale(name === 'hall' ? 4 : .6,name === 'hall' ? 2 : name === 'chimney' ? 3 : 1, name === 'hall' ? 3 : .7); e.setLocalPosition(.3,.7,-.2); return e; };
  const levels: number[] = [];
  const assets = { building(_zone:string,level:number) { levels.push(level); return mock('hall'); }, detail(name:string) { return mock(name); } } as unknown as CityAssets;
  try {
    for (let level = 4; level <= 9; level++) {
      const root = visuals.build(assets,level,0,true,true); app.root.addChild(root);
      const bounds = factoryBounds(root); assert.ok(bounds.halfExtents.x * 2 < 1.8); assert.ok(bounds.halfExtents.z * 2 < 1.8);
      const solids = root.children.filter(e => /Factory (main hall|input tank|chimney \d|loading annex)/.test(e.name)) as Entity[];
      for (const solid of solids) { const b = factoryBounds(solid); assert.ok(Math.abs(b.center.y-b.halfExtents.y-.1)<1e-5, `${solid.name} supported at ground`); }
      for (let a=0;a<solids.length;a++) for(let b=a+1;b<solids.length;b++) assert.equal(factoryBounds(solids[a]).intersects(factoryBounds(solids[b])),false,`${solids[a].name} must not intersect ${solids[b].name}`);
      const chimney = root.findByName('Factory chimney 0') as Entity, tip=factoryBounds(chimney), puff=root.findByName('Factory chimney smoke') as Entity;
      assert.ok(puff); assert.ok(Math.abs(puff.getLocalPosition().x-tip.center.x)<1e-5); assert.ok(Math.abs(puff.getLocalPosition().y-tip.center.y-tip.halfExtents.y-.035)<1e-5);
      assert.equal(root.findComponents('light').length,0); root.destroy(); assert.equal(visuals.smokeCount,0);
    }
    assert.ok(levels.every(level=>level===3),'actual levels are mapped once to admitted factory model tier');
    const roots: Entity[]=[];
    for(let i=0;i<30;i++) { const root=visuals.build(assets,9,i,true,true);app.root.addChild(root);roots.push(root); }
    assert.equal(visuals.smokeCount,FactoryVisuals.SMOKE_BUDGET); assert.equal(registered.length,2,'only shared warm and warning glow materials');
    for(const r of registered) { assert.equal(r.material.emissiveIntensity,0); r.material.emissiveIntensity=r.strength; }
    const inactive=visuals.build(assets,9,0,false,false);app.root.addChild(inactive);
    assert.equal(inactive.findByName('Factory chimney smoke'),null); assert.equal(((inactive.findByName('Factory warm yard light') as Entity).render!.meshInstances[0].material as StandardMaterial).emissiveIntensity,0);
    for(const r of roots) r.destroy(); inactive.destroy(); assert.equal(visuals.smokeCount,0);
    for(const [low,reduced] of [[true,false],[false,true]]) { const r=visuals.build(null,9,0,true,true,low,reduced);app.root.addChild(r);assert.equal(r.findByName('Factory chimney smoke'),null);r.destroy(); }
    for(let i=0;i<20;i++) { const r=visuals.build(null,9,0,true,true); app.root.addChild(r);r.destroy(); } assert.equal(visuals.smokeCount,0);
  } finally { app.destroy(); material.destroy(); }
});
