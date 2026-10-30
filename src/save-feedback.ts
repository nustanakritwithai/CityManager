/** UI-only write observations. An older completion cannot hide a newer failure. */
export type SaveFeedbackState = { pending: number; lastSuccess: number | null; failure: string | null };
export function createSaveFeedback(onChange: (state: SaveFeedbackState) => void, now = Date.now) {
  let sequence = 0, successAttempt = 0, failureAttempt = -1;
  const pending = new Set<number>();
  let lastSuccess: number | null = null, failure: string | null = null;
  const emit = () => onChange({ pending: pending.size, lastSuccess, failure });
  return {
    // Recovery authorizes the loaded city, but is not a successful storage write.
    recovered() { failure = null; failureAttempt = ++sequence; emit(); },
    begin() { const attempt = ++sequence; pending.add(attempt); emit(); return attempt; },
    succeeded(attempt: number) {
      pending.delete(attempt);
      if (attempt >= successAttempt) { successAttempt = attempt; lastSuccess = now(); }
      if (attempt > failureAttempt) failure = null;
      emit();
    },
    failed(message: string, attempt = ++sequence) {
      pending.delete(attempt);
      if (attempt >= successAttempt && attempt >= failureAttempt) { failureAttempt = attempt; failure = message; }
      emit();
    },
  };
}
