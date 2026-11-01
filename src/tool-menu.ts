let closeActiveMenu: (() => void) | undefined;

/** Shared dock popup: portal out of the scrolling toolbar, with anchor-sized options. */
/** `row` lays the options out side by side above the dock instead of stacking them up the screen. */
export function installToolMenu(anchor: HTMLButtonElement, menu: HTMLElement, consumeEscape = false, layout: 'column' | 'row' = 'column') {
  menu.classList.add('tool-submenu'); menu.hidden = true; menu.dataset.layout = layout;
  menu.setAttribute('role', 'group');
  anchor.setAttribute('aria-controls', menu.id); anchor.setAttribute('aria-expanded', 'false');
  const allButtons = () => [...menu.querySelectorAll<HTMLButtonElement>('button')];
  const buttons = () => allButtons().filter(button => !button.hidden && !button.disabled);
  const close = (focus = false) => {
    menu.hidden = true; anchor.setAttribute('aria-expanded', 'false'); delete document.body.dataset.toolMenuOpen;
    if (closeActiveMenu === close) closeActiveMenu = undefined;
    if (focus) anchor.focus({ preventScroll: true });
  };
  const position = () => {
    if (menu.hidden) return;
    const r = anchor.getBoundingClientRect(), viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight);
    const dock = anchor.closest('.tool-buttons')?.getBoundingClientRect();
    const available = r.top - top - 14;
    // Dismiss instead of leaving a popup attached to an offscreen/scrolled-away control.
    if (!r.width || !r.height || available < r.height || r.top >= bottom ||
        r.right <= Math.max(left, dock?.left ?? left) || r.left >= Math.min(right, dock?.right ?? right)) { close(); return; }
    menu.style.bottom = `${innerHeight - r.top + 6}px`;
    if (layout === 'row') {
      // Centre the row on its anchor; a row wider than the screen scrolls sideways.
      // Slightly wider than the dock buttons so long names (มหาวิทยาลัย) stay whole.
      const cell = r.width * 1.2, count = buttons().length, width = Math.min(count * cell + Math.max(0, count - 1) * 4, right - left - 16);
      menu.style.left = `${Math.max(left + 8, Math.min(r.left + r.width / 2 - width / 2, right - width - 8))}px`;
      menu.style.width = `${width}px`; menu.style.maxHeight = '';
    } else {
      menu.style.left = `${Math.max(left + 8, Math.min(r.left, right - r.width - 8))}px`;
      menu.style.width = `${r.width}px`; menu.style.maxHeight = `${available}px`;
    }
    for (const button of allButtons()) {
      button.style.width = `${layout === 'row' ? r.width * 1.2 : r.width}px`; button.style.height = button.style.minHeight = `${r.height}px`;
      button.style.minWidth = '0';
    }
  };
  document.body.append(menu);
  const outside = (event: Event) => {
    // Let the shared Cancel handler see the still-open popup before deciding whether to cancel a tool.
    if ((event.target as Element | null)?.closest?.('#cancel-tool')) return;
    if (!menu.hidden && !menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    close(true);
    // Select's popup is read-only: Esc dismisses it, not an unrelated inspector behind it.
    if (consumeEscape) { event.preventDefault(); event.stopImmediatePropagation(); }
  });
  menu.addEventListener('keydown', event => {
    const back = layout === 'row' ? ['ArrowUp', 'ArrowLeft'] : ['ArrowUp'], forward = layout === 'row' ? ['ArrowDown', 'ArrowRight'] : ['ArrowDown'];
    if (![...back, ...forward, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const options = buttons(), current = options.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
      (current + (back.includes(event.key) ? -1 : 1) + options.length) % options.length;
    options[index]?.focus({ preventScroll: true }); options[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
  window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
  return { close, isOpen: () => !menu.hidden, open: (focus = false) => {
    if (closeActiveMenu !== close) closeActiveMenu?.();
    closeActiveMenu = close;
    menu.hidden = false; anchor.setAttribute('aria-expanded', 'true'); document.body.dataset.toolMenuOpen = 'true'; position();
    if (focus && !menu.hidden) { buttons()[0]?.focus({ preventScroll: true }); buttons()[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  } };
}
