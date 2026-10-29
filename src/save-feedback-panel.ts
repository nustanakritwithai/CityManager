import { createSaveFeedback } from './save-feedback.ts';

export function installSaveFeedback(badge: HTMLElement, exportSave: () => void) {
  const banner = document.createElement('aside'); banner.id = 'save-failure-banner'; banner.hidden = true;
  banner.setAttribute('aria-label', 'สถานะการบันทึก');
  const message = document.createElement('div'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.setAttribute('aria-atomic', 'true');
  const title = document.createElement('strong'), detail = document.createElement('span'), last = document.createElement('small');
  title.textContent = 'ยังบันทึกไม่ได้'; message.append(title, detail, last);
  const backup = document.createElement('button'); backup.id = 'save-failure-export'; backup.type = 'button'; backup.textContent = 'ส่งออกไฟล์'; backup.onclick = exportSave;
  banner.append(message, backup); document.body.append(banner);
  const measure = () => document.documentElement.style.setProperty('--save-warning-height', banner.hidden ? '0px' : `${banner.offsetHeight + 8}px`);
  new ResizeObserver(measure).observe(banner);
  return createSaveFeedback(state => {
    const saved = state.lastSuccess === null ? 'ยังไม่มีการบันทึกสำเร็จในรอบนี้' : `บันทึกสำเร็จล่าสุด ${new Date(state.lastSuccess).toLocaleTimeString()}`;
    badge.textContent = state.failure ? `บันทึกไม่สำเร็จ · ${saved}` : state.pending ? `กำลังบันทึก… · ${saved}` : saved;
    badge.dataset.failed = String(!!state.failure);
    banner.hidden = !state.failure;
    if (state.failure) {
      const text = state.pending ? `${state.failure} · กำลังลองบันทึกใหม่…` : state.failure;
      if (detail.textContent !== text) detail.textContent = text;
      if (last.textContent !== saved) last.textContent = saved;
    }
    measure();
  });
}
