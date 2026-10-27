// Local server for the player: static files, story.yaml → /story.json, and a disk cache
// for satellite tiles so renders are repeatable and do not hammer the tile host.
// CLI: node scripts/serve.mjs ../tai-kadai-war/story.yaml [port]
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// EOX WMTS layers: bluemarble_3857 (NASA, public domain) or s2cloudless_3857 (Sentinel-2 2016, CC BY 4.0).
const TILE_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/g/{z}/{y}/{x}.jpg';
const LAYERS = new Set(['bluemarble_3857', 's2cloudless_3857']);
const TILE_CACHE = join(ROOT, '.cache/tiles');
// Terrain Tiles (Mapzen/AWS open data, terrarium encoding) for 3D relief.
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const inflight = new Map();
async function tile(layer, z, y, x) {
  const dem = layer === 'dem';
  const file = join(TILE_CACHE, layer, z, y, `${x}.${dem ? 'png' : 'jpg'}`);
  if (existsSync(file)) return readFileSync(file);
  if (!inflight.has(file)) {
    inflight.set(file, (async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch((dem ? DEM_URL : TILE_URL).replace('{layer}', layer).replace('{z}', z).replace('{y}', y).replace('{x}', x));
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, buf);
          return buf;
        }
        if (res.status === 404) return null;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
      return null;
    })().finally(() => inflight.delete(file)));
  }
  return inflight.get(file);
}

export function startServer(storyPath, port = 0) {
  const storyFile = resolve(storyPath);
  const storyDir = dirname(storyFile);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let m;
      if (url.pathname === '/story.json') {
        const story = YAML.parse(readFileSync(storyFile, 'utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(story));
      }
      if ((m = url.pathname.match(/^\/tiles\/([a-z0-9_]+)\/(\d+)\/(\d+)\/(\d+)\.jpg$/)) && LAYERS.has(m[1])) {
        const buf = await tile(m[1], m[2], m[3], m[4]);
        if (!buf) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' });
        return res.end(buf);
      }
      if ((m = url.pathname.match(/^\/dem\/(\d+)\/(\d+)\/(\d+)\.png$/))) {
        const buf = await tile('dem', m[1], m[3], m[2]);
        if (!buf) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
        return res.end(buf);
      }
      // /media/* comes from the story folder, everything else from the engine folder.
      const base = url.pathname.startsWith('/media/') ? storyDir : ROOT;
      const path = join(base, decodeURIComponent(url.pathname === '/' ? '/player/index.html' : url.pathname));
      if (!path.startsWith(base) || !existsSync(path)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(readFileSync(path));
    } catch (err) {
      res.writeHead(500); res.end(String(err));
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startServer(process.argv[2] || '../tai-kadai-war/story.yaml', Number(process.argv[3] || 5180));
  console.log(`preview: http://127.0.0.1:${port}/?preview=1`);
}
