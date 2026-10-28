// Touch layout (src/hud-row.ts): the page buttons live in the ☰ menu and the speeds behind
// one cycle button. Before a suite clicks one of those, open the menu or step the speed.
// Returns true when the target speed is already selected (nothing left to click).
export async function reachTouch(evaluate, button, selector) {
  const target = JSON.stringify(selector);
  const where = await evaluate(`(()=>{const e=document.querySelector(${target});if(!e||e.getBoundingClientRect().width)return '';const shown=s=>!!document.querySelector(s)?.getBoundingClientRect().width;return e.closest('.page-buttons')&&shown('#hud-more')?'menu':e.matches('[data-speed]')&&shown('#speed-cycle')?'speed':''})()`);
  if (where === 'menu') await button('#hud-more');
  if (where !== 'speed') return false;
  for (let i = 0; i < 3 && await evaluate(`document.querySelector(${target}).getAttribute('aria-pressed')!=='true'`); i++) await button('#speed-cycle');
  return true;
}
