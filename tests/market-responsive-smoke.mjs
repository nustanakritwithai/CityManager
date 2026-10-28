// Browser rendering and interaction test with a local in-memory market fixture.
// Requires the PLAYWRIGHT_MODULE environment variable and an installed Edge.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const html = `<!doctype html><html lang="th" data-touch-ui="true"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/compact-layout.css"><link rel="stylesheet" href="/src/market-panel.css"></head><body><div class="page-buttons"></div><script type="module">
import { installMarketPanel } from '/src/market-panel.ts';
const panel = installMarketPanel(() => ({firms:[]}), () => {}, () => {});
panel.client.guestId = 'fixture';
panel.client.wallet = async () => ({credits:'120'});
panel.client.myListings = async () => [];
panel.client.inventory = async () => ({items:[{item_code:'crop:rice',quantity:2}], imports_enabled:false});
panel.client.receipts = async () => [];
const items = ['crop:rice','crop:vegetables','crop:sugarcane','product:milled-rice','product:canned-food','product:sugar'];
panel.client.read = async path => path.includes('/offers') ? {items:[{listing_id:'fixture-offer',unit_price:5,quantity:8}]} : path.includes('/stats') ? {} : path.includes('/history') ? {items:[]} : {items:items.map(item_id => ({item_id,min_price:5,total_quantity:8,offer_count:1}))};
document.querySelector('.market-launch').click();
</script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(html); }
    if (!path.startsWith('/src/')) { res.statusCode=404; return res.end(); }
    const file = resolve(root, '.' + path);
    if (!file.startsWith(resolve(root, 'src') + '\\')) { res.statusCode=403; return res.end(); }
    const source = await readFile(file, 'utf8');
    if (extname(file)==='.ts') { res.setHeader('Content-Type','text/javascript; charset=utf-8'); return res.end(`import.meta.env={VITE_MARKET_URL:'http://127.0.0.1:4317'};\n` + stripTypeScriptTypes(source, {mode:'transform'})); }
    if (extname(file)==='.css') { if (req.headers['sec-fetch-dest']==='script') { res.setHeader('Content-Type','text/javascript'); return res.end('export default {};'); } res.setHeader('Content-Type','text/css; charset=utf-8'); return res.end(source); }
    res.statusCode=404; res.end();
  } catch (e) { res.statusCode=500; res.end(String(e)); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const port = server.address().port, out=resolve(root,'.test-output','market-responsive');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CITYMANAGER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
  for (const [width,height,screenWidth] of [[360,780,360],[390,844,390],[430,932,430],[955,2048,360],[844,390,390],[1440,900,1440]]) {
    const context=await browser.newContext({viewport:{width,height},hasTouch:screenWidth!==1440});
    await context.addInitScript(({screenWidth, screenHeight})=>{Object.defineProperty(screen,'width',{get:()=>screenWidth}); Object.defineProperty(screen,'height',{get:()=>screenHeight});},{screenWidth,screenHeight:Math.max(width,height)});
    const page=await context.newPage();
    page.on('pageerror', error => console.error('pageerror:', error));
    page.on('console', message => { if (message.type()==='error') console.error('console:', message.text()); });
    await page.goto(`http://127.0.0.1:${port}/`);
    try { await page.waitForSelector('.market-product',{timeout:5000}); } catch (error) { console.error(await page.locator('body').innerText()); throw error; }
    const metrics=await page.evaluate(()=>{
      const dialog=document.querySelector('.market-dialog'), layout=document.querySelector('.market-layout'), products=document.querySelector('.market-products'), categories=document.querySelector('.market-categories'), detail=document.querySelector('.market-detail');
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      const content=document.querySelector('.market-content');
      const row=document.querySelector('.market-product').getBoundingClientRect(), clip=content.getBoundingClientRect();
      return {compact:dialog.dataset.compact, viewport:innerWidth, scrollWidth:document.documentElement.scrollWidth, contentWidth:content.clientWidth, contentScrollWidth:content.scrollWidth, dialog:rect(dialog), layout:rect(layout), products:rect(products), categoryDisplay:getComputedStyle(categories).display, detailDisplay:getComputedStyle(detail).display, columns:getComputedStyle(layout).gridTemplateColumns, productCount:document.querySelectorAll('.market-product').length, firstRowHeight:row.height, firstRowVisible:Math.max(0,Math.min(row.bottom,clip.bottom,innerHeight)-Math.max(row.top,clip.top,0))};
    });
    assert.equal(metrics.scrollWidth,width); assert.equal(metrics.contentScrollWidth,metrics.contentWidth); assert.equal(metrics.productCount,6);
    if (screenWidth!==1440) { assert.equal(metrics.compact,'true'); assert.equal(metrics.categoryDisplay,'none'); assert.equal(metrics.detailDisplay,'none'); assert.ok(metrics.products.width>width*.85); }
    else assert.equal(metrics.compact,'false');
    if (width===844 && height===390) assert.ok(metrics.firstRowVisible>=metrics.firstRowHeight, 'landscape shows the first product row');
    await page.screenshot({path:resolve(out,`${width}x${height}.png`)});
    await page.locator('.market-product').first().click(); await page.waitForSelector('.market-detail.has-selection');
    assert.ok(await page.locator('.market-offer').count());
    await page.screenshot({path:resolve(out,`${width}x${height}-detail.png`)});
    await page.locator('.market-detail button').first().click(); await page.waitForSelector('.market-detail:not(.has-selection)',{state:'attached'});
    await page.locator('.market-tabs button').nth(1).click(); await page.waitForSelector('.market-form');
    const sell=page.locator('.market-form').first(), price=sell.locator('input[type=number]').nth(1);
    await price.fill('1000001'); assert.equal(await sell.locator('button[type=submit]').isEnabled(),false);
    await price.fill('1000000'); assert.equal(await sell.locator('button[type=submit]').isEnabled(),true);
    await page.locator('.market-tabs button').nth(2).click(); await page.waitForSelector('.market-workspace');
    await page.locator('.market-tabs button').nth(3).click(); await page.waitForSelector('.market-workspace');
    await page.locator('.market-tabs button').first().click(); await page.waitForSelector('.market-product');
    const priorView = await page.locator('.market-product-grid').getAttribute('class');
    await page.locator('.market-filters button').click(); await page.waitForSelector(priorView.includes('list') ? '.market-product-grid.grid' : '.market-product-grid.list');
    console.log(JSON.stringify(metrics)); await context.close();
  }
} finally { await browser.close(); server.close(); }
