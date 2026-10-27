import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
    if (version.error?.code === 'ENOENT') return t.skip('ffmpeg is not installed');
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
}
