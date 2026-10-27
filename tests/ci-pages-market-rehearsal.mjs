// CI-only rehearsal: the exact previously built Pages artifact, the pinned
// market server fixture and a disposable PostgreSQL database. No live service.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { access, mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const pages = 'https://nustanakritwithai.github.io';
const market = 'https://citymanager.157-85-96-139.sslip.io';
const backend = resolve('tests/fixtures/market-server');
const dist = resolve(process.env.CI_MARKET_ARTIFACT_DIR || '');
const screenshots = resolve(process.env.CI_MARKET_SCREENSHOT_DIR || '');
const expectedBackend = '9224423c96c46ce80ee93bd9948b6720969327a8';
let database; try { database = new URL(process.env.DATABASE_URL || ''); } catch { throw new Error('CI database URL required'); }
if (process.env.CI_MARKET_FIXTURE !== '1' || database.protocol !== 'postgresql:' ||
    database.hostname !== '127.0.0.1' || database.port !== '5432' || database.username !== 'ci_market' ||
    database.pathname !== '/citymanager_ci' || database.search || database.hash || !process.env.CI_MARKET_ARTIFACT_DIR ||
    !process.env.CI_MARKET_SCREENSHOT_DIR || !process.env.MAP_TEST_MODULES) {
  throw new Error('refusing to use a non-CI database or missing fixture');
}
const manifest = JSON.parse(await readFile(join(backend, 'source-manifest.json'), 'utf8'));
assert.equal(manifest.backend_revision, expectedBackend);
for (const [path, expected] of Object.entries(manifest.git_blobs)) {
  const bytes = await readFile(join(backend, path));
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(blob, expected, `backend fixture differs: ${path}`);
}
await access(join(dist, 'index.html'));
await mkdir(screenshots, { recursive: true });
const schema = `ci_market_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const port = await new Promise((ok, bad) => {
  const s = createServer(); s.once('error', bad);
  s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(e => e ? bad(e) : ok(n)); });
});
const env = { ...process.env, DATABASE_SCHEMA: schema, PORT: String(port),
  MARKET_PAGES_AUTH_ENABLED: 'true', MARKET_PAGES_TRUSTED_PROXY: 'true',
  MARKET_SECURE_COOKIES: 'true', MARKET_ALLOWED_ORIGINS: market,
  MARKET_RECOVERY_ENABLED: 'false', MARKET_TRADE_REJECTIONS_ENABLED: 'true',
  MARKET_ALLOW_DEPOSITS: 'false', SANDBOX_FIXTURE_MODE: 'false', ADMIN_TOKEN: '',
  NODE_ENV: 'integration' };
if (spawnSync(process.execPath, ['scripts/setup-ci-database.mjs'], { cwd: backend, env, stdio: 'ignore' }).status !== 0)
  throw new Error('isolated migration failed');
const requireBackend = createRequire(join(backend, 'package.json')), { Pool } = requireBackend('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path="${schema}"` });
// The protocol marker must reject the old unguarded configuration before it
// can listen or start a background writer, even without any outcome records.
const oldWriter = spawnSync(process.execPath, ['src/server.js'], { cwd: backend,
  env: { ...env, MARKET_TRADE_REJECTIONS_ENABLED: 'false' }, stdio: 'ignore', timeout: 10000 });
