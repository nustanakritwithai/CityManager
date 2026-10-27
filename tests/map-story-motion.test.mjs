import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const engines = ['pilot/engine', 'skills/map-story-motion/engine'];
const get = (port, path) => new Promise((yes, no) => {
  const req = request({ host: '127.0.0.1', port, path }, res => {
    const chunks = []; res.on('data', b => chunks.push(b));
    res.on('end', () => yes({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
  });
  req.on('error', no); req.end();
});

for (const engine of engines) {
  test(`${engine}: preview confines decoded paths and resolved links to the chosen root`, async () => {
    const { startServer } = await import(pathToFileURL(join(root, engine, 'scripts/serve.mjs')));
    const tmp = mkdtempSync(join(tmpdir(), 'map-preview-test-'));
    const story = join(tmp, 'story'), sibling = join(tmp, 'story-private');
    mkdirSync(join(story, 'media'), { recursive: true }); mkdirSync(sibling);
    writeFileSync(join(story, 'story.yaml'), 'title: fixture\n');
    writeFileSync(join(story, 'media', 'ok.txt'), 'allowed');
    mkdirSync(join(story, 'geo')); writeFileSync(join(story, 'geo', 'story.json'), '{"ok":true}');
    writeFileSync(join(sibling, 'secret.txt'), 'never serve');
    symlinkSync(sibling, join(story, 'media', 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(join(story, 'media'), join(story, 'media', 'inside'), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(join(story, 'media'), join(story, 'media-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const { server, port } = await startServer(join(story, 'story.yaml'));
    try {
      assert.deepEqual(await get(port, '/media/ok.txt'), { status: 200, body: 'allowed' });
      assert.deepEqual(await get(port, '/media/inside/ok.txt'), { status: 200, body: 'allowed' });
      assert.equal((await get(port, '/')).status, 200);
      if (engine.startsWith('skills/')) assert.deepEqual(await get(port, '/geo/story.json'), { status: 200, body: '{"ok":true}' });
      assert.equal((await get(port, '/media/..%2f..%2fstory-private%2fsecret.txt')).status, 404);
      assert.equal((await get(port, '/media/..%5c..%5cstory-private%5csecret.txt')).status, 404);
      assert.equal((await get(port, '/media/outside/secret.txt')).status, 404);
      assert.equal((await get(port, '/media/%00secret')).status, 404);
    } finally { await new Promise(resolve => server.close(resolve)); }
    const { safeFile } = await import(pathToFileURL(join(root, engine, 'scripts/safe-path.mjs')));
    assert.equal(safeFile(story, '/media-link/ok.txt'), join(story, 'media', 'ok.txt'));
    assert.equal(safeFile(story, '/../story-private/secret.txt'), null);
    assert.equal(safeFile(story, '/media/outside/secret.txt'), null);
  });

  test(`${engine}: repeated still renders preserve pre-existing output and stay inside each new directory`, async () => {
    const { renderStills } = await import(pathToFileURL(join(root, engine, 'scripts/stills.mjs')));
    const out = mkdtempSync(join(tmpdir(), 'map-stills-test-'));
    mkdirSync(join(out, 'stills')); writeFileSync(join(out, 'stills', 'user.png'), 'user original');
    writeFileSync(join(out, 'contact-sheet.png'), 'old contact sheet');
    const captures = [], times = [];
    const page = { evaluate: async (_fn, t) => times.push(t), screenshot: async ({ path }) => { captures.push(path); writeFileSync(path, 'new still'); } };
    const buildSheet = async (_dir, sheet) => writeFileSync(sheet, 'new sheet');
    const options = { out, scenes: [{ id: '../../escape', start: 0, end: 10 }, { id: 'next', start: 10, end: 20 }], page, at: 0.8, stage: {}, buildSheet };
    const first = await renderStills(options); const second = await renderStills(options);
    assert.notEqual(first.dir, second.dir);
    assert.deepEqual(times, [8, 18, 8, 18]);
    for (const [i, file] of captures.entries()) assert.equal(dirname(file), i < 2 ? first.dir : second.dir);
    assert.equal(readFileSync(join(out, 'stills', 'user.png'), 'utf8'), 'user original');
    assert.equal(readFileSync(join(out, 'contact-sheet.png'), 'utf8'), 'old contact sheet');
    assert.equal(readFileSync(first.sheet, 'utf8'), 'new sheet');
    assert.equal(readFileSync(second.sheet, 'utf8'), 'new sheet');
    assert.deepEqual(JSON.parse(readFileSync(join(first.dir, 'scenes.json'), 'utf8')), [
      { file: '000001.png', scene: '../../escape', time: 8 },
      { file: '000002.png', scene: 'next', time: 18 },
    ]);
  });

  test(`${engine}: FFmpeg reads still sequence without glob support`, async t => {
    const version = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    if (version.error?.code === 'ENOENT') { if (process.env.MAP_REQUIRE_FFMPEG) assert.fail('ffmpeg is required in CI'); return t.skip('ffmpeg is not installed'); }
    assert.equal(version.status, 0);
    const { renderStills, contactSheetArgs } = await import(pathToFileURL(join(root, engine, 'scripts/stills.mjs')));
    const tmp = mkdtempSync(join(tmpdir(), 'map-ffmpeg-test-'));
    const out = join(tmp, 'out%literal'); mkdirSync(out);
    const source = join(tmp, 'source.png');
    const create = spawnSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=blue:s=16x16','-frames:v','1',source], { encoding:'utf8' });
    assert.equal(create.status, 0, create.stderr);
    const page = { evaluate: async () => {}, screenshot: async ({ path }) => copyFileSync(source, path) };
    const result = await renderStills({ out, scenes:[{ id:'a',start:0,end:1 },{ id:'b',start:1,end:2 }], page, at:0.8, stage:{},
      buildSheet: async (dir,sheet,count) => { const run=spawnSync('ffmpeg',contactSheetArgs(dir,sheet,count),{encoding:'utf8'});assert.equal(run.status,0,run.stderr); } });
    assert.deepEqual([...readFileSync(result.sheet).subarray(0,8)], [137,80,78,71,13,10,26,10]);
  });

  test(`${engine}: video and voice outputs never replace existing files`, async () => {
    const { safeOutputName, videoOutput, muxOutput, withExclusiveOutput } = await import(pathToFileURL(join(root, engine, 'scripts/output-files.mjs')));
    const parent = mkdtempSync(join(tmpdir(), 'map-output-test-'));
    const out = join(parent, 'out'); mkdirSync(out);
    for (const name of ['clip.mp4','clip.srt','.seg-0.mp4','.segs.txt']) writeFileSync(join(out,name), `original ${name}`);
    for (const bad of ['../clip','../../existing','/absolute','a\\b','C:foo','..','CON','clip.mp4',true]) {
      assert.throws(() => videoOutput(out,bad), /simple filename/);
    }
    assert.equal(safeOutputName('ข่าว_1'), 'ข่าว_1');
    const a=videoOutput(out,'clip'), b=videoOutput(out,'clip');assert.notEqual(a.dir,b.dir);
    writeFileSync(a.mp4,'first video',{flag:'wx'});writeFileSync(a.srt,'first subtitles',{flag:'wx'});
    writeFileSync(b.mp4,'second video',{flag:'wx'});writeFileSync(b.srt,'second subtitles',{flag:'wx'});
    for (const name of ['clip.mp4','clip.srt','.seg-0.mp4','.segs.txt']) assert.equal(readFileSync(join(out,name),'utf8'),`original ${name}`);
    const clip=join(parent,'original.mp4');const oldVoice=join(parent,'original-voice.mp4');writeFileSync(clip,'input');writeFileSync(oldVoice,'old voice');
    const one=muxOutput(clip),two=muxOutput(clip);assert.notEqual(dirname(one),dirname(two));
    writeFileSync(one,'new voice',{flag:'wx'});assert.equal(readFileSync(clip,'utf8'),'input');assert.equal(readFileSync(oldVoice,'utf8'),'old voice');
    assert.throws(()=>muxOutput(join(parent,'input.wav')),/MP4/);
    const fit=join(parent,'story.yaml'),mp3=join(parent,'voice.mp3');writeFileSync(fit,'original story');writeFileSync(mp3,'original audio');
    assert.throws(()=>withExclusiveOutput(fit,()=>{}),error=>error.code==='EEXIST');
    assert.throws(()=>withExclusiveOutput(mp3,()=>{}),error=>error.code==='EEXIST');
    assert.equal(readFileSync(fit,'utf8'),'original story');assert.equal(readFileSync(mp3,'utf8'),'original audio');
    const fresh=join(parent,'new.yaml');withExclusiveOutput(fresh,fd=>writeFileSync(fd,'new story'));
    assert.equal(readFileSync(fresh,'utf8'),'new story');
    const link=join(parent,'linked-output');symlinkSync(out,link,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>videoOutput(link,'clip'),/symlink/);
  });

  test(`${engine}: exclusive MP3 output works with FFmpeg`, async t => {
    const version=spawnSync('ffmpeg',['-version'],{encoding:'utf8'});
    if(version.error?.code==='ENOENT'){ if (process.env.MAP_REQUIRE_FFMPEG) assert.fail('ffmpeg is required in CI'); return t.skip('ffmpeg is not installed'); }
    const { withExclusiveOutput }=await import(pathToFileURL(join(root,engine,'scripts/output-files.mjs')));
    const parent=mkdtempSync(join(tmpdir(),'map-mp3-test-')), output=join(parent,'voice.mp3');
    withExclusiveOutput(output,fd=>{
      const run=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.1','-c:a','libmp3lame','-f','mp3','pipe:1'],{stdio:['ignore',fd,'pipe']});
      assert.equal(run.status,0,run.stderr?.toString());
    });
    assert.ok(readFileSync(output).length>0);
    assert.throws(()=>withExclusiveOutput(output,()=>{}),error=>error.code==='EEXIST');
  });

  test(`${engine}: real render and voice commands preserve existing files`, async t => {
    const version=spawnSync('ffmpeg',['-version'],{encoding:'utf8'});
    if(version.error?.code==='ENOENT'){ if (process.env.MAP_REQUIRE_FFMPEG) assert.fail('ffmpeg is required in CI'); return t.skip('ffmpeg is not installed'); }
    const tmp=mkdtempSync(join(tmpdir(),'map-cli-test-')), work=join(tmp,'engine'), scripts=join(work,'scripts');
    const story=join(tmp,'story.yaml'), out=join(tmp,'out'), modules=join(work,'node_modules');
    mkdirSync(scripts,{recursive:true});mkdirSync(join(modules,'playwright'),{recursive:true});mkdirSync(join(modules,'yaml'),{recursive:true});mkdirSync(out);
    for(const name of ['serve.mjs','safe-path.mjs','safe-cache.mjs','stills.mjs','output-files.mjs','render.mjs','voice.mjs']) copyFileSync(join(root,engine,'scripts',name),join(scripts,name));
    writeFileSync(join(work,'package.json'),'{"type":"module"}');
    writeFileSync(join(modules,'playwright','package.json'),'{"main":"index.cjs"}');
    writeFileSync(join(modules,'playwright','index.cjs'),`const fs=require('fs');exports.chromium={launch:async()=>({newPage:async()=>({on(){},goto:async()=>{},waitForFunction:async()=>{},evaluate:async(fn)=>String(fn).includes('window.TOTAL')?{TOTAL:1,FPS:1,SCENES:[{id:'a',start:0,end:1,sub:'fixture'}]}:undefined,screenshot:async()=>fs.readFileSync(process.env.TEST_FRAME)}),close:async()=>{}})};`);
    writeFileSync(join(modules,'yaml','package.json'),'{"main":"index.cjs"}');
    writeFileSync(join(modules,'yaml','index.cjs'),"module.exports={parse:()=>({scenes:[{id:'a',dur:1,voice:'fixture'}]}),stringify:()=> 'fixture'};");
    writeFileSync(story,'original story');
    for(const name of ['clip.mp4','clip.srt','.seg-0.mp4','.segs.txt'])writeFileSync(join(out,name),`original ${name}`);
    const frame=join(tmp,'frame.jpg');
    const create=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=16x16','-frames:v','1',frame],{encoding:'utf8'});
    assert.equal(create.status,0,create.stderr);
    const env={...process.env,TEST_FRAME:frame};
    const bad=spawnSync(process.execPath,[join(scripts,'render.mjs'),story,'--out','../../existing'],{env,encoding:'utf8',timeout:20000});
    assert.notEqual(bad.status,0);assert.match(bad.stderr,/simple filename/);
    for(let i=0;i<2;i++){const run=spawnSync(process.execPath,[join(scripts,'render.mjs'),story,'--workers','1','--fps','1','--out','clip'],{env,encoding:'utf8',timeout:30000});assert.equal(run.status,0,run.stderr);}
    const runs=readdirSync(out).filter(n=>n.startsWith('render-'));assert.equal(runs.length,2);
    for(const dir of runs){assert.ok(readFileSync(join(out,dir,'clip.mp4')).length>0);assert.ok(readFileSync(join(out,dir,'clip.srt')).length>0);}
    for(const name of ['clip.mp4','clip.srt','.seg-0.mp4','.segs.txt'])assert.equal(readFileSync(join(out,name),'utf8'),`original ${name}`);
    const probe=spawnSync('ffprobe',['-version'],{encoding:'utf8'});if(probe.error?.code==='ENOENT'){ if (process.env.MAP_REQUIRE_FFMPEG) assert.fail('ffprobe is required in CI'); return t.skip('ffprobe is not installed'); }
    const cache=join(work,'.cache','tts');mkdirSync(cache,{recursive:true});
    const key=createHash('sha1').update('1.5|fixture').digest('hex').slice(0,16),wav=join(cache,key+'.wav');
    const wavRun=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-ar','44100','-ac','1',wav],{encoding:'utf8'});assert.equal(wavRun.status,0,wavRun.stderr);
    const fit=spawnSync(process.execPath,[join(scripts,'voice.mjs'),story,'--fit',story],{env,encoding:'utf8',timeout:20000});
    assert.notEqual(fit.status,0);assert.equal(readFileSync(story,'utf8'),'original story');
    const mp3=join(tmp,'existing.mp3');writeFileSync(mp3,'original audio');
    const voice=spawnSync(process.execPath,[join(scripts,'voice.mjs'),story,'--mp3',mp3],{env,encoding:'utf8',timeout:20000});
    assert.notEqual(voice.status,0);assert.equal(readFileSync(mp3,'utf8'),'original audio');
    const newMp3=join(tmp,'new.mp3');const mp3Run=spawnSync(process.execPath,[join(scripts,'voice.mjs'),story,'--mp3',newMp3],{env,encoding:'utf8',timeout:20000});assert.equal(mp3Run.status,0,mp3Run.stderr);assert.ok(readFileSync(newMp3).length>0);
    const clip=join(out,runs[0],'clip.mp4'), oldVoice=join(out,runs[0],'clip-voice.mp4');writeFileSync(oldVoice,'old voice');
    for(let i=0;i<2;i++){const mux=spawnSync(process.execPath,[join(scripts,'voice.mjs'),story,'--mux',clip],{env,encoding:'utf8',timeout:20000});assert.equal(mux.status,0,mux.stderr);}
    assert.equal(readFileSync(oldVoice,'utf8'),'old voice');
    const voiceRuns=readdirSync(dirname(clip)).filter(n=>n.startsWith('voice-'));assert.equal(voiceRuns.length,2);
    for(const dir of voiceRuns)assert.ok(readFileSync(join(dirname(clip),dir,'clip-voice.mp4')).length>0);
  });
}


test('geo output rejects traversal, existing targets and directory links', async () => {
  const { buildGeoFile } = await import(pathToFileURL(join(root, 'skills/map-story-motion/engine/scripts/geo-output.mjs')));
  const tmp = mkdtempSync(join(tmpdir(), 'map-geo-test-'));
  const story = join(tmp, 'story'), outside = join(tmp, 'outside'); mkdirSync(story); mkdirSync(outside);
  const sentinel = join(outside, 'sentinel.json'); writeFileSync(sentinel, 'original');
  const generate = file => writeFileSync(file, 'generated');
  for (const bad of ['../../outside/sentinel', '/absolute', 'C:\\outside', 'a/b', 'CON']) assert.throws(() => buildGeoFile(story, bad, generate), /simple filename/);
  const geo = join(story, 'geo'); mkdirSync(geo); writeFileSync(join(geo, 'existing.json'), 'existing');
  assert.throws(() => buildGeoFile(story, 'existing', generate), /already exists/);
  try { symlinkSync(sentinel, join(geo, 'linked.json'), 'file'); assert.throws(() => buildGeoFile(story, 'linked', generate), /already exists/); }
  catch (e) { if (!['EPERM', 'EACCES'].includes(e.code)) throw e; }
  assert.equal(readFileSync(buildGeoFile(story, 'fresh', generate), 'utf8'), 'generated');
  assert.throws(() => buildGeoFile(story, 'fresh', generate), /already exists/);
  assert.equal(readFileSync(join(geo, 'existing.json'), 'utf8'), 'existing');
  const linkedStory = join(tmp, 'linked-story'); mkdirSync(linkedStory);
  symlinkSync(outside, join(linkedStory, 'geo'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildGeoFile(linkedStory, 'sentinel', generate), /symlink/);
  assert.equal(readFileSync(sentinel, 'utf8'), 'original');
});


test('cache directories reject junctions and invalid components', async () => {
  for (const engine of engines) {
    const { safeSubdirectory } = await import(pathToFileURL(join(root, engine, 'scripts/safe-cache.mjs')));
    const tmp = mkdtempSync(join(tmpdir(), 'map-cache-test-'));
    const outside = join(tmp, 'outside'), base = join(tmp, 'base'); mkdirSync(outside); mkdirSync(base);
    writeFileSync(join(outside, 'sentinel'), 'original');
    symlinkSync(outside, join(base, '.cache'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => safeSubdirectory(base, ['.cache', 'tiles']), /symlink/);
    assert.throws(() => safeSubdirectory(base, ['..']), /invalid/);
    assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'original');
  }
});


test('geo CLI rejects unsafe src and force before invoking mapshaper', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'map-geo-cli-')), work = join(tmp, 'engine'), scripts = join(work, 'scripts'), modules = join(work, 'node_modules', 'yaml');
  mkdirSync(scripts, { recursive: true }); mkdirSync(modules, { recursive: true });
  for (const name of ['build-geo.mjs', 'validate.mjs', 'geo-output.mjs', 'output-files.mjs']) copyFileSync(join(root, 'skills/map-story-motion/engine/scripts', name), join(scripts, name));
  writeFileSync(join(modules, 'package.json'), '{"main":"index.cjs"}'); writeFileSync(join(modules, 'index.cjs'), 'module.exports={parse: JSON.parse};');
  const storyDir = join(tmp, 'story'); mkdirSync(storyDir); const story = join(storyDir, 'story.yaml');
  const outside = join(tmp, 'outside.json'); writeFileSync(outside, 'sentinel');
  for (const src of ['../../outside', '/absolute', 'C:\\outside']) {
    writeFileSync(story, JSON.stringify({layers: {bad: {type:'area', src, build:{countries:['Laos']}}}, scenes:[]}));
    const build = spawnSync(process.execPath, [join(scripts, 'build-geo.mjs'), story], {encoding:'utf8'});
    assert.notEqual(build.status, 0); assert.match(build.stderr, /Invalid geo src/);
    const validate = spawnSync(process.execPath, [join(scripts, 'validate.mjs'), story], {encoding:'utf8'});
    assert.notEqual(validate.status, 0); assert.match(validate.stdout, /src must be a simple filename/);
  }
  const force = spawnSync(process.execPath, [join(scripts, 'build-geo.mjs'), story, '--force'], {encoding:'utf8'});
  assert.notEqual(force.status, 0); assert.match(force.stderr, /unsupported/);
  assert.equal(readFileSync(outside, 'utf8'), 'sentinel');
});
