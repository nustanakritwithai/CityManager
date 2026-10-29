// Project-local closed-package verification; game-dev CLI is not installed here.
import {readFile,readdir,lstat,mkdir,copyFile,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dest=join(root,'public/assets/tabler-roads');
const verify=process.argv.includes('--verify'),confirm=process.argv.includes('--confirm');
assert.ok(process.argv.slice(2).every(x=>['--verify','--confirm'].includes(x)));assert.ok(!(verify&&confirm));
const source=verify?dest:(process.env.CITY_ROAD_ICON_STAGE||'/tmp/city-road-icons/candidate');
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifestBytes=await readFile(join(source,'manifest.json')),receiptBytes=await readFile(join(source,'receipt.json'));
assert.equal(hash(manifestBytes),'80f264c664dc5cfa4f7fd76a9e92aacf45a4ad75af6cd1843cde46e9950f43b4');assert.equal(hash(receiptBytes),'d81aa8c7a305df6c7a20694da1f6bb2257f001086b8f82755a61be214d8ee826');
const manifest=JSON.parse(manifestBytes),receipt=JSON.parse(receiptBytes);
assert.equal(manifest.license,'MIT');assert.equal(receipt.manifestSha256,hash(manifestBytes));assert.equal(receipt.fileCount,4);
const roster=['manifest.json','receipt.json',...manifest.files.map(f=>f.path)];
assert.deepEqual((await readdir(source)).sort(),[...roster].sort());assert.ok(!(await lstat(source)).isSymbolicLink());
for(const name of roster)assert.ok((await lstat(join(source,name))).isFile()&&!(await lstat(join(source,name))).isSymbolicLink());
for(const f of manifest.files){const bytes=await readFile(join(source,f.path));assert.equal(bytes.length,f.bytes);assert.equal(hash(bytes),f.sha256);if(f.path.endsWith('.svg')){const text=bytes.toString();assert.ok(text.includes('viewBox="0 0 24 24"'));assert.ok(!/<(?:script|foreignObject|image|use)\b|\bon\w+\s*=|(?:href|src)\s*=/i.test(text));}}
if(!verify&&!confirm){console.log(JSON.stringify({source,destination:dest,license:manifest.license,files:roster,blockers:[],mode:'dry-run'}));process.exit(0);}
if(confirm){await mkdir(dest,{recursive:true});assert.equal(await realpath(dest),dest);for(const name of roster){try{const previous=await readFile(join(dest,name));assert.equal(hash(previous),hash(await readFile(join(source,name))),'Refuse to overwrite different bytes');}catch(e){if(e.code!=='ENOENT')throw e;await copyFile(join(source,name),join(dest,name),1);}}}
console.log(JSON.stringify({package:manifest.id,mode:verify?'verified':'admitted',files:roster.length,manifestSha256:hash(manifestBytes)}));
