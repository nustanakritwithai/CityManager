/** A second view of the existing clock controls; all actions use the original handler. */
export function installPanelTimeControls(header: HTMLElement, pause: HTMLButtonElement) {
  const row = document.createElement('div'); row.className = 'panel-time-controls';
  const state = document.createElement('span'); state.id = 'panel-time-state';
  const button = document.createElement('button'); button.id = 'panel-pause'; button.type = 'button';
  button.setAttribute('aria-describedby', state.id); button.addEventListener('click', () => pause.click());
  row.append(state, button); header.append(row);
  return { update(paused: boolean, speed: number, disabled: boolean) {
    const rate = speed === 1 / 1440 ? '1 นาทีเกม/วินาที' : `${speed}×`;
    state.textContent = `${paused ? 'หยุดเวลาอยู่' : 'กำลังเดินเวลา'} · ${rate}`;
    button.textContent = paused ? '▶ เล่นต่อ' : 'Ⅱ หยุดเวลา';
    button.setAttribute('aria-pressed', String(paused)); button.disabled = disabled;
  } };
}
