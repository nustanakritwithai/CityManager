
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [runtime, startupPath, caddyPath, output] = process.argv.slice(2).map(value => path.resolve(value));
if (!output) throw Error('Usage: node stage-runtime.mjs <runtime> <startup.ps1> <Caddyfile> <new-output-directory>');
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex').toUpperCase();
const edit = (source, old, next, label) => {
  if (source.split(old).length !== 2) throw Error('Unexpected baseline in ' + label);
  return source.replace(old, () => next);
};
const bytes = name => fs.readFileSync(path.join(runtime,'src',name));
const oldServer = bytes('server.js');
const oldAuth = bytes('pages-auth.js');
const slots = fs.readFileSync(path.join(moduleDir,'slots.mjs'));
const oldStartup = fs.readFileSync(startupPath);
const oldProxy = fs.readFileSync(caddyPath);

const mount = "app.use('/v1/city-save',serverCityRouter({Router:express.Router,json:express.json,service:createServerCityService(createServerCityPgStore({pool,tx})),guest,csrf}));";
const additions = "app.use('/v1/city-save/slots',createCitySlotRouter({Router:express.Router,json:express.json,guest,csrf,pool,tx,createStore:createServerCityPgStore,createSaveRouter:serverCityRouter}));";
const server = "import {createCitySlotRouter} from './city-saves/slots.mjs';\n" + edit(oldServer.toString(),mount,additions+'\n'+mount,'server.js');
const auth = "import {allowsCitySlotRequest} from './city-saves/slots.mjs';\n" + edit(oldAuth.toString(),
  "  const path=req.originalUrl.split('?')[0];",
  "  const path=req.originalUrl.split('?')[0];\n  if(allowsCitySlotRequest(req.method,path))return true;",'pages-auth.js');
const anchor = '/v1/city-save /v1/city-save/archives /v1/city-save/archives/*';
const routes = ['/v1/city-save/slots'];
for (const slot of [1,2,3]) {
  const base = '/v1/city-save/slots/' + slot;
  routes.push(base,base+'/archives',base+'/archives/*');
}
const proxy = edit(oldProxy.toString(),anchor,anchor+' '+routes.join(' '),'Caddyfile');
let startup = edit(oldStartup.toString(),hash(oldServer),hash(server),'startup server hash');
startup = edit(startup,hash(oldAuth),hash(auth),'startup Pages auth hash');
const storeGuard = "'src\\city-saves\\router.mjs'";
startup = edit(startup,storeGuard,"'src\\city-saves\\slots.mjs' = '"+hash(slots)+"';\r\n  "+storeGuard,'startup router guard');
const livePaths = {
  'src/server.js': path.join(runtime,'src','server.js'),
  'src/pages-auth.js': path.join(runtime,'src','pages-auth.js'),
  'src/city-saves/slots.mjs': path.join(runtime,'src','city-saves','slots.mjs'),
  'startup.ps1': startupPath,
  'Caddyfile': caddyPath,
};
if (fs.existsSync(livePaths['src/city-saves/slots.mjs'])) throw Error('Slot module already present at runtime');
const contents = { 'src/server.js':server, 'src/pages-auth.js':auth, 'src/city-saves/slots.mjs':slots, 'startup.ps1':startup, 'Caddyfile':proxy };
const previous = { 'src/server.js':oldServer, 'src/pages-auth.js':oldAuth, 'startup.ps1':oldStartup, 'Caddyfile':oldProxy };
fs.mkdirSync(output);
for (const [name, content] of Object.entries(contents)) {
  const dest = path.join(output,name);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,content);
}
fs.copyFileSync(path.join(moduleDir,'slots.sql'),path.join(output,'slots.sql'));
const manifest = Object.keys(contents).map(name => ({
  name, path:livePaths[name], before:previous[name] ? hash(previous[name]) : null, after:hash(contents[name]),
}));
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Prepared guarded staging files and SHA-256 manifest.');
