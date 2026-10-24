import { acceptEntityExplanation, validateEntityRequest } from '../server/city-advisor/src/entity-contract.mjs';
import type { EntityRequest, EntityResponse } from '../server/city-advisor/src/entity-contract.mjs';

/** Public configuration only. Entity transmission stays disabled unless explicitly enabled. */
export type EntityConnection = { enabled: boolean; endpoint: string };
export type EntityTransportReason = 'not_configured' | 'invalid_endpoint' | 'invalid_request' | 'network_or_response' | 'invalid_report' | 'cancelled' | 'timeout' | 'provider_fallback';
export type EntityTransportResult = { report: EntityResponse; transport: 'offline' | 'remote' | 'fallback'; reason?: EntityTransportReason };
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

export function validEntityEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/api/city-advisor/report';
  } catch { return false; }
}
export function entityConnectionReady(connection?: EntityConnection): boolean {
  return connection?.enabled === true && validEntityEndpoint(connection.endpoint);
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
async function boundedResponse(response: Response): Promise<unknown> {
  if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Invalid response');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Response limit');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Response limit');
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** One user-triggered report. No credentials, logging, storage, tools or automatic retry. */
export async function requestEntityExplanation(input: EntityRequest, local: EntityResponse, connection?: EntityConnection, fetchImpl: typeof fetch = fetch, cancellation?: AbortSignal): Promise<EntityTransportResult> {
  if (!connection?.enabled) return { report: local, transport: 'offline', reason: 'not_configured' };
  if (!validEntityEndpoint(connection.endpoint)) return { report: local, transport: 'offline', reason: 'invalid_endpoint' };
  let body: string;
  try {
    const checked = validateEntityRequest(input);
    if (!acceptEntityExplanation(local, local) || checked.snapshot.snapshotKey !== local.snapshot.snapshotKey) throw new Error('Invalid local binding');
    body = JSON.stringify(checked);
    if (new TextEncoder().encode(body).byteLength > MAX_INPUT_BYTES) throw new Error('Input limit');
  } catch { return { report: local, transport: 'offline', reason: 'invalid_request' }; }
  const deadline = AbortSignal.timeout(20_000);
  const signal = cancellation ? AbortSignal.any([deadline, cancellation]) : deadline;
  try {
    if (signal.aborted) throw new Error('Cancelled');
    const response = await cancellable(fetchImpl(connection.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal,
      redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    }), signal);
    if (!response.ok) return { report: local, transport: 'fallback', reason: 'network_or_response' };
    const report = acceptEntityExplanation(await cancellable(boundedResponse(response), signal), local);
    if (!report) return { report: local, transport: 'fallback', reason: 'invalid_report' };
    return { report, transport: 'remote', ...(report.mode === 'fallback' ? { reason: 'provider_fallback' as const } : {}) };
  } catch {
    return { report: local, transport: 'fallback', reason: cancellation?.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'network_or_response' };
  }
}