assert.notEqual(oldWriter.status, 0, 'an unguarded writer must not start');
assert.equal(oldWriter.error, undefined, 'guard must reject rather than time out');
const child = spawn(process.execPath, ['src/server.js'], { cwd: backend, env, stdio: 'ignore' });
const proxy = createServer((req, res) => {
  const headers = { ...req.headers, 'x-forwarded-for': '127.0.0.1' };
  const upstream = httpRequest({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, r => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
});
await new Promise((ok, bad) => { proxy.once('error', bad); proxy.listen(0, '127.0.0.1', ok); });
const proxyBase = `http://127.0.0.1:${proxy.address().port}`;
let browser, context, buyerId, listingId, firstPartyCookies = 0, interceptedCookies = 0;
let crossSiteCookies = 0, bearerToken = '', boughtStatus = 0;
const buyKeys = [], problems = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('guarded backend exited');
    try { if ((await fetch(proxyBase + '/health')).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, 'guarded backend readiness');
  const health = await (await fetch(proxyBase + '/health')).json();
  assert.equal(health.deposits_enabled, false); assert.equal(health.fixture_mode, false);
  const role = await pool.query('SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user');
  assert.equal(role.rows[0].name, 'ci_market'); assert.equal(role.rows[0].rolsuper, false); assert.equal(role.rows[0].rolcreatedb, false); assert.equal(role.rows[0].rolcreaterole, false);
  const makeSeller = await fetch(proxyBase + '/v1/auth/guest', {
    method: 'POST', headers: { origin: market, 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(makeSeller.status, 201);
  const seller = await makeSeller.json(), cookies = makeSeller.headers.getSetCookie().map(s => s.split(';')[0]);
  const csrf = cookies.find(s => s.startsWith('cm_csrf='))?.slice(8); assert.ok(csrf);
  await pool.query("UPDATE inventories SET quantity=1 WHERE account_id=$1 AND item_code='crop:rice'", [seller.guest_id]);
  const offer = await fetch(proxyBase + '/v1/listings', {
    method: 'POST', headers: { origin: market, cookie: cookies.join('; '), 'x-csrf-token': csrf,
      'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify({ item_code: 'crop:rice', unit_price: 5, quantity: 1 })
  });
  assert.equal(offer.status, 201); listingId = (await offer.json()).id;
  const requireTest = createRequire(join(process.env.MAP_TEST_MODULES, 'fixture.cjs'));
  const { chromium } = requireTest('playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome' });
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCookieControls', { enableThirdPartyCookieRestriction: true,
    disableThirdPartyCookieMetadata: false, disableThirdPartyCookieHeuristics: false });
  await context.route('**/*', async route => {
    try {
      const req = route.request(), u = new URL(req.url());
      if (u.origin === pages && u.pathname.startsWith('/CityManager/')) {
        const tail = u.pathname.slice('/CityManager/'.length) || 'index.html', path = resolve(dist, tail);
        if (!path.startsWith(dist + sep)) return route.abort();
        const data = await readFile(path);
        const contentType = ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
          '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff',
          '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.mp3': 'audio/mpeg' })[extname(path)] || 'application/octet-stream';
        return route.fulfill({ status: 200, headers: { 'content-type': contentType }, body: data });
      }
      if (u.origin !== market || !u.pathname.startsWith('/citymanager-api/')) return route.abort();
      const all = await req.allHeaders(), headers = {};
      for (const [key, value] of Object.entries(all))
        if (['origin','cookie','content-type','authorization','x-csrf-token','idempotency-key',
          'access-control-request-method','access-control-request-headers'].includes(key.toLowerCase())) headers[key] = value;
      if (all.origin === pages) { if (all.cookie) crossSiteCookies++; if (all.authorization) bearerToken = all.authorization.slice(7); }
      else if (all.cookie) firstPartyCookies++;
      if (u.pathname.endsWith('/buy')) {
        buyKeys.push(headers['idempotency-key']);
        if (buyKeys.length === 1) await pool.query('UPDATE wallets SET balance=0 WHERE account_id=$1', [buyerId]);
      }
      const response = await fetch(proxyBase + u.pathname.slice('/citymanager-api'.length) + u.search,
        { method: req.method(), headers, ...(req.postDataBuffer() ? { body: req.postDataBuffer() } : {}) });
      const responseBody = Buffer.from(await response.arrayBuffer());
      if (u.pathname.endsWith('/v1/auth/guest') && req.method() === 'POST' && response.ok) {
        buyerId = JSON.parse(responseBody).guest_id;
        await pool.query('UPDATE wallets SET balance=10 WHERE account_id=$1', [buyerId]);
      }
      if (u.pathname.endsWith('/buy') && buyKeys.length === 1) {
        assert.equal(response.status, 409); return route.abort('failed');
      }
      if (u.pathname.endsWith('/buy')) boughtStatus = response.status;
      const cookieHeaders = response.headers.getSetCookie();
      for (const raw of cookieHeaders) {
        const name = raw.slice(0, raw.indexOf('='));
        if (!['cm_guest','cm_csrf'].includes(name)) throw new Error('unexpected cookie');
        interceptedCookies++;
      }
      const out = {};
      for (const [key,value] of response.headers)
        if (!['set-cookie','content-encoding','content-length','transfer-encoding'].includes(key)) out[key] = value;
      if (cookieHeaders.length) out['set-cookie'] = cookieHeaders.join('\n');
      await route.fulfill({ status: response.status, headers: out, body: responseBody });
    } catch (error) { problems.push(error instanceof Error ? error.name : 'route-error'); await route.abort().catch(() => {}); }
  });
  page.on('pageerror', () => problems.push('page-error'));
  await page.goto(pages + '/CityManager/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const login = page.locator('.guest-entry-gate button').first();
  await login.waitFor({ state: 'visible', timeout: 30000 });
  await page.screenshot({ path: join(screenshots, 'guest-entry.png') });
  for (let i = 0; i < 100 && !(await login.isEnabled()); i++) await delay(100);
  assert.ok(await login.isEnabled());
  async function openPopup() {
    const pending = context.waitForEvent('page'); await login.click(); const popup = await pending;
    await popup.waitForLoadState('domcontentloaded'); return popup;
  }
  let popup = await openPopup(); popup.once('dialog', dialog => dialog.accept());
  await popup.locator('#new').click();
  await popup.waitForFunction(() => document.querySelector('#identity')?.textContent?.startsWith('Remembered Guest: '));
  const identity = await popup.locator('#identity').textContent(); await popup.locator('#use').click();
  await page.locator('.guest-entry-gate').waitFor({ state: 'hidden', timeout: 30000 });
  await page.locator('.market-launch').waitFor({ state: 'visible', timeout: 30000 });
  const issued = await context.cookies(market);
  assert.ok(interceptedCookies >= 2 && issued.some(c => c.name === 'cm_guest' && c.secure && c.httpOnly && c.sameSite === 'Lax'));
  assert.ok(issued.some(c => c.name === 'cm_csrf' && c.secure && !c.httpOnly && c.sameSite === 'Lax'));
  assert.ok(firstPartyCookies >= 1 && bearerToken); assert.equal(crossSiteCookies, 0);
  assert.equal(await page.evaluate(token => Object.values(localStorage).some(v => v.includes(token)), bearerToken), false);
  await page.reload({ waitUntil: 'domcontentloaded' }); await login.waitFor({ state: 'visible' });
  for (let i = 0; i < 100 && !(await login.isEnabled()); i++) await delay(100);
  popup = await openPopup();
  await popup.waitForFunction(() => document.querySelector('#identity')?.textContent?.startsWith('Remembered Guest: '));
  assert.equal(await popup.locator('#identity').textContent(), identity); await popup.locator('#use').click();
  await page.locator('.guest-entry-gate').waitFor({ state: 'hidden', timeout: 30000 });
  await page.locator('.market-launch').click();
  await page.locator('.market-product').filter({ hasText: 'ข้าว' }).first().click();
  await page.locator('.market-offer button').first().click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'ตรวจสอบและซื้อ' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('citymanager.market.v10') || '{}').operations?.some(o => o.kind === 'buy' && o.state === 'pending'));
  await page.locator('.market-tabs button').nth(2).click();
  await page.getByRole('button', { name: 'ตรวจสอบรายการเดิม' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('citymanager.market.v10') || '{}').operations?.some(o => o.kind === 'buy' && o.state === 'quarantined'));
  await page.screenshot({ path: join(screenshots, 'trade-rejected.png') });
  assert.equal(buyKeys.length, 2); assert.ok(buyKeys[0]); assert.equal(buyKeys[0], buyKeys[1]);
  assert.equal(boughtStatus, 409); assert.equal(crossSiteCookies, 0); assert.deepEqual(problems, []);
  assert.equal((await pool.query('SELECT count(*)::int n FROM trade_rejections WHERE account_id=$1 AND operation_key=$2', [buyerId,buyKeys[0]])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM purchases WHERE buyer_id=$1', [buyerId])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM delivery_receipts WHERE buyer_id=$1', [buyerId])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM ledger_entries WHERE account_id=ANY($1::uuid[])', [[buyerId,seller.guest_id]])).rows[0].n, 0);
  assert.equal(Number((await pool.query('SELECT balance FROM wallets WHERE account_id=$1', [buyerId])).rows[0].balance), 0);
  const saved = await pool.query('SELECT status,quantity FROM listings WHERE id=$1', [listingId]);
  assert.equal(saved.rows[0].status, 'open'); assert.equal(Number(saved.rows[0].quantity), 1);
  console.log(JSON.stringify({ result: 'passed', frontend: 'pinned CI artifact d3b061c5', backend: expectedBackend,
    database: 'disposable CI PostgreSQL', browser: 'installed Chrome via Playwright',
    origins: 'intercepted exact HTTPS origins', cookie: 'browser-stored backend headers',
    thirdPartyCookies: 'restricted', scenario: 'lost durable rejection then same-key retry', screenshots: 2 }));
} finally {
  if (context) await context.close(); if (browser) await browser.close(); child.kill();
  await new Promise(ok => proxy.close(ok)); await pool.end();
}
