/** Synchronous SHA-256 of UTF-8 snapshot bytes. This binds saved state to a city
 * revision; it is not an authentication mechanism. No storage or platform crypto.
 * Algorithm: FIPS 180-4, sections 4.2.2, 5.1.1, 5.3.3 and 6.2.2.
 * https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
 */
export const MAX_SNAPSHOT_DIGEST_CHARS = 12_000_000;

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotateRight = (word: number, bits: number) => (word >>> bits) | (word << (32 - bits));

/** Lowercase hexadecimal SHA-256, preserving whitespace, key order and Unicode.
 * TextEncoder uses standard UTF-8 replacement for unpaired UTF-16 surrogates.
 * Memory is bounded by the encoded input plus a 64-word schedule and 128-byte tail.
 */
export function snapshotDigest(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Snapshot digest requires a string');
  if (value.length > MAX_SNAPSHOT_DIGEST_CHARS) throw new RangeError('Snapshot exceeds digest limit');
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  const compress = (block: Uint8Array, offset: number) => {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      words[i] = (block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + sum1 + choose + ROUND_CONSTANTS[i] + words[i]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  };

  const fullLength = bytes.length - bytes.length % 64;
  for (let offset = 0; offset < fullLength; offset += 64) compress(bytes, offset);
  const remainder = bytes.length - fullLength;
  const tail = new Uint8Array(remainder < 56 ? 64 : 128);
  tail.set(bytes.subarray(fullLength));
  tail[remainder] = 0x80;
  const lengthView = new DataView(tail.buffer);
  lengthView.setUint32(tail.length - 8, Math.floor(bytes.length / 0x20000000));
  lengthView.setUint32(tail.length - 4, bytes.length * 8);
  for (let offset = 0; offset < tail.length; offset += 64) compress(tail, offset);
  return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('');
}
