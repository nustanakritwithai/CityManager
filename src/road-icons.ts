/** Unmodified MIT Tabler SVGs vendored with a pinned closed hash roster. */
export function paintRoadIcon(element: HTMLElement, name: 'road' | 'arrows-up' | 'unlink') {
  element.textContent='';element.classList.add('road-asset-icon');element.setAttribute('aria-hidden','true');
  element.style.maskImage=`url("${(import.meta as ImportMeta & {env:{BASE_URL:string}}).env.BASE_URL}assets/tabler-roads/${name}.svg")`;
}
