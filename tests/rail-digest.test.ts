import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { snapshotDigest, MAX_SNAPSHOT_DIGEST_CHARS } from '../src/rail/snapshot-digest.ts';

const reference = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const check = (text: string) => {
  const digest = snapshotDigest(text);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, reference(text));
};

test('snapshot digest matches SHA-256 for empty, ASCII and standard multi-block messages', () => {
  for (const text of ['', 'abc', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq']) check(text);
  assert.equal(snapshotDigest(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(snapshotDigest('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('snapshot digest hashes UTF-8 Thai, emoji and exact serialized text without normalization', () => {
  for (const text of ['สถานีรถไฟ กรุงเทพฯ 🚆👨‍👩‍👧', 'a\ud800b\udc00c', '\0\n\r\t', 'é', 'e\u0301']) check(text);
  const raw = '{"city":"กรุงเทพฯ 🚉","tick":123,"waiting":8}';
  check(raw);
  assert.notEqual(snapshotDigest(raw), snapshotDigest(raw + ' '));
  assert.notEqual(snapshotDigest(raw), snapshotDigest(raw.replace('waiting":8', 'waiting":9')));
  assert.notEqual(snapshotDigest('é'), snapshotDigest('e\u0301'));
  assert.equal(snapshotDigest(raw), snapshotDigest(raw), 'calls have no retained message state');
});

test('snapshot digest handles both padding blocks and complete input blocks', () => {
  for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1024]) {
    check(Array.from({ length }, (_, i) => String.fromCharCode(32 + i % 95)).join(''));
    check('ก'.repeat(length));
  }
});

test('snapshot digest matches node crypto for approximately one-megabyte snapshots', () => {
  check('a'.repeat(1_000_000));
  check('city-state:0123456789\n'.repeat(50_000));
  check('รถไฟ🚆'.repeat(80_000));
});

test('snapshot digest bounds input before encoding and rejects non-string values', () => {
  assert.equal(MAX_SNAPSHOT_DIGEST_CHARS, 12_000_000);
  assert.throws(() => snapshotDigest('x'.repeat(MAX_SNAPSHOT_DIGEST_CHARS + 1)), RangeError);
  assert.throws(() => snapshotDigest(123 as unknown as string), TypeError);
});
