import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trafficNetworkRules} from './traffic-server-entry-fixture.mjs';
import {panelProviderDenials,isPanelProviderRequest} from './panel-network-denies.mjs';

const origin='http://127.0.0.1:4173';
const providerPaths=['/api/city-advisor/report','/CityManager/api/city-advisor/report','/x/y/api/city-advisor/report?q=1','/api/city-advisor/other','/CityManager/api/city-advisor/other','/x/y/api/city-advisor/other?q=1','/chat/completions','/CityManager/chat/completions','/x/y/chat/completions?q=1'];

test('provider URLs are blocked before origin allow and attempts remain observable',()=>{
 for(const blockedModels of [false,true]){
  const rules=trafficNetworkRules(origin,blockedModels,[...panelProviderDenials(origin),origin+'/api/city-advisor/*',origin+'/*/api/city-advisor/*']);
  const decision=url=>rules.find(rule=>new URLPattern(rule.urlPattern).test(url))?.block;
  const attempts=[];
  for(const path of providerPaths){const url=origin+path;assert.equal(decision(url),true,url);if(isPanelProviderRequest(url))attempts.push(url);}
  assert.deepEqual(attempts,providerPaths.map(p=>origin+p));
  assert.throws(()=>assert.deepEqual(attempts,[]),'a blocked provider attempt fails the same final assertion');
  assert.equal(decision(origin+'/citymanager-api/v1/city-save'),false);
  assert.equal(decision(origin+'/CityManager/assets/game.js'),false);
  assert.equal(decision('https://example.com/unrelated'),true);
 }
});

test('attempt tracker ignores normal paths and detects external provider attempts',()=>{
 const attempts=[];
 for(const url of [origin+'/citymanager-api/v1/city-save',origin+'/CityManager/assets/game.js',origin+'/page?next=/chat/completions','not a URL'])if(isPanelProviderRequest(url))attempts.push(url);
 assert.deepEqual(attempts,[]);
 if(isPanelProviderRequest('https://example.com/x/api/city-advisor/report?x=1'))attempts.push('https://example.com/x/api/city-advisor/report?x=1');
 if(isPanelProviderRequest('https://example.com/chat/completions'))attempts.push('https://example.com/chat/completions');
 assert.equal(attempts.length,2);
});

test('three migrated harnesses install deny rules and assert no provider attempts',()=>{
 for(const file of ['context-smoke.mjs','compact-smoke.mjs','population-smoke.mjs']){
  const source=readFileSync(new URL('./'+file,import.meta.url),'utf8');
  assert.match(source,/import\s*\{\s*panelProviderDenials,\s*isPanelProviderRequest\s*\}\s*from\s*['"]\.\/panel-network-denies\.mjs['"]/);
  assert.match(source,/additionalBlocked:\[\.\.\.panelProviderDenials\(new URL\(url\)\.origin\),new URL\(url\)\.origin\+'\/api\/city-advisor\/\*',new URL\(url\)\.origin\+'\/\*\/api\/city-advisor\/\*'\]/);
  assert.match(source,/Network\.requestWillBeSent/);
  assert.match(source,/isPanelProviderRequest\(u\)\)providerRequests\.push\(u\)/);
  assert.match(source,/assert\.deepEqual\(providerRequests,\s*\[\]/);
  assert.match(source,/assert\.deepEqual\(externalRequests,\s*\[\]/);
  assert.match(source,/server\.assertNoCityWrites\(evaluate\)/);
 }
 const compact=readFileSync(new URL('./compact-smoke.mjs',import.meta.url),'utf8');
 assert.match(compact,/mode==='baseline'&&m\.method === 'Fetch\.requestPaused'/,'historical baseline retains the original fail-closed Fetch route');
});
