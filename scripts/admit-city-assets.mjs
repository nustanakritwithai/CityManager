// Project-specific integrity gate, not a claim of game-dev CLI admission.
import { readFile, readdir, lstat, realpath, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=await realpath(process.cwd()), destination=resolve(root,'public/assets/kenney-city');
const verify=process.argv.includes('--verify'), confirm=process.argv.includes('--confirm');
const source=verify?destination:resolve(process.env.TEMP||'/tmp','citymanager-kenney-stage/candidate');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=await readFile(join(source,'manifest.json'));
const manifest=JSON.parse(manifestBytes), receipt=JSON.parse(await readFile(join(source,'receipt.json'),'utf8'));
assert.equal(manifest.license,'CC0-1.0'); assert.equal(manifest.validation.passed,true);
assert.equal(receipt.manifestSha256,hash(manifestBytes));
const expected=new Set(['manifest.json','receipt.json',...manifest.files.map(f=>f.path)]);
async function walk(path) {
  for (const item of await readdir(path,{withFileTypes:true})) {
    const file=join(path,item.name); assert.equal(item.isSymbolicLink(),false,'No symlinks in asset package');
    if (item.isDirectory()) await walk(file);
    else assert.ok(expected.has(relative(source,file).split(sep).join('/')),'Closed roster rejects unknown files');
  }
}
await walk(source);
for (const file of manifest.files) {
  const path=resolve(source,file.path); assert.ok(path.startsWith(resolve(source)+sep));
  assert.equal((await lstat(path)).isSymbolicLink(),false);
  const bytes=await readFile(path); assert.equal(bytes.length,file.bytes); assert.equal(hash(bytes),file.sha256);
  if (file.path.endsWith('.glb')) {
    assert.equal(bytes.toString('utf8',0,4),'glTF'); assert.equal(bytes.readUInt32LE(4),2); assert.equal(bytes.readUInt32LE(8),bytes.length);
    const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)).trim());
    assert.ok([...(json.images||[]),...(json.buffers||[])].every(x=>!x.uri),'Self-contained GLBs only');
  } else assert.match(bytes.toString('utf8'),/Creative Commons Zero, CC0/);
}
assert.equal(manifest.models.length,8); assert.ok(manifest.validation.totalRuntimeBytes<1200000);
for (const model of manifest.models) {
  assert.ok(model.after.triangles<3000 && model.after.materials<=2);
  assert.ok(Math.abs(model.bounds.min[1])<.001);
  assert.ok(Math.abs(Math.max(model.bounds.max[0]-model.bounds.min[0],model.bounds.max[2]-model.bounds.min[2])-1)<.001);
}
const result={packageId:manifest.id,license:manifest.license,destination:'public/assets/kenney-city',runtimeBytes:manifest.validation.totalRuntimeBytes,triangles:manifest.validation.totalTriangles,files:manifest.files.length,manifestSha256:hash(manifestBytes),blockers:[],exceptions:[],tool:'project integrity gate; game-dev CLI unavailable'};
if (verify) {
  const lock=JSON.parse(await readFile(join(root,'asset-lock.json'),'utf8'));
  assert.equal(lock.manifestSha256,result.manifestSha256); result.verified=true;
} else if (confirm) {
  await mkdir(dirname(destination),{recursive:true});
  assert.ok((await realpath(dirname(destination))).toLowerCase().startsWith((root+sep).toLowerCase()));
  try { await lstat(destination); throw new Error('Destination exists; refuse overwrite. Verify the existing package instead.'); } catch(error) { if(error.code!=='ENOENT') throw error; }
  await mkdir(destination);
  for (const file of expected) { await mkdir(dirname(join(destination,file)),{recursive:true}); await copyFile(join(source,file),join(destination,file)); }
  await writeFile(join(root,'asset-lock.json'),JSON.stringify({...result,admittedAt:new Date().toISOString()},null,2));
  result.admitted=true;
} else result.dryRun=true;
console.log(JSON.stringify(result,null,2));
