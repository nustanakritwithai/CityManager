import LZString from 'lz-string';
const PREFIX='cm-copy-lz1:';
/** Only new recovery copies use this lossless codec. The primary/legacy slots stay JSON. */
export function encodeSaveCopy(raw:string):string {
 if(raw.length<64000)return raw;
 const encoded=PREFIX+LZString.compressToUTF16(raw);
 return encoded.length<raw.length?encoded:raw;
}
export function decodeSaveCopy(raw:string|null):string|null {
 if(raw===null||!raw.startsWith(PREFIX))return raw;
 const decoded=LZString.decompressFromUTF16(raw.slice(PREFIX.length));
 if(!decoded||decoded.length>12_000_000)throw Error('Recovery copy could not be decoded; original save preserved');
 return decoded;
}
