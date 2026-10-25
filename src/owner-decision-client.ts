import {
  acceptOwnerDecision,
  buildOwnerDecisionResponse,
  ownerDecisionCandidates,
  validateOwnerDecisionRequest,
  validateOwnerDecisionSelection,
} from '../server/city-advisor/src/owner-contract.mjs';
import type { OwnerDecisionRequest, OwnerDecisionResponse, OwnerCandidateId } from '../server/city-advisor/src/owner-contract.mjs';
import type { OwnerSnapshot } from './owner-decision.ts';

/** Public endpoint configuration only; the provider credential stays on the server. */
export type OwnerDecisionConnection = { enabled: boolean; endpoint: string };
export type OwnerDecisionTransportReason = 'not_configured' | 'invalid_endpoint' | 'invalid_request' | 'network_or_response' | 'invalid_report' | 'cancelled' | 'timeout' | 'provider_fallback';
export type OwnerDecisionTransportResult = {
  response: OwnerDecisionResponse | null;
  transport: 'offline' | 'remote' | 'fallback';
  reason?: OwnerDecisionTransportReason;
};

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;

export function validOwnerDecisionEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/api/city-advisor/report';
  } catch { return false; }
}

export function ownerDecisionConnectionReady(connection?: OwnerDecisionConnection): boolean {
  return connection?.enabled === true && validOwnerDecisionEndpoint(connection.endpoint);
}

function requestFor(snapshot: OwnerSnapshot): OwnerDecisionRequest {
  return validateOwnerDecisionRequest({ schemaVersion: 3, operation: 'owner-decision', locale: 'th', snapshot });
}

function ruleSelection(snapshot: OwnerSnapshot): { candidateId: OwnerCandidateId } {
  return { candidateId: ownerDecisionCandidates(snapshot).some(candidate => candidate.id === 'safe-transfer') ? 'safe-transfer' : 'hold' };
}

function fallback(request: OwnerDecisionRequest, transport: 'offline' | 'fallback', reason: OwnerDecisionTransportReason): OwnerDecisionTransportResult {
  return { response: buildOwnerDecisionResponse(request, ruleSelection(request.snapshot), 'fallback'), transport, reason };
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
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new Error('Response limit');
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

/** A single explicit proposal request. No retries, browser credentials, storage or logging. */
export async function requestOwnerDecision(
  snapshot: OwnerSnapshot,
  connection?: OwnerDecisionConnection,
  fetchImpl: typeof fetch = fetch,
  cancellation?: AbortSignal,
): Promise<OwnerDecisionTransportResult> {
  let request: OwnerDecisionRequest;
  try {
    request = requestFor(snapshot);
    if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_INPUT_BYTES) throw new Error('Input limit');
  } catch { return { response: null, transport: 'offline', reason: 'invalid_request' }; }
  if (!connection?.enabled) return fallback(request, 'offline', 'not_configured');
  if (!validOwnerDecisionEndpoint(connection.endpoint)) return fallback(request, 'offline', 'invalid_endpoint');

  const deadline = AbortSignal.timeout(20_000);
  const signal = cancellation ? AbortSignal.any([deadline, cancellation]) : deadline;
  try {
    if (signal.aborted) throw new Error('Cancelled');
    const response = await cancellable(fetchImpl(connection.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
      redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    }), signal);
    if (!response.ok) return fallback(request, 'fallback', 'network_or_response');
    const accepted = acceptOwnerDecision(await cancellable(boundedResponse(response), signal), request);
    if (!accepted) return fallback(request, 'fallback', 'invalid_report');
    if (accepted.mode === 'fallback') {
      const rule = ruleSelection(request.snapshot);
      const checked = validateOwnerDecisionSelection(accepted.selection, request.snapshot);
      if (checked.candidateId !== rule.candidateId) return fallback(request, 'fallback', 'invalid_report');
      return { response: accepted, transport: 'fallback', reason: 'provider_fallback' };
    }
    return { response: accepted, transport: 'remote' };
  } catch {
    return fallback(request, 'fallback', cancellation?.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'network_or_response');
  }
}
