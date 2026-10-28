import { Router } from 'express';
import crypto from 'node:crypto';
import net from 'node:net';
import { hash, token, fail } from './security.js';

export const PAGES_ORIGIN='https://nustanakritwithai.github.io';
export const FIRST_PARTY_ORIGIN='https://citymanager.157-85-96-139.sslip.io';
const b64=/^[A-Za-z0-9_-]{43}$/;
export const validateVerifier=v=>typeof v==='string'&&b64.test(v)&&Buffer.from(v,'base64url').length===32;
export const validateChallenge=validateVerifier;
export const challengeFor=v=>crypto.createHash('sha256').update(v).digest('base64url');
const exact=(body,keys)=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join(',')===keys.sort().join(',');
const stateOK=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{20,128}$/.test(v);

// Tokens are accepted only from Pages on the explicitly listed game operations.
export function pagesBearerAllowed(req){
  if(req.get('origin')!==PAGES_ORIGIN)return false;
  const path=req.originalUrl.split('?')[0];
  if(req.method==='GET')return /^\/v1\/(?:me|wallet(?:\/ledger)?|inventory|listings|my\/listings|receipts|market\/(?:products(?:\/[^/]+\/(?:offers|stats))?|history))$/.test(path);
  if(req.method==='POST')return /^\/v1\/(?:listings|listings\/[^/]+\/(?:buy|cancel)|receipts\/[^/]+\/(?:claim|ack|retry)|recovery\/(?:status|fence))$/.test(path);
  return false;
}
export async function authenticatePagesBearer(pool,req){
  if(!pagesBearerAllowed(req))throw fail(401,'invalid authorization');
  const m=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization')||'');if(!m)throw fail(401,'invalid authorization');
  const r=await pool.query(`SELECT a.* FROM pages_access_tokens t JOIN sessions s ON s.token_hash=t.session_hash JOIN accounts a ON a.id=t.account_id AND a.id=s.account_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now() AND s.revoked_at IS NULL AND s.expires_at>now() AND a.kind='guest'`,[hash(m[1])]);
  if(!r.rows[0])throw fail(401,'invalid or expired access');return r.rows[0];
}

// Forwarded IP is valid only behind a loopback proxy that overwrites the
// header with its own verified peer address. Deployment must verify this.
function source(req){const peer=req.socket.remoteAddress,forwarded=req.get('x-forwarded-for');if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)||typeof forwarded!=='string'||net.isIP(forwarded)===0)throw fail(503,'trusted proxy required');return hash('citymanager:auth-source:'+forwarded);}
async function limit(pool,kind,max){const r=await pool.query(`INSERT INTO pages_auth_rate_limits(bucket,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(bucket) DO UPDATE SET window_start=CASE WHEN pages_auth_rate_limits.window_start<=now()-interval '1 minute' THEN now() ELSE pages_auth_rate_limits.window_start END,attempts=CASE WHEN pages_auth_rate_limits.window_start<=now()-interval '1 minute' THEN 1 ELSE LEAST(pages_auth_rate_limits.attempts+1,1000000) END RETURNING attempts`,[kind]);if(r.rows[0].attempts>max)throw fail(429,'rate limited');}
export async function sourceLimit(pool,req,kind,max){const address=source(req),global=kind+':global';const ceiling=await pool.query("SELECT attempts FROM pages_auth_rate_limits WHERE bucket=$1 AND window_start>now()-interval '1 minute'",[global]);if(ceiling.rows[0]?.attempts>=2400)throw fail(429,'rate limited');await pool.query("DELETE FROM pages_auth_rate_limits WHERE bucket IN (SELECT bucket FROM pages_auth_rate_limits WHERE window_start<now()-interval '1 hour' ORDER BY window_start LIMIT 100)");await limit(pool,kind+':'+address,max);await limit(pool,global,2400);}
const originIs=(req,origin)=>req.get('origin')===origin;

