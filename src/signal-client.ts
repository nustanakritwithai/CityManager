import { acceptRemoteSignalReport } from './signal-data.ts';
import type { SignalReport, SignalRequest } from './signal-data.ts';

/** Public configuration only. Access tokens are supplied in memory by an approved login flow. */
export type SignalConnection = {
  enabled: boolean;
  endpoint: string;
  getAccessToken?: () => Promise<string | null>;
};
export type SignalTransportReason = 'not_configured' | 'invalid_endpoint' | 'authentication_missing' | 'authentication_failed' | 'network_or_response' | 'invalid_report' | 'cancelled' | 'provider_fallback';
export type SignalTransportResult = { report: SignalReport; transport: 'offline' | 'authenticated' | 'fallback'; reason?: SignalTransportReason };
const MAX_RESPONSE_BYTES = 64 * 1024;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function validSignalEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/api/city-advisor/report';
  } catch { return false; }
}
export function signalConnectionReady(connection?: SignalConnection): boolean {
  return connection?.enabled === true && validSignalEndpoint(connection.endpoint) && typeof connection.getAccessToken === 'function';
}
async function boundedResponse(response: Response): Promise<unknown> {
  if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Invalid response');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Response limit');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Response limit');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => { cleanup(); reject(new Error('Cancelled')); };
    const cleanup = () => signal.removeEventListener('abort', stop);
    if (signal.aborted) { stop(); return; }
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** One explicit report request; no retries, storage, logging or direct provider access. */
export async function requestSignalReport(input: SignalRequest, local: SignalReport, connection?: SignalConnection, fetchImpl: typeof fetch = fetch, cancellation?: AbortSignal): Promise<SignalTransportResult> {
  if (!connection?.enabled || !connection.getAccessToken) return { report: local, transport: 'offline', reason: 'not_configured' };
  if (!validSignalEndpoint(connection.endpoint)) return { report: local, transport: 'offline', reason: 'invalid_endpoint' };
  const timeout = AbortSignal.timeout(20_000);
  const signal = cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
  try {
    const token = await cancellable(connection.getAccessToken(), signal);
    if (signal.aborted) throw new Error('Cancelled');
    if (typeof token !== 'string' || token.length > 8192 || !JWT.test(token)) return { report: local, transport: 'fallback', reason: 'authentication_missing' };
    const response = await fetchImpl(connection.endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    if (response.status === 401 || response.status === 403) return { report: local, transport: 'fallback', reason: 'authentication_failed' };
    if (!response.ok) return { report: local, transport: 'fallback', reason: 'network_or_response' };
    const report = acceptRemoteSignalReport(await boundedResponse(response), local);
    if (!report) return { report: local, transport: 'fallback', reason: 'invalid_report' };
    return { report, transport: 'authenticated', ...(report.mode === 'fallback' ? { reason: 'provider_fallback' as const } : {}) };
  } catch {
    return { report: local, transport: 'fallback', reason: cancellation?.aborted ? 'cancelled' : 'network_or_response' };
  }
}
