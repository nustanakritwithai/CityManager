import { onExplicitActivation } from './explicit-activation.ts';
import type { UpgradeQuote } from './selection-upgrade.ts';
import './selection-actions.css';

/** One DOM button per action: no pointerdown mutation or click-through to the map. */
export function installSelectionActions(options: {
  getQuote: () => UpgradeQuote | null;
  upgrade: (quote: UpgradeQuote) => void;
  information: () => void;
  dismiss: () => void;
}) {
  const host = document.createElement('section'); host.id = 'selection-actions'; host.hidden = true;
  host.setAttribute('aria-label', 'จัดการสิ่งปลูกสร้างที่เลือก');
  const label = document.createElement('span'); label.className = 'selection-action-label';
  const upgrade = document.createElement('button'); upgrade.type = 'button'; upgrade.id = 'selection-upgrade';
  const info = document.createElement('button'); info.type = 'button'; info.textContent = 'ⓘ ข้อมูล';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'ยกเลิกการเลือก');
  let quote: UpgradeQuote | null = null, lockedUntil = 0;
  upgrade.addEventListener('keydown', event => { if (event.repeat) event.preventDefault(); });
  onExplicitActivation(upgrade, () => {
    if (upgrade.disabled || performance.now() < lockedUntil || !quote) return;
    const current = options.getQuote();
    if (!current || current.key !== quote.key || current.level !== quote.level || current.reason) return;
    lockedUntil = Infinity; upgrade.disabled = true;
    try { options.upgrade(current); }
    finally { lockedUntil = performance.now() + 650; }
  });
  onExplicitActivation(info, options.information); onExplicitActivation(close, options.dismiss);
  host.append(label, upgrade, info, close); document.body.append(host);
  return {
    update(visible: boolean) {
      quote = visible ? options.getQuote() : null; host.hidden = !quote;
      if (!quote) return;
      label.textContent = `${quote.name} · ระดับ ${quote.level}`;
      upgrade.textContent = (quote.maximum || quote.reason === 'ถึงระดับสูงสุดแล้ว') ? '↑ สูงสุดแล้ว' : `↑ อัปเกรด · ${quote.cost ? `฿${(quote.cost / 100).toLocaleString('th-TH')}` : 'ฟรี'}`;
      upgrade.disabled = !!quote.reason || performance.now() < lockedUntil;
      upgrade.title = quote.reason; host.setAttribute('aria-description', quote.reason);
      label.textContent += quote.reason ? ` · ${quote.reason}` : '';
    },
    position(x: number, y: number) {
      if (host.hidden) return;
      const width = host.offsetWidth;
      host.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, x - width / 2))}px`;
      host.style.top = `${Math.max(100, Math.min(window.innerHeight - host.offsetHeight - 150, y - host.offsetHeight - 24))}px`;
    },
  };
}