export function pagesAuthRouter({pool,tx,guest,csrf,cookieOptions,secureCookies,firstPartyOrigin=FIRST_PARTY_ORIGIN}){
  const router=Router();router.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});next();});
  router.get('/login',async(req,res,next)=>{try{await sourceLimit(pool,req,'login',120);res.set('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");res.type('html').send(LOGIN_HTML);}catch(e){next(e);}});
  router.post('/authorize',guest,csrf,async(req,res,next)=>{try{
    if(!originIs(req,firstPartyOrigin)||!exact(req.body,['challenge'])||!validateChallenge(req.body.challenge))throw fail(400,'invalid authorization request');
    await sourceLimit(pool,req,'authorize',120);const rawCookie=req.cookies.cm_guest;if(!rawCookie)throw fail(401,'first-party session required');
    const code=token(),expires=new Date(Date.now()+60000),sessionExpires=new Date(Date.now()+180*86400000);
    await tx(async c=>{const s=await c.query('UPDATE sessions SET expires_at=$1 WHERE token_hash=$2 AND account_id=$3 AND revoked_at IS NULL AND expires_at>now() RETURNING token_hash',[sessionExpires,hash(rawCookie),req.account.id]);if(!s.rowCount)throw fail(401,'invalid session');await c.query('DELETE FROM pages_auth_codes WHERE code_hash IN (SELECT code_hash FROM pages_auth_codes WHERE expires_at<now()-interval \'1 day\' ORDER BY expires_at LIMIT 100)');await c.query('UPDATE accounts SET expires_at=NULL WHERE id=$1',[req.account.id]);await c.query('INSERT INTO pages_auth_codes(code_hash,account_id,session_hash,challenge,expires_at) VALUES($1,$2,$3,$4,$5)',[hash(code),req.account.id,hash(rawCookie),req.body.challenge,expires]);});
    res.cookie('cm_guest',rawCookie,{...cookieOptions(sessionExpires),secure:secureCookies,httpOnly:true});res.cookie('cm_csrf',req.cookies.cm_csrf,{...cookieOptions(sessionExpires),secure:secureCookies});res.json({code,expires_in:60});
  }catch(e){next(e);}});
  router.post('/exchange',async(req,res,next)=>{try{
    if(!originIs(req,PAGES_ORIGIN)||!exact(req.body,['code','verifier'])||!validateVerifier(req.body.code)||!validateVerifier(req.body.verifier))throw fail(400,'invalid exchange request');await sourceLimit(pool,req,'exchange',240);
    const raw=token(),expires=new Date(Date.now()+15*60000);const account=await tx(async c=>{const r=await c.query(`UPDATE pages_auth_codes SET consumed_at=now() WHERE code_hash=$1 AND challenge=$2 AND consumed_at IS NULL AND expires_at>now() AND EXISTS (SELECT 1 FROM sessions s WHERE s.token_hash=pages_auth_codes.session_hash AND s.account_id=pages_auth_codes.account_id AND s.revoked_at IS NULL AND s.expires_at>now()) RETURNING account_id,session_hash`,[hash(req.body.code),challengeFor(req.body.verifier)]);if(!r.rowCount)throw fail(401,'invalid authorization code');await c.query('DELETE FROM pages_access_tokens WHERE token_hash IN (SELECT token_hash FROM pages_access_tokens WHERE expires_at<now()-interval \'1 day\' ORDER BY expires_at LIMIT 100)');await c.query('INSERT INTO pages_access_tokens(token_hash,account_id,session_hash,expires_at) VALUES($1,$2,$3,$4)',[hash(raw),r.rows[0].account_id,r.rows[0].session_hash,expires]);return r.rows[0].account_id;});res.json({access_token:raw,token_type:'Bearer',expires_in:900,guest_id:account});
  }catch(e){next(e);}});
  router.post('/recovery-prepare',guest,csrf,async(req,res,next)=>{try{
    if(!originIs(req,firstPartyOrigin)||!exact(req.body,['request_id'])||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.body.request_id))throw fail(400,'invalid request');await sourceLimit(pool,req,'issue',30);const code=token();await tx(async c=>{await c.query('SELECT 1 FROM accounts WHERE id=$1 FOR UPDATE',[req.account.id]);await c.query("DELETE FROM pages_recovery_rotations WHERE (account_id,request_id) IN (SELECT account_id,request_id FROM pages_recovery_rotations WHERE expires_at<now()-interval '7 days' ORDER BY expires_at LIMIT 100)");const prior=await c.query('SELECT code_hash FROM pages_recovery_codes WHERE account_id=$1',[req.account.id]);const inserted=await c.query("INSERT INTO pages_recovery_rotations(account_id,request_id,code_hash,previous_code_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day') ON CONFLICT DO NOTHING RETURNING request_id",[req.account.id,req.body.request_id,hash(code),prior.rows[0]?.code_hash||null]);if(!inserted.rowCount)throw fail(409,'prepare response unavailable; create a new request');});res.json({request_id:req.body.request_id,recovery_code:code});
  }catch(e){next(e);}});
  router.post('/recovery-confirm',guest,csrf,async(req,res,next)=>{try{
    if(!originIs(req,firstPartyOrigin)||!exact(req.body,['request_id','recovery_code'])||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.body.request_id)||!validateVerifier(req.body.recovery_code))throw fail(400,'invalid request');await sourceLimit(pool,req,'confirm',60);
    await tx(async c=>{await c.query('SELECT 1 FROM accounts WHERE id=$1 FOR UPDATE',[req.account.id]);const r=await c.query('SELECT code_hash,previous_code_hash,confirmed_at,expires_at FROM pages_recovery_rotations WHERE account_id=$1 AND request_id=$2 FOR UPDATE',[req.account.id,req.body.request_id]);if(!r.rowCount||r.rows[0].code_hash!==hash(req.body.recovery_code))throw fail(401,'invalid recovery confirmation');const active=await c.query('SELECT code_hash FROM pages_recovery_codes WHERE account_id=$1',[req.account.id]);if(r.rows[0].confirmed_at){if(active.rows[0]?.code_hash!==r.rows[0].code_hash)throw fail(409,'recovery rotation superseded');return;}if(new Date(r.rows[0].expires_at)<=new Date())throw fail(409,'recovery preparation expired');if((active.rows[0]?.code_hash||null)!==r.rows[0].previous_code_hash)throw fail(409,'recovery rotation superseded');await c.query('INSERT INTO pages_recovery_codes(account_id,code_hash) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=now()',[req.account.id,r.rows[0].code_hash]);await c.query('UPDATE pages_recovery_rotations SET confirmed_at=now() WHERE account_id=$1 AND request_id=$2',[req.account.id,req.body.request_id]);});res.json({state:'confirmed'});
  }catch(e){next(e);}});
  router.post('/recover',async(req,res,next)=>{try{
    if(!originIs(req,firstPartyOrigin)||!exact(req.body,['recovery_code'])||!validateVerifier(req.body.recovery_code))throw fail(400,'invalid request');await sourceLimit(pool,req,'recover',20);
    const raw=token(),csrfToken=token(),expires=new Date(Date.now()+180*86400000);
    const account=await tx(async c=>{const r=await c.query("SELECT account_id FROM pages_recovery_codes WHERE code_hash=$1 FOR UPDATE",[hash(req.body.recovery_code)]);if(!r.rowCount)throw fail(401,'invalid recovery code');const id=r.rows[0].account_id;await c.query('UPDATE accounts SET expires_at=NULL WHERE id=$1',[id]);await c.query('INSERT INTO sessions(token_hash,account_id,expires_at,csrf_hash) VALUES($1,$2,$3,$4)',[hash(raw),id,expires,hash(csrfToken)]);return id;});res.cookie('cm_guest',raw,{...cookieOptions(expires),secure:secureCookies,httpOnly:true});res.cookie('cm_csrf',csrfToken,{...cookieOptions(expires),secure:secureCookies});res.json({guest_id:account});
  }catch(e){next(e);}});
  return router;
}

const LOGIN_HTML=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CityManager sign in</title><style>body{font:16px system-ui;max-width:34em;margin:2em auto;padding:0 1em}button,input{font:inherit;padding:.6em;margin:.3em 0}input{width:95%}output{overflow-wrap:anywhere;display:block}section{margin:1.5em 0}</style></head><body><h1>CityManager market</h1><p>Choose how to access your Guest account. Creating a new Guest does not recover an existing account.</p><output id="identity"></output><output id="message" role="status"></output><section><button id="use">Continue with remembered Guest</button><button id="new">Create new Guest</button></section><section><label>Recovery code <input id="recovery" type="password" autocomplete="off"></label><button id="recover">Recover Guest</button></section><section><button id="code">Prepare recovery code</button><output id="secret"></output><button id="confirm-code" disabled>I saved this code</button><p>Save the new code securely, then confirm. Until confirmation, your previous code remains valid.</p></section><script>
const origin='https://nustanakritwithai.github.io',p=new URLSearchParams(location.search),challenge=p.get('challenge'),state=p.get('state'),message=document.getElementById('message');let pendingRecovery=null;
const csrf=()=>document.cookie.split('; ').find(x=>x.startsWith('cm_csrf='))?.slice(8)||'';
async function api(path,body){const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':csrf()},body:JSON.stringify(body)});const b=await r.json();if(!r.ok)throw Error(b.error||'Request failed');return b}
async function act(fn){try{message.textContent='';await fn()}catch(e){message.textContent=e.message}}
async function showIdentity(){const r=await fetch('/citymanager-api/v1/me',{credentials:'same-origin'});document.getElementById('identity').textContent=r.ok?'Remembered Guest: '+(await r.json()).guest_id:'No valid remembered Guest.'}
document.getElementById('use').onclick=()=>act(async()=>{if(!window.opener||!/^[A-Za-z0-9_-]{43}$/.test(challenge||'')||!/^[A-Za-z0-9_-]{20,128}$/.test(state||''))throw Error('Invalid login request');const r=await api('/citymanager-api/v1/pages/authorize',{challenge});window.opener.postMessage({type:'citymanager-auth-code',state,code:r.code},origin);message.textContent='Authorization sent. You may close this window.'});
document.getElementById('new').onclick=()=>act(async()=>{if(!confirm('Create a new Guest? This will replace the remembered session in this browser.'))return;await api('/citymanager-api/v1/auth/guest',{});await showIdentity();message.textContent='New Guest created. Generate a recovery code, then continue.'});
document.getElementById('recover').onclick=()=>act(async()=>{await api('/citymanager-api/v1/pages/recover',{recovery_code:document.getElementById('recovery').value});document.getElementById('recovery').value='';await showIdentity();message.textContent='Guest recovered. Continue when ready.'});
document.getElementById('code').onclick=()=>act(async()=>{const r=await api('/citymanager-api/v1/pages/recovery-prepare',{request_id:crypto.randomUUID()});pendingRecovery=r;document.getElementById('secret').textContent=r.recovery_code;document.getElementById('confirm-code').disabled=false;message.textContent='Save this code securely, then confirm; it is not active yet.'});
document.getElementById('confirm-code').onclick=()=>act(async()=>{if(!pendingRecovery)throw Error('Prepare a new code first');await api('/citymanager-api/v1/pages/recovery-confirm',{request_id:pendingRecovery.request_id,recovery_code:pendingRecovery.recovery_code});pendingRecovery=null;document.getElementById('secret').textContent='';document.getElementById('confirm-code').disabled=true;message.textContent='Recovery code confirmed. Any prior code is now invalid.'});showIdentity().catch(()=>{message.textContent='Unable to check the remembered Guest.'});
</script></body></html>`;
