const definitions = [
  ['ledger', 'money-section', 'รายการเงินล่าสุด', 'บัญชีทั้งเมือง'],
  ['goods-ledger', 'goods-section', 'การเคลื่อนย้ายสินค้าสำเร็จรูป', 'สินค้าสำเร็จรูปทั้งเมือง'],
  ['crop-ledger', 'crop-section', 'บัญชีพืชผล', 'ล็อตพืชผลทั้งเมือง'],
  ['accounts', 'accounts-section', 'ยอดกระเป๋าเงิน', 'ทุกบัญชีในแบบจำลอง'],
  ['guide', 'guide', 'วิธีเล่น', 'คู่มือการควบคุม'],
  ['simulation-rules', 'simulation-rules', 'สมมติฐานต้นแบบ', 'กติกาและขอบเขต']
] as const;
let active: HTMLDetailsElement | null = null;
let sections: HTMLDetailsElement[] = [];
let ready = false;

function show(section: HTMLDetailsElement | null) {
  active = section;
  const inspector = document.querySelector<HTMLElement>('#inspector')!;
  inspector.dataset.submenu = section?.id ?? '';
  for (const other of sections) {
    other.dataset.active = String(other === section);
    if (section && other !== section) other.open = false;
  }
  const definition = definitions.find(d => d[1] === section?.id);
  document.querySelector('#submenu-title')!.textContent = definition?.[2] ?? '';
  document.querySelector('#submenu-scope')!.textContent = definition?.[3] ?? '';
  document.querySelector('#inspector-body')!.scrollTop = 0;
}

/** Navigation changes only DOM disclosure state; the city and its clock are untouched. */
export function closeSubmenus() {
  if (!ready) return;
  const previous = active;
  show(null);
  for (const section of sections) section.open = false;
  previous?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
}
export function hasOpenSubmenu() { return active !== null; }

export function setupSubmenuNavigation(backAction: () => void = () => {}) {
  if (ready) return; ready = true;
  const inspector = document.querySelector<HTMLElement>('#inspector')!;
  const heading = inspector.querySelector<HTMLElement>('.place-heading')!;
  const back = document.createElement('button'); back.id = 'submenu-back'; back.type = 'button';
  back.textContent = '←'; back.setAttribute('aria-label', 'กลับข้อมูลสถานที่');
  back.title = 'กลับข้อมูลสถานที่ (Esc)'; back.addEventListener('click', () => active ? closeSubmenus() : backAction());
  inspector.querySelector('.inspector-heading')!.prepend(back);
  const scope = document.createElement('span'); scope.id = 'submenu-scope'; scope.className = 'eyebrow';
  const title = document.createElement('h2'); title.id = 'submenu-title';
  heading.append(scope, title);
  sections = definitions.map(([root, id, label, scopeLabel], index) => {
    const element = document.getElementById(root)!;
    const section = element instanceof HTMLDetailsElement ? element : element.closest('details')!;
    section.id = id; section.classList.add('submenu-section');
    const summary = section.querySelector('summary')!;
    summary.classList.add('submenu-entry');
    const symbol = document.createElement('span'); symbol.className = 'submenu-entry-icon'; symbol.textContent = ['฿', '▦', 'F', '▤', '1–5', 'i'][index]; symbol.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div'), title = document.createElement('strong'), hint = document.createElement('small');
    title.className = 'submenu-entry-label'; title.textContent = label; hint.textContent = scopeLabel; copy.append(title, hint); summary.replaceChildren(symbol, copy);
    section.addEventListener('toggle', () => {
      if (section.open) { if (active !== section) show(section); }
      else if (active === section) show(null);
    });
    return section;
  });
  const coarse = matchMedia('(any-pointer: coarse)');
  const layout = () => {
    const touch = coarse.matches || navigator.maxTouchPoints > 0;
    const screenWidth = screen.width > 0 ? Math.min(screen.width, innerWidth) : innerWidth;
    const scale = touch && innerWidth > 700 ? Math.min(2.75, Math.max(1, innerWidth / Math.max(320, screenWidth))) : 1;
    document.documentElement.dataset.touchUi = String(touch);
    document.documentElement.style.setProperty('--reader-unit', `${scale}px`);
  };
  coarse.addEventListener('change', layout); window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout); layout(); show(null);
}
