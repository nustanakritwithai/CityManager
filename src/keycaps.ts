/** Small keyboard-shortcut caps on HUD controls for mouse-and-keyboard players; hidden on touch. */
import './keycaps.css';

const KEYS: readonly [selector: string, key: string][] = [
  ['[data-tool="select"]', 'V'], ['[data-tool="road"]', 'R'], ['[data-tool="R"]', '1'], ['[data-tool="C"]', '2'], ['[data-tool="I"]', '3'],
  ['[data-tool="F"]', '4'], ['[data-tool="power"]', '5'], ['[data-tool="water"]', '6'], ['[data-tool="bulldoze"]', 'B'], ['[data-tool="pan"]', 'P'], ['#toggle-stats', 'T'], ['#toggle-network', 'N'],
];

/** The cap is a ::before on the control itself, so the control's own children (and the selectors on them) stay as they were. */
export function installKeycaps() {
  for (const [selector, key] of KEYS) {
    const target = document.querySelector<HTMLElement>(selector);
    if (target) { target.dataset.key = key; target.classList.add('has-keycap'); }
  }
}
