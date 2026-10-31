// Public asset + unauthenticated boundary probe only. Never authenticates or writes a city.
// This is NOT proof of a successful authenticated save or PKCE login.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const pageURL=process.env.CITYMANAGER_URL??'https://nustanakritwithai.github.io/CityManager/';
const apiURL=process.env.CITYMANAGER_SAVE_API??'https://citymanager.157-85-96-139.sslip.io/citymanager-api';
const read=async url=>{const response=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30_000),headers:{Accept:'application/json,text/html,*/*'}});return {response,text:await response.text()};};
const result={scope:'read-only public assets and unauthenticated save boundary; authenticated save NOT tested',page:pageURL,api:apiURL,checks:[],ok:false};
try{
 const page=await read(pageURL);assert.equal(page.response.status,200,'public page unavailable');
 const scripts=[...page.text.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/g)].map(match=>new URL(match[1],pageURL));
 assert.ok(scripts.length,'no production bundle');
 let serverBundle=false;
 for(const script of scripts){assert.equal(script.origin,new URL(pageURL).origin,'unexpected script origin');const asset=await read(script);assert.equal(asset.response.status,200,'public bundle unavailable');if(asset.text.includes('/v1/city-save')&&asset.text.includes('market-disabled-server-save-required'))serverBundle=true;}
 assert.ok(serverBundle,'deployed bundle is not the server-only save build');result.checks.push('server-only production bundle available');
 for(const path of ['/v1/city-save','/v1/city-save/archives']){const denied=await read(apiURL+path);assert.equal(denied.response.status,401,`${path} must require authentication`);let body;try{body=JSON.parse(denied.text);}catch{throw Error(`${path} did not return a JSON auth error`);}assert.ok(!body?.raw&&!body?.owner&&!body?.cityId,'unauthenticated city disclosure');result.checks.push(`${path}: unauthenticated 401`);}
 result.ok=true;console.log(JSON.stringify(result,null,2));
}catch(error){result.error=String(error?.message??error);console.error(JSON.stringify(result,null,2));process.exitCode=1;}
finally{await mkdir('.test-output/server-save-smoke',{recursive:true});await writeFile('.test-output/server-save-smoke/live-readonly.json',JSON.stringify(result,null,2));}
