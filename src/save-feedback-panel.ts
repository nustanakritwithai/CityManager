import { createSaveFeedback } from './save-feedback.ts';

export function installSaveFeedback(badge: HTMLElement, exportSave: () => void, successLabel:()=>string|undefined=()=>undefined) {
  const banner = document.createElement('aside'); banner.id = 'save-failure-banner'; banner.hidden = true;
  banner.setAttribute('aria-label', 'สถานะการบันทึก');
  const message = document.createElement('div'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.setAttribute('aria-atomic', 'true');
  const title = document.createElement('strong'), detail = document.createElement('span'), last = document.createElement('small');
  title.textContent = 'ยังบันทึกไม่ได้'; message.append(title, detail, last);
  const backup = document.createElement('button'); backup.id = 'save-failure-export'; backup.type = 'button'; backup.textContent = 'ส่งออกไฟล์'; backup.onclick = exportSave;
  banner.append(message, backup); document.body.append(banner);
  const measure = () => document.documentElement.style.setProperty('--save-warning-height', banner.hidden ? '0px' : `${banner.offsetHeight + 8}px`);
  const inspector = document.getElementById('inspector')!, body = document.getElementById('inspector-body')!;
  const narrow = matchMedia('(max-width:700px)');
  // A full-height reading panel owns its warning row. Moving the existing node
  // keeps the same failure, live status and Export action across every route.
  const place = () => {
    const inline = inspector.dataset.open === 'true' && (document.documentElement.dataset.touchUi === 'true' || narrow.matches);
    const parent = inline ? inspector : document.body;
    if (banner.parentElement !== parent) {
      const focused = banner.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      if (inline) inspector.insertBefore(banner, body); else document.body.append(banner);
      focused?.focus({ preventScroll:true });
    }
    measure();
  };
  new MutationObserver(place).observe(inspector, { attributes:true, attributeFilter:['data-open'] });
  new MutationObserver(place).observe(document.documentElement, { attributes:true, attributeFilter:['data-touch-ui'] });
  narrow.addEventListener('change', place);
  new ResizeObserver(measure).observe(banner);
  place();
  return createSaveFeedback(state => {
    const saved = state.lastSuccess === null ? 'ยังไม่มีการบันทึกสำเร็จในรอบนี้' : `${successLabel()??'บันทึกสำเร็จล่าสุด'} ${new Date(state.lastSuccess).toLocaleTimeString()}`;
    badge.textContent = state.failure ? `บันทึกไม่สำเร็จ · ${saved}` : state.pending ? `กำลังบันทึก… · ${saved}` : saved;
    badge.dataset.failed = String(!!state.failure);
    banner.hidden = !state.failure;
    if (state.failure) {
      const text = state.pending ? `${state.failure} · กำลังลองบันทึกใหม่…` : state.failure;
      if (detail.textContent !== text) detail.textContent = text;
      if (last.textContent !== saved) last.textContent = saved;
    }
    place();
  });
}
