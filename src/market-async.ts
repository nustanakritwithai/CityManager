/**
 * Coordinates independent market reads and serializes user-initiated writes.
 * A caller must reconcile an uncertain write before allowing another mutation.
 */
export class MarketAsync {
  private generation = 0;
  private busy = false;
  private uncertain = false;

  /** Invalidate all pending reads, including when the market closes. */
  invalidate() { this.generation++; }

  /** Only the most recently started read can publish a value or an error. */
  async read<T>(load: () => Promise<T>, publish: (value: T) => void, fail: (error: unknown) => void) {
    const generation = ++this.generation;
    try {
      const value = await load();
      if (generation === this.generation) publish(value);
    } catch (error) {
      if (generation === this.generation) fail(error);
    }
  }

  get canMutate() { return !this.busy && !this.uncertain; }
  get isBusy() { return this.busy; }
  get needsReconciliation() { return this.uncertain; }

  /**
   * Never automatically retry an operation. The caller classifies an error as
   * uncertain when the server might have accepted the request.
   */
  async mutate<T>(action: () => Promise<T>, isUncertain: (error: unknown) => boolean): Promise<T> {
    if (!this.canMutate) throw new Error('market-mutation-blocked');
    this.busy = true;
    this.invalidate();
    try {
      return await action();
    } catch (error) {
      if (isUncertain(error)) this.uncertain = true;
      throw error;
    } finally {
      this.busy = false;
      this.invalidate();
    }
  }

  /** Call only after the client has actually reconciled the pending journal. */
  reconciled() { this.uncertain = false; }
}
