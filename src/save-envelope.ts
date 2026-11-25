import { SERVER_CITY_MAX_BYTES } from './server-save-size.ts';
import { TILE_SCALE } from './tile-scale.ts';
/**
 * A big town's save, and any save too large for the server's 8 MiB limit, travels deflated. The server keeps each save
 * as one JSON object and reads only its market journal, so the envelope carries that journal as it is and the whole save
 * beside it, deflated and in base64: `{"packed":"citymanager-deflate-1","bytes":…,"data":…,"market":…}`. A big town of
 * thousands of households writes saves of 7–8 MB, a minute's autosave each, which deflate to about a tenth. Every other
 * save that fits travels exactly as it always has, so cities that save today are untouched.
 */
export const PACKED_SAVE = 'citymanager-deflate-1';
const PREFIX = `{"packed":"${PACKED_SAVE}",`;
type Packed = { packed: typeof PACKED_SAVE; bytes: number; data: string; market?: unknown };

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)).arrayBuffer());
}
function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function fromBase64(text: string): Uint8Array {
  const binary = atob(text), out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
/** Whether text sent to or kept by the server is a packed save. */
export const isPackedSave = (wire: string): boolean => wire.startsWith(PREFIX);

/** The text to send the server for a save: its packed envelope for a big town or a save over the limit, else the save itself. */
export async function packSave(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw), over = bytes.length > SERVER_CITY_MAX_BYTES;
  // Only a save whose own top level says so is a big town's (tile-scale.ts); most saves never mention it.
  if (!over && !raw.includes(`"tileScale":${TILE_SCALE}`)) return raw;
  const { market, tileScale } = JSON.parse(raw) as { market?: unknown; tileScale?: unknown };
  if (!over && tileScale !== TILE_SCALE) return raw;
  const data = toBase64(await through(bytes, new CompressionStream('deflate-raw')));
  const envelope: Packed = { packed: PACKED_SAVE, bytes: bytes.length, data, ...(market === undefined ? {} : { market }) };
  return JSON.stringify(envelope);
}

/** The save the server holds, from its text: unchanged unless packed. A damaged envelope is refused, never half read. */
export async function unpackSave(wire: string): Promise<string> {
  if (!isPackedSave(wire)) return wire;
  const fail = (): never => { throw Error('invalid-packed-save'); };
  let value: Packed;
  try { value = JSON.parse(wire) as Packed; } catch { return fail(); }
  const keys = Object.keys(value).sort().join(',');
  if (value.packed !== PACKED_SAVE || (keys !== 'bytes,data,packed' && keys !== 'bytes,data,market,packed') || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || typeof value.data !== 'string') fail();
  let bytes: Uint8Array, raw: string;
  try { bytes = await through(fromBase64(value.data), new DecompressionStream('deflate-raw')); raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail(); }
  if (bytes.length !== value.bytes) fail();
  let save: { market?: unknown };
  try { save = JSON.parse(raw) as { market?: unknown }; } catch { return fail(); }
  // The journal the server checks is the save's own.
  if (!save || typeof save !== 'object' || Array.isArray(save) || JSON.stringify(save.market) !== JSON.stringify(value.market)) fail();
  return raw;
}
