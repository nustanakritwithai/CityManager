/** Independent UI gesture: never forwards a badge tap to building/citizen picking or a build tool. */
export const ISSUE_TAP_SLOP = 7;
export type IssuePointer = { pointerId: number; clientX: number; clientY: number; button: number };
export function issueGesture(pan: (x: number, y: number) => void, activate: () => void, allowed: () => boolean) {
  let down: { id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null;
  return {
    start(e: IssuePointer) {
      if (down || !allowed() || e.button !== 0) { down = null; return false; }
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false }; return true;
    },
    move(e: IssuePointer) {
      if (!down || down.id !== e.pointerId) return;
      if (!allowed()) { down = null; return; }
      const wasMoved = down.moved;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > ISSUE_TAP_SLOP) down.moved = true;
      if (down.moved) pan(e.clientX - (wasMoved ? down.lastX : down.x), e.clientY - (wasMoved ? down.lastY : down.y));
      down.lastX = e.clientX; down.lastY = e.clientY;
    },
    end(e: IssuePointer) {
      if (!down || down.id !== e.pointerId) return;
      const tap = !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= ISSUE_TAP_SLOP;
      down = null; if (tap && allowed()) activate();
    },
    cancel() { down = null; },
  };
}
export function bindIssueInput(button: HTMLButtonElement, pan: (x: number, y: number) => void, activate: () => void, allowed: () => boolean): () => void {
  const gesture = issueGesture(pan, activate, allowed);
  let active: number | null = null;
  const cancel = () => { gesture.cancel(); active = null; };
  const otherPointer = (e: PointerEvent) => { if (active !== null && e.pointerId !== active) cancel(); };
  window.addEventListener('pointerdown', otherPointer, true);
  button.addEventListener('pointerdown', e => {
    if (!gesture.start(e)) return;
    active = e.pointerId; button.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
  });
  button.addEventListener('pointermove', e => { gesture.move(e); if (active !== null) e.stopPropagation(); });
  button.addEventListener('pointerup', e => { gesture.end(e); active = null; e.stopPropagation(); });
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('lostpointercapture', cancel);
  // Native keyboard/assistive activation is retained; pointer activation was resolved above.
  button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (e.detail === 0 && allowed()) activate(); });
  return () => { cancel(); window.removeEventListener('pointerdown', otherPointer, true); };
}
