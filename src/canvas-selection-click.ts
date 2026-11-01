/** A touch selecting a canvas cell can open an overlay before its compatibility
 * click. Fence only that same touch if the click is retargeted off the canvas. */
export class CanvasSelectionClickGuard {
  private pending = new Map<number, number>();

  arm(pointerId: number, timeStamp: number): void {
    for (const [id, started] of this.pending) if (timeStamp - started > 1000) this.pending.delete(id);
    this.pending.set(pointerId, timeStamp);
  }
  clear(pointerId: number): void { this.pending.delete(pointerId); }

  blocks(event: { isTrusted: boolean; pointerId?: number; timeStamp: number }, targetIsCanvas: boolean): boolean {
    const id = event.pointerId;
    if (!event.isTrusted || id === undefined) return false;
    const started = this.pending.get(id);
    if (started === undefined) return false;
    this.pending.delete(id);
    const age = event.timeStamp - started;
    return !targetIsCanvas && age >= 0 && age <= 1000;
  }
}
