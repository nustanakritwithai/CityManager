// Reproducible, offline preparation after downloading official Kenney archives.
// The optional game-dev CLI is not installed; this script records its own integrity gate.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, getBounds } from '@gltf-transform/functions';
import assert from 'node:assert/strict';

const stage = resolve(process.env.TEMP || '/tmp', 'citymanager-kenney-stage');
const output = join(stage, 'candidate');
const sources = {
  suburban: { version: '2.0', url: 'https://kenney.nl/assets/city-kit-suburban', download: 'https://kenney.nl/media/pages/assets/city-kit-suburban/2c871b7af2-1745479373/kenney_city-kit-suburban_20.zip' },
  commercial: { version: '2.1', url: 'https://kenney.nl/assets/city-kit-commercial', download: 'https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip' },
  industrial: { version: '2.0', url: 'https://kenney.nl/assets/city-kit-industrial', download: 'https://kenney.nl/media/pages/assets/city-kit-industrial/0ec35b139d-1788171848/kenney_city-kit-industrial_2.0.zip' },
  roads: { version: '2.2', url: 'https://kenney.nl/assets/city-kit-roads', download: 'https://kenney.nl/media/pages/assets/city-kit-roads/74288c9459-1791628607/kenney_city-kit-roads.zip' }
};
const choices = [
  ['house-a', 'suburban', 'building-type-a.glb'], ['house-b', 'suburban', 'building-type-e.glb'],
  ['shop-a', 'commercial', 'building-a.glb'], ['shop-b', 'commercial', 'building-d.glb'],
  ['factory-a', 'industrial', 'building-a.glb'], ['factory-b', 'industrial', 'building-d.glb'],
  ['tree', 'suburban', 'tree-small.glb'], ['streetlight', 'roads', 'light-square.glb']
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)).trim());
const stats = bytes => {
  const json = parse(bytes);
  return { bytes: bytes.length, triangles: json.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+(json.accessors[p.indices]?.count??json.accessors[p.attributes.POSITION].count)/3,0), meshes: json.meshes.length, materials: json.materials?.length || 0, textures: json.textures?.length || 0, externalUris: [...(json.images||[]),...(json.buffers||[])].flatMap(x=>x.uri?[x.uri]:[]) };
};
await mkdir(join(output,'models'),{recursive:true}); await mkdir(join(output,'licenses'),{recursive:true});
const roster = [], models = [];
for (const [pack, source] of Object.entries(sources)) {
  const license = await readFile(join(stage,'raw',pack,'License.txt'));
  assert.match(license.toString('utf8'), /Creative Commons Zero, CC0/);
  const licensePath = `licenses/${pack}.txt`;
  await copyFile(join(stage,'raw',pack,'License.txt'),join(output,licensePath));
  source.archiveSha256 = hash(await readFile(join(stage,pack+'.zip')));
  source.licensePath = licensePath;
  roster.push({path:licensePath,bytes:license.length,sha256:hash(license)});
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [name,pack,file] of choices) {
  const inputPath=join(stage,'raw',pack,file), original=await readFile(inputPath);
  const document=await io.read(inputPath);
  await document.transform(weld(),dedup(),prune());
  const scene=document.getRoot().getDefaultScene() || document.getRoot().listScenes()[0];
  const {min,max}=getBounds(scene), width=Math.max(max[0]-min[0],max[2]-min[2]);
  assert.ok(width>0 && Number.isFinite(width));
  const scale=1/width;
  const wrapper=document.createNode(name+'-ground-pivot').setScale([scale,scale,scale]).setTranslation([-(min[0]+max[0])/2*scale,-min[1]*scale,-(min[2]+max[2])/2*scale]);
  for (const child of scene.listChildren()) { scene.removeChild(child); wrapper.addChild(child); }
  scene.addChild(wrapper);
  const bytes=Buffer.from(await io.writeBinary(document)), metrics=stats(bytes);
  assert.deepEqual(metrics.externalUris,[],'Runtime GLBs must be self-contained');
  assert.ok(metrics.bytes<300000 && metrics.triangles<3000 && metrics.materials<=2);
  const path=`models/${name}.glb`; await writeFile(join(output,path),bytes);
  models.push({name,path,pack,originalPath:`Models/GLB format/${file}`,sourceSha256:hash(original),before:stats(original),after:metrics,bounds:getBounds(scene),modifications:['weld','dedup','prune','embed palette PNG','uniform footprint normalization and ground-centred pivot']});
  roster.push({path,bytes:bytes.length,sha256:hash(bytes)});
}
const manifest={schemaVersion:1,id:'kenney-city-small',version:'1.0.0',author:'Kenney',license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',retrievedAt:new Date().toISOString(),sources,models,files:roster,validation:{passed:true,tool:'glTF Transform 4.5.1 + project validation',gameDevCli:'unavailable; not claimed',policy:{maxFileBytes:300000,maxTriangles:3000,maxMaterials:2,noExternalUris:true,groundPivot:true},totalRuntimeBytes:models.reduce((n,m)=>n+m.after.bytes,0),totalTriangles:models.reduce((n,m)=>n+m.after.triangles,0)}};
assert.ok(manifest.validation.totalRuntimeBytes<1200000);
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(join(output,'receipt.json'),JSON.stringify({schemaVersion:1,packageId:manifest.id,manifestSha256:hash(await readFile(join(output,'manifest.json'))),fileCount:roster.length,validatedAt:manifest.retrievedAt},null,2));
console.log(JSON.stringify(manifest.validation,null,2));
console.log('Canonical staged package:',output);
