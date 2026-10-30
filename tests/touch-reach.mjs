// Touch layout (src/hud-row.ts): the page buttons live in the ☰ menu and the speeds behind
// one cycle button. Dock submenus are body-portaled on every viewport.
// Before a suite clicks a hidden control, reveal it using the actual user-facing buttons.
// Returns true when the target speed is already selected (nothing left to click).
export async function reachTouch(evaluate, button, selector) {
  const target = JSON.stringify(selector);
  if (await evaluate(`!!document.querySelector(${target})?.closest('#select-submenu[hidden]')`)) {
    if (await evaluate(`!document.querySelector('[data-tool="select"]').getBoundingClientRect().width && document.querySelector('#inspector').dataset.open==='true'`)) await button('#close-inspector');
    await button('[data-tool="select"]');
  }
  const group = await evaluate(`document.querySelector(${target})?.closest('.grouped-tool-submenu[hidden]')?.id ?? ''`);
  if (group) {
    const anchor = `#${group.replace('-submenu', '-tool')}`;
    if (await evaluate(`!document.querySelector(${JSON.stringify(anchor)}).getBoundingClientRect().width && document.querySelector('#inspector').dataset.open==='true'`)) await button('#close-inspector');
    await button(anchor);
  }
  const where = await evaluate(`(()=>{const e=document.querySelector(${target});if(!e||e.getBoundingClientRect().width)return '';const shown=s=>!!document.querySelector(s)?.getBoundingClientRect().width;return e.closest('.page-buttons')&&shown('#hud-more')?'menu':e.matches('[data-speed]')&&shown('#speed-cycle')?'speed':''})()`);
  if (where === 'menu') await button('#hud-more');
  if (where !== 'speed') return false;
  for (let i = 0; i < 3 && await evaluate(`document.querySelector(${target}).getAttribute('aria-pressed')!=='true'`); i++) await button('#speed-cycle');
  return true;
}
