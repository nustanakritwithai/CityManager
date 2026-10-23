// Project-specific copied-byte integrity gate; not game-dev CLI admission.
import { readFile, readdir, lstat, realpath, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const destination = resolve(root, 'public/assets/kenney-ui');
const lockPath = join(root, 'gui-asset-lock.json');
const args = process.argv.slice(2);
assert.ok(args.every(a => ['--verify', '--confirm'].includes(a)), 'Supported modes: dry-run (default), --confirm, --verify');
const verify = args.includes('--verify'), confirm = args.includes('--confirm');
assert.ok(!(verify && confirm), 'Choose only one mode');
const source = verify ? destination : resolve(process.env.TEMP || '/tmp', 'citymanager-gui-stage/candidate');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const archiveSha256 = 'a8a14a234911eb648c062622915c93e79e94e97cb7f9f375a70f6617f1174318';
const sourceUrl = 'https://kenney.nl/assets/ui-pack';
const downloadUrl = 'https://kenney.nl/media/pages/assets/ui-pack/f651646eab-1718203990/kenney_ui-pack.zip';
const roster = [
  { path: 'License.txt', originalPath: 'License.txt', bytes: 565, sha256: '69f7eaa5e05913b4d09cf5848f75390b5c3c9a409ef8555777803d9ca0c171fb' },
  { path: 'status-ok.png', originalPath: 'PNG/Green/Default/icon_checkmark.png', bytes: 377, sha256: '577dcc143406ab58aa9766482cc9d5e9265a519fd961f9f35fa7468ced87c5d2', width: 20, height: 18 },
  { path: 'status-alert.png', originalPath: 'PNG/Red/Default/icon_cross.png', bytes: 350, sha256: 'a82d428cfe4e89c11317533e6b4fd6566d236f0bc0e816f8659a822e37241202', width: 18, height: 18 },
  { path: 'arrow-up.png', originalPath: 'PNG/Extra/Default/icon_arrow_up_light.png', bytes: 276, sha256: 'ec7841c35398a5a8d1f4cc11d1ed3cb54dd576699fdb3695c05b05827619e165', width: 34, height: 22 },
  { path: 'arrow-down.png', originalPath: 'PNG/Extra/Default/icon_arrow_down_light.png', bytes: 251, sha256: 'd6d01360096a720828f3311e60e757466b8d0a8fece247a04637e91081a50c6c', width: 34, height: 22 }
];
function within(base, target) {
  const path = relative(base, target);
  return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}
assert.equal((await lstat(source)).isSymbolicLink(), false, 'Package root must not be a symlink');
if (verify) assert.ok(within(root, await realpath(source)), 'Package must remain inside project');
const expected = new Set(['manifest.json', 'receipt.json', ...roster.map(f => f.path)]);
const entries = await readdir(source, { withFileTypes: true });
assert.equal(entries.length, expected.size, 'Closed roster rejects missing or extra files');
for (const entry of entries) assert.ok(entry.isFile() && !entry.isSymbolicLink() && expected.has(entry.name), 'Flat closed roster rejects unknown files, directories and symlinks');
const manifestBytes = await readFile(join(source, 'manifest.json'));
const receiptBytes = await readFile(join(source, 'receipt.json'));
const manifest = JSON.parse(manifestBytes), receipt = JSON.parse(receiptBytes);
assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.id, 'kenney-ui-small');
assert.equal(manifest.author, 'Kenney'); assert.equal(manifest.license, 'CC0-1.0');
assert.equal(manifest.source.pack, 'UI Pack'); assert.equal(manifest.source.packVersion, '2.0');
assert.equal(manifest.source.url, sourceUrl); assert.equal(manifest.source.download, downloadUrl);
assert.equal(manifest.source.archiveBytes, 1229750); assert.equal(manifest.source.archiveSha256, archiveSha256);
assert.equal(manifest.source.licensePath, 'License.txt');
assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.packageId, manifest.id);
assert.equal(receipt.manifestSha256, hash(manifestBytes)); assert.equal(receipt.fileCount, roster.length);
assert.equal(manifest.validation.passed, true);
assert.equal(manifest.validation.runtimeBytes, 1254); assert.equal(manifest.validation.payloadBytes, 1819);
assert.equal(manifest.files.length, roster.length); assert.equal(new Set(manifest.files.map(f => f.path)).size, roster.length);
for (const file of roster) {
  const recorded = manifest.files.find(f => f.path === file.path);
  assert.ok(recorded, `Missing manifest record: ${file.path}`);
  for (const key of Object.keys(file)) assert.equal(recorded[key], file[key], `${file.path}: ${key}`);
  assert.deepEqual(recorded.modifications, [], 'Upstream bytes must remain unmodified');
  const path = join(source, file.path);
  assert.equal((await lstat(path)).isSymbolicLink(), false);
  const bytes = await readFile(path);
  assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256);
  if (file.path.endsWith('.png')) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
    assert.equal(bytes.readUInt32BE(8), 13); assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.ok(width > 0 && height > 0 && width <= 256 && height <= 256, 'PNG dimension budget');
    assert.equal(width, file.width); assert.equal(height, file.height);
    assert.equal(bytes.toString('ascii', bytes.length - 8, bytes.length - 4), 'IEND', 'Complete PNG');
  } else {
    assert.match(bytes.toString('utf8'), /Creative Commons Zero, CC0/);
    assert.match(bytes.toString('utf8'), /UI Pack \(2\.0\)/);
  }
}
const result = { packageId: manifest.id, license: manifest.license, destination: 'public/assets/kenney-ui', images: 4, files: 5, runtimeBytes: 1254, payloadBytes: 1819, manifestSha256: hash(manifestBytes), receiptSha256: hash(receiptBytes), sourceArchiveSha256: archiveSha256, blockers: [], exceptions: [], tool: 'project integrity gate; game-dev CLI unavailable' };
if (verify) {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const key of ['packageId', 'license', 'destination', 'runtimeBytes', 'payloadBytes', 'manifestSha256', 'receiptSha256', 'sourceArchiveSha256']) assert.equal(lock[key], result[key], `Lock mismatch: ${key}`);
  result.verified = true;
} else if (confirm) {
  await mkdir(dirname(destination), { recursive: true });
  assert.ok(within(root, await realpath(dirname(destination))), 'Destination parent must remain inside project');
  for (const path of [destination, lockPath]) {
    try { await lstat(path); throw new Error('Destination or GUI lock exists; refuse overwrite. Use --verify.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(destination);
  for (const file of expected) await copyFile(join(source, file), join(destination, file), constants.COPYFILE_EXCL);
  await writeFile(lockPath, JSON.stringify({ ...result, admittedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
  result.admitted = true;
} else result.dryRun = true;
console.log(JSON.stringify(result, null, 2));
