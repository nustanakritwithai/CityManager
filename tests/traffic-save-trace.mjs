// Synthetic loopback fixture diagnostics. Native mode delegates every timer;
// controlled dense-sample mode captures only the single60s autosave callback.
// Neither mode replaces save behavior, lifecycle handlers or unrelated timers.
export function installTrafficSaveTrace(controlAutosave = false) {
  const events = window.__trafficSaveTrace = [];
  const stamp = () => ({ at: Date.now(), pageAgeMs: performance.now(), visibility: document.visibilityState });
  const record = event => events.push({ ...stamp(), ...event });
  const interval = window.setInterval;
  const controlled = window.__trafficAutosaveSchedule = { mode: controlAutosave ? 'controlled-single-60000ms-after-fallback-sample' : 'native', registrations: 0, invocations: 0 };
  let captured;
  window.__trafficInvokeAutosave = () => {
    if (!controlAutosave || controlled.registrations !== 1 || controlled.invocations !== 0) throw Error('Expected exactly one pending controlled autosave');
    controlled.invocations++; record({ type: 'controlled-autosave-invoked' }); captured();
  };
  window.setInterval = function(callback, delay, ...args) {
    if (delay !== 60000 || typeof callback !== 'function') return interval.call(this, callback, delay, ...args);
    record({ type: 'autosave-interval-registered', stack: new Error().stack });
    controlled.registrations++;
    if (controlAutosave) {
      if (controlled.registrations !== 1) throw Error('Ambiguous 60000ms interval registrations');
      captured = () => callback.apply(window, args);
      // This fixture owns only the known single periodic autosave schedule.
      // No lifecycle listener, storage operation or unrelated timer is suppressed.
      return -60000;
    }
    return interval.call(this, function(...values) { record({ type: 'autosave-interval-fired' }); return callback.apply(this, values); }, delay, ...args);
  };
  for (const [target, type] of [[document, 'visibilitychange'], [window, 'pagehide'], [window, 'beforeunload']]) {
    target.addEventListener(type, () => record({ type }));
  }
  for (const method of ['setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function(key, ...args) {
      if (this !== localStorage || (method !== 'clear' && !/^citymanager\.(save|backup|checkpoint|market)/.test(key))) return original.call(this, key, ...args);
      const event = { ...stamp(), type: 'protected-write', method, key, stack: new Error().stack,
        before: localStorage.getItem('citymanager.save.v7') };
      try { const result = original.call(this, key, ...args); event.ok = true; return result; }
      catch (error) { event.ok = false; event.error = String(error); throw error; }
      finally { event.after = localStorage.getItem('citymanager.save.v7'); events.push(event); }
    };
  }
  window.__trafficSaveMark = type => record({ type });
}
