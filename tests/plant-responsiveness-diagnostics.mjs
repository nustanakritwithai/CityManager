// Observation only: never retries, pauses rendering, changes acceptance, or stores CDP values.
import { performance } from 'node:perf_hooks';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';

export function ringPush(rows, row, limit = 64) {
  rows.push(row);
  if (rows.length > limit) rows.splice(0, rows.length - limit);
}
function hostCpuTotals() {
  return cpus().reduce((sum, core) => { sum.idleMs += core.times.idle; sum.totalMs += Object.values(core.times).reduce((a, b) => a + b, 0); return sum; }, { idleMs: 0, totalMs: 0 });
}
export function createHostDiagnostics({ now = () => performance.now(), cpu = () => process.cpuUsage(), memory = () => process.memoryUsage().rss, free = freemem, hostCpu = hostCpuTotals, every = setInterval, cancel = clearInterval } = {}) {
  const samples = [], operations = [], lateReplies = [], expired = new Map();
  let timer, previousTime, previousCpu, previousHostCpu, firstFailure = null;
  const sample = () => {
    const at = now(), usage = cpu(), host = hostCpu();
    const hostTotalMs = host.totalMs - previousHostCpu.totalMs, hostIdleMs = host.idleMs - previousHostCpu.idleMs;
    ringPush(samples, { atMs: Math.round(at), intervalMs: Math.round(at - previousTime), eventLoopDelayMs: Math.max(0, Math.round(at - previousTime - 1000)), cpuUserMs: (usage.user - previousCpu.user) / 1000, cpuSystemMs: (usage.system - previousCpu.system) / 1000, rssBytes: memory(), hostFreeBytes: free(), hostBusyFraction: hostTotalMs > 0 ? Math.max(0, Math.min(1, 1 - hostIdleMs / hostTotalMs)) : null });
    previousTime = at; previousCpu = usage; previousHostCpu = host;
  };
  return {
    start() { if (timer !== undefined) return; previousTime = now(); previousCpu = cpu(); previousHostCpu = hostCpu(); timer = every(sample, 1000); timer?.unref?.(); },
    stop() { if (timer !== undefined) { cancel(timer); timer = undefined; } },
    expired(metadata) {
      expired.set(metadata.id, { id: metadata.id, method: metadata.method, phase: metadata.phase, expiredAtMs: now() });
      if (expired.size > 32) expired.delete(expired.keys().next().value);
    },
    late(message) {
      const item = expired.get(message.id); if (!item) return;
      expired.delete(message.id);
      ringPush(lateReplies, { ...item, arrivedAfterTimeoutMs: Math.round(now() - item.expiredAtMs), error: !!message.error }, 32);
    },
    async operation(name, fn) {
      const started = now(), before = cpu(); let status = 'ok';
      try { return await fn(); } catch (error) { status = 'error'; throw error; }
      finally { const after = cpu(); ringPush(operations, { name, status, durationMs: Math.round(now() - started), cpuUserMs: (after.user - before.user) / 1000, cpuSystemMs: (after.system - before.system) / 1000 }, 32); }
    },
    pinFailure() { if (firstFailure === null) firstFailure = structuredClone(this.snapshot()); },
    snapshot() { return { timeOrigin: performance.timeOrigin, firstFailure: firstFailure === null ? null : structuredClone(firstFailure), node: process.version, platform: process.platform, logicalCpus: availableParallelism(), hostTotalBytes: totalmem(), samples: samples.slice(), operations: operations.slice(), lateReplies: lateReplies.slice() }; },
  };
}

// Executed before app scripts. Bounded numeric metadata only; no DOM/game/save data.
export function installBrowserResponsivenessDiagnostics() {
  const gaps = [], tasks = []; let frameCount = 0, lastFrame = null, contextLosses = 0;
  const keep = (rows, value) => { rows.push(value); if (rows.length > 32) rows.shift(); };
  const frame = at => {
    frameCount++;
    if (lastFrame !== null && at - lastFrame >= 250) keep(gaps, { atMs: Math.round(at), gapMs: Math.round(at - lastFrame), hidden: document.hidden });
    lastFrame = at; requestAnimationFrame(frame);
  };
  let longTasksSupported = false;
  try {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) keep(tasks, { atMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration) }); });
      observer.observe({ type: 'longtask', buffered: true }); longTasksSupported = true;
    }
  } catch { /* Unsupported observation is explicit, not an acceptance result. */ }
  document.addEventListener('webglcontextlost', () => contextLosses++, true);
  requestAnimationFrame(frame);
  window.__plantResponsivenessSnapshot = () => ({ timeOrigin: performance.timeOrigin, nowMs: Math.round(performance.now()), frameCount, lastFrameMs: lastFrame === null ? null : Math.round(lastFrame), contextLosses, longTasksSupported, frameGaps: gaps.slice(), longTasks: tasks.slice() });
}
export const browserResponsivenessSource = `(${installBrowserResponsivenessDiagnostics.toString()})()`;
