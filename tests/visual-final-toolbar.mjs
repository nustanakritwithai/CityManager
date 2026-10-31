// Actual production DOM only: select/dismiss controls, never place, load, serialize or save a city.
import assert from 'node:assert/strict';

export function assertKeycapContract({facts,caps}) {
  const eligible=facts.minWidth&&facts.hover&&facts.finePointer&&!facts.touchUi;
  assert.equal(facts.touchUi,facts.anyCoarse||facts.maxTouchPoints>0,'Touch layout matches actual input capabilities');
  assert.equal(caps.length,4);assert.deepEqual(caps.map(c=>c.key),['1','2','3','4']);
  for(const c of caps) {
    if(eligible)assert.ok(c.content.includes(c.key),`Eligible shortcut badge rendered: ${JSON.stringify({facts,c})}`);
    else assert.ok(c.content==='none'||c.content==='normal'||c.content==='""',`Ineligible shortcut badge hidden: ${JSON.stringify({facts,c})}`);
  }
  return {eligible,facts,caps};
}

export async function toolbarChecks({ send, evaluate, capture }) {
  const checks = [], layouts = [];
  const paints = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  let touch = false;
  const tap = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`);
    await paints();
    const p = await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.hidden||b.disabled)return null;const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    assert.ok(p?.hit, `Reachable real control: ${selector} ${JSON.stringify(p)}`);
    if(touch) {
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:1}]});
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
    }
    await paints();
  };
  const key = async value => {
    const code = /^\d$/.test(value)?`Digit${value}`:value.length===1?`Key${value.toUpperCase()}`:value;
    const params = {key:value,code,windowsVirtualKeyCode:value==='Escape'?27:value.toUpperCase().charCodeAt(0)};
    await send('Input.dispatchKeyEvent',{...params,type:value.length===1?'keyDown':'rawKeyDown',...(value.length===1?{text:value,unmodifiedText:value}:{})});
    await send('Input.dispatchKeyEvent',{...params,type:'keyUp'});await paints();
  };
  const selected = tool => evaluate(`document.querySelector('[data-tool="${tool}"]')?.getAttribute('aria-pressed')==='true'`);
  const open = id => evaluate(`!document.querySelector('#${id}-submenu').hidden`);
  const viewport = async (width,height,mobile,screenWidth=width) => {
    await key('Escape');await key('v');
    touch=mobile;
    // Set input capability before resize, so app resize observers read the new touch state.
    await send('Emulation.setTouchEmulationEnabled',mobile?{enabled:true,maxTouchPoints:2}:{enabled:false});
    await send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth,screenHeight:height,deviceScaleFactor:1,mobile});
    await paints();
  };
  // The fresh profile may show onboarding; dismiss only UI, not city/save state.
  if(await evaluate('!!document.querySelector(".guest-entry-card")')) await tap('.guest-entry-card button:nth-of-type(2)');
  if(await evaluate('document.querySelector(".guide-skip")?.getClientRects().length>0')) await tap('.guide-skip');
  await key('Escape');await key('v');
  assert.equal(await evaluate('document.querySelectorAll(".tool-dock").length'),1);
  assert.equal(await evaluate('document.querySelectorAll(".tool-dock.build-toolbar, .build-price").length'),0);
  const details = await evaluate(`[...document.querySelectorAll('.tool[data-build-tool]')].map(b=>({tool:b.dataset.tool,title:b.title,label:b.getAttribute('aria-label'),key:b.getAttribute('aria-keyshortcuts'),glyph:!!b.querySelector('svg[aria-hidden="true"]'),mask:b.dataset.tool==='road'?getComputedStyle(b.querySelector('.tool-icon')).maskImage:null}))`);
  const expectedKeys={select:'V',road:'R',R:'1',C:'2',I:'3',F:'4',power:'5',water:'6',park:'7',bulldoze:'B'};
  for(const [tool,k] of Object.entries(expectedKeys)) {
    const row=details.find(r=>r.tool===tool);assert.ok(row,tool);assert.equal(row.key,k);
    assert.ok(row.label&&row.title&&(row.title.includes('เครดิต')||row.title.includes('ฟรี')||row.title.includes('ไม่เสียค่าใช้จ่าย')),`Accessible label and cost: ${tool}`);
    if(['select','R','C','I','F','park','bulldoze'].includes(tool))assert.ok(row.glyph,`Original HUD artwork: ${tool}`);
  }
  assert.ok(details.find(r=>r.tool==='road').mask.includes('tabler-roads/road.svg'),'Original road asset mask restored');
  assert.ok(details.filter(r=>['R','C','I','F'].includes(r.tool)).every(r=>r.title.includes('วางโซนฟรี')));
  checks.push('One classic dock; original HUD icons and road asset; no modern price rows; accessible costs and true V/R/1–7/B shortcuts');

  const inspectLayout = async (name,id) => {
    const result=await evaluate(`(()=>{const m=document.querySelector('#${id}-submenu'),a=document.querySelector('[aria-controls="${id}-submenu"]'),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}};return{name:${JSON.stringify(name)},id:${JSON.stringify(id)},ratio:Math.min(1,screen.width/innerWidth),width:innerWidth,height:innerHeight,anchor:rect(a),menu:rect(m),overflow:getComputedStyle(m).overflowY,client:m.clientHeight,scroll:m.scrollHeight,buttons:[...m.querySelectorAll('button')].filter(b=>!b.hidden).map(b=>({tool:b.dataset.tool||b.dataset.roadMode,...rect(b),pressed:b.getAttribute('aria-pressed'),label:b.getAttribute('aria-label')||b.title,price:b.querySelector('.build-price')?getComputedStyle(b.querySelector('.build-price')).display:null})),pageOverflow:document.documentElement.scrollWidth-innerWidth}})()`);
    layouts.push(result);assert.ok(result.menu.x>=-1&&result.menu.right<=result.width+1&&result.menu.y>=-1&&result.menu.bottom<=result.anchor.y+1,`Bounded popup ${name}/${id}: ${JSON.stringify(result)}`);
    assert.ok(result.pageOverflow<=1,`No horizontal page overflow ${name}`);
    for(const b of result.buttons){assert.ok(b.w*result.ratio>=43.5&&b.h*result.ratio>=43.5,`44 physical px ${name}: ${JSON.stringify(b)}`);assert.ok(b.label);assert.notEqual(b.price,'none');}
    if(result.scroll>result.client+1)assert.equal(result.overflow,'auto');
    return result;
  };
  for(const [name,w,h,screen] of [['mobile',390,844,390],['small-mobile',320,568,320],['landscape',844,390,844],['wide-layout-mobile',980,780,390]]) {
    await viewport(w,h,true,screen);
    await tap('#construction-tool');assert.equal(await open('construction'),true);
    await inspectLayout(name,'construction');await capture(`toolbar-${name}-construction`);
    await tap('[data-tool="R"]');assert.equal(await selected('R'),true);assert.equal(await open('construction'),false);
    await tap('#services-tool');assert.equal(await open('services'),true);
    await inspectLayout(name,'services');await capture(`toolbar-${name}-services`);
    await tap('[data-tool="park"]');assert.equal(await selected('park'),true);
    await tap('[data-tool="road"]');assert.equal(await open('road'),true);assert.equal(await selected('road'),true);
    await tap('#cancel-tool');assert.equal(await open('road'),false);
    await tap('[data-tool="select"]');assert.equal(await open('select'),true);
    await inspectLayout(name,'select');await tap('[data-tool="bulldoze"]');assert.equal(await selected('bulldoze'),true);
    await tap('#cancel-tool');assert.equal(await selected('select'),true);assert.equal(await selected('bulldoze'),false);
    await tap('#construction-tool');await tap('#cancel-tool');assert.equal(await open('construction'),false);assert.equal(await selected('select'),true);
    await capture(`toolbar-${name}-dock`);
  }
  checks.push('Four mobile layouts: native touch opens existing groups, selects R/park/road/demolition, cancels safely; popup bounds, >=44px physical targets and accessible labels verified');
  await viewport(1440,1000,false);
  for(const [keyName,tool] of Object.entries({'1':'R','2':'C','3':'I','4':'F','5':'power','6':'water','7':'park',b:'bulldoze',r:'road',v:'select'})) {await key(keyName);assert.equal(await selected(tool),true);}
  await tap('#construction-tool');
  const keycaps=assertKeycapContract(await evaluate(`({facts:{minWidth:matchMedia('(min-width:861px)').matches,hover:matchMedia('(hover:hover)').matches,finePointer:matchMedia('(pointer:fine)').matches,anyCoarse:matchMedia('(any-pointer:coarse)').matches,maxTouchPoints:navigator.maxTouchPoints,touchUi:document.documentElement.dataset.touchUi==='true'},caps:[...document.querySelectorAll('#construction-submenu [data-key]')].map(b=>({key:b.dataset.key,content:getComputedStyle(b,'::before').content}))})`));
  console.log('Actual keycap media contract',JSON.stringify(keycaps));
  await key('Escape');await key('v');
  // Native focus + reduced-motion checks affect only presentation.
  await evaluate(`document.querySelector('[data-tool="select"]').focus()`);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await paints();
  const motion=await evaluate(`(()=>{const b=document.querySelector('[data-tool="select"]'),s=getComputedStyle(b);return{matches:matchMedia('(prefers-reduced-motion:reduce)').matches,transition:s.transitionDuration,focused:document.activeElement===b}})()`);
  assert.equal(motion.matches,true);assert.ok(motion.transition.split(',').every(v=>parseFloat(v)===0));assert.equal(motion.focused,true);
  await capture('toolbar-desktop-reduced-motion');
  await send('Emulation.setEmulatedMedia',{features:[]});
  checks.push('Existing keyboard bindings and capability-conditional badge contract verified; reduced-motion transition disabled and keyboard focus reachable');
  return {checks,layouts,details,motion,keycaps};
}
