// Read-only staging: writes a candidate under this repository, never over the source.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url));
const source=process.argv[2];
if(!source)throw Error('Usage: node patches/pages-login-thai/stage.mjs <path-to-pages-auth.js>');
const text=readFileSync(source,'utf8'),marker='export const LOGIN_HTML=`',start=text.indexOf(marker),end=text.indexOf('`;',start+marker.length);
if(start<0||end<0||text.indexOf(marker,start+1)>=0)throw Error('Expected exactly one LOGIN_HTML template');
const original=text.slice(start+marker.length,end);
// JavaScript template literals normalize CRLF to LF; accept either checkout convention.
const hash=createHash('sha256').update(original.replace(/\r\n/g,'\n')).digest('hex');
if(hash!=='04d8cfce326bfd8fa2603ab1c4574a850daa52498f4cc3e465e46a3c6ccdf47a')throw Error('LOGIN_HTML differs from the reviewed baseline; stop and re-review');
const candidate=readFileSync(join(dir,'login.html'),'utf8').trimEnd();
if(candidate.includes('`')||candidate.includes('${')||candidate.includes('\\'))throw Error('Unsafe template literal content; stop and re-review');
const output=resolve(dir,'staged','pages-auth.js');
if(resolve(source)===output)throw Error('Source and output must differ');
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,text.slice(0,start+marker.length)+candidate+text.slice(end),{flag:'wx'});
console.log('Candidate staged at '+output);
