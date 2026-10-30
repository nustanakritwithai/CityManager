import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {citySaveRouter} from '../server/city-saves/router.mjs';
const enabled=process.env.CITY_SAVE_TEST_HTTP==='1';
test('router enforces injected guest and CSRF middleware on mutations',{skip:!enabled},async()=>{
 const require=createRequire(process.env.CITY_SAVE_TEST_PG_PACKAGE),express=require('express');let calls=0;
 const guest=(req,res,next)=>req.get('x-test-guest')? (req.account={id:req.get('x-test-guest')},next()):res.sendStatus(401);
 const csrf=(req,res,next)=>req.get('x-test-csrf')==='yes'?next():res.sendStatus(403);
 const service={list:async owner=>[{owner}],read:async(owner,cityId)=>({owner,cityId}),mutate:async(owner,key,body)=>{calls++;return {owner,key,body};}};
 const app=express();app.use(express.json({limit:'1mb'}));app.use('/v1/saves',citySaveRouter({Router:express.Router,service,guest,csrf}));
 const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const base=`http://127.0.0.1:${listener.address().port}/v1/saves`,request=options=>fetch(base,{method:'POST',headers:{'content-type':'application/json',...options.headers},body:'{}'});
  assert.equal((await request({headers:{}})).status,401);assert.equal((await request({headers:{'x-test-guest':'a'}})).status,403);assert.equal(calls,0);
  const ok=await request({headers:{'x-test-guest':'a','x-test-csrf':'yes','idempotency-key':'key'}});assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{owner:'a',key:'key',body:{}});assert.equal(calls,1);
  assert.equal((await fetch(base)).status,401);assert.deepEqual(await (await fetch(base,{headers:{'x-test-guest':'b'}})).json(),[{owner:'b'}]);
 }finally{await new Promise((resolve,reject)=>listener.close(e=>e?reject(e):resolve()));}
});
