// Touch layout (src/hud-row.ts): the page buttons live in the ☰ menu. Before a suite
// clicks one of those, open the menu. Always returns false (the click is still needed).
export async function reachTouch(evaluate, button, selector) {
  const target = JSON.stringify(selector);
  const where = await evaluate(`(()=>{const e=document.querySelector(${target});if(!e||e.getBoundingClientRect().width)return '';const shown=s=>!!document.querySelector(s)?.getBoundingClientRect().width;return e.closest('.page-buttons')&&shown('#hud-more')?'menu':''})()`);
  if (where === 'menu') await button('#hud-more');
  return false;
}
