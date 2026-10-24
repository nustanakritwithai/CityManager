import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity } from '../src/sim.ts';
import { captureCitySignals, requestForCapture, buildLocalSignalReport } from '../src/signal-data.ts';
import { requestSignalReport, validSignalEndpoint, signalConnectionReady } from '../src/signal-client.ts';
import type { SignalConnection } from '../src/signal-client.ts';

const endpoint = 'https://advisor.example/api/city-advisor/report';
const connection = (): SignalConnection => ({ enabled: true, endpoint });
const fixture = () => {
  const request = requestForCapture(captureCitySignals(createCity(61025)));
  return { request, local: buildLocalSignalReport(request) };
};
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('production connection is disabled by default and public readiness needs only explicit enablement and a valid endpoint', async () => {
  const { request, local } = fixture(); let calls = 0;
  const neverFetch = (async () => { calls++; throw new Error('Should not fetch'); }) as typeof fetch;
  assert.equal(signalConnectionReady(), false);
  assert.equal(signalConnectionReady({ enabled: true, endpoint }), true);
  assert.equal(signalConnectionReady({ enabled: true, endpoint: '' }), false);
  assert.equal((await requestSignalReport(request, local, undefined, neverFetch)).transport, 'offline');
  assert.equal((await requestSignalReport(request, local, { enabled: false, endpoint }, neverFetch)).transport, 'offline');
  assert.equal(calls, 0);
});

test('endpoint accepts only HTTPS exact report route without URL credentials or parameters', async () => {
  assert.equal(validSignalEndpoint(endpoint), true);
  for (const url of ['http://advisor.example/api/city-advisor/report', `${endpoint}?key=no`, `${endpoint}#token`, 'https://user:pass@advisor.example/api/city-advisor/report', 'https://api.opentyphoon.ai/v1/chat/completions', `${endpoint}/`]) assert.equal(validSignalEndpoint(url), false);
  const { request, local } = fixture(); let calls = 0;
  const result = await requestSignalReport(request, local, { ...connection(), endpoint: 'http://localhost/api/city-advisor/report' }, (async () => { calls++; throw new Error(); }) as typeof fetch);
  assert.equal(result.reason, 'invalid_endpoint'); assert.equal(calls, 0);
});

test('mock public report sends only aggregate schema without authentication or cookies and returns grounded prose', async () => {
  const { request, local } = fixture(); let calls = 0;
  const remote = structuredClone(local); remote.mode = 'ai';
  for (const row of remote.report.observations) row.text = 'Remote prose is not trusted';
  const result = await requestSignalReport(request, local, connection(), (async (url, options) => {
    calls++;
    assert.equal(url, endpoint);
    assert.equal(options?.method, 'POST'); assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error');
    assert.equal(options?.referrerPolicy, 'no-referrer'); assert.equal(options?.cache, 'no-store');
    assert(options?.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(String(options?.body)), request);
    assert.deepEqual(options?.headers, { 'Content-Type': 'application/json' });
    assert.equal((options?.headers as Record<string, string>).Authorization, undefined);
    assert.equal((options?.headers as Record<string, string>).Cookie, undefined);
    assert(!String(options?.body).includes('TYPHOON_API_KEY'));
    return json(remote);
  }) as typeof fetch);
  assert.equal(calls, 1); assert.equal(result.transport, 'remote'); assert.equal(result.report.mode, 'ai');
  assert.deepEqual(result.report.report.observations.map(row => row.text), local.report.observations.map(row => row.text));
  assert(!JSON.stringify(result).includes('Remote prose is not trusted'));
});

test('remote rejection and network errors preserve fallback without login flow, retries or sensitive text', async () => {
  const { request, local } = fixture(); let calls = 0;
  for (const fetcher of [async () => new Response('sensitive upstream detail', { status: 401 }), async () => new Response('sensitive upstream detail', { status: 403 }), async () => { throw new Error('sensitive upstream detail'); }]) {
    const result = await requestSignalReport(request, local, connection(), (async () => { calls++; return fetcher(); }) as typeof fetch);
    assert.equal(result.transport, 'fallback'); assert.equal(result.report, local);
    assert(!JSON.stringify(result).includes('sensitive upstream detail'));
  }
  assert.equal(calls, 3);
});

test('invented references, mismatched data, oversized bodies and non-JSON responses fall back', async () => {
  const { request, local } = fixture();
  const forgedRefs = structuredClone(local); forgedRefs.report.summarySignalIds = ['signal.invented'];
  const forgedData = structuredClone(local); forgedData.data.metrics[0].value += 1;
  const outputs = [json(forgedRefs), json(forgedData), new Response('x'.repeat(65537), { headers: { 'Content-Type': 'application/json' } }), new Response(JSON.stringify(local))];
  let calls = 0;
  for (const response of outputs) {
    const result = await requestSignalReport(request, local, connection(), (async () => { calls++; return response; }) as typeof fetch);
    assert.equal(result.transport, 'fallback'); assert.equal(result.report, local);
  }
  assert.equal(calls, 4);
});

test('closing a pending public fetch cancels with deterministic fallback and no retry', async () => {
  const { request, local } = fixture(); const controller = new AbortController(); let calls = 0;
  const pending = requestSignalReport(request, local, connection(), (async () => { calls++; return new Promise<Response>(() => {}); }) as typeof fetch, controller.signal);
  controller.abort();
  const result = await pending;
  assert.equal(result.reason, 'cancelled'); assert.equal(result.report, local); assert.equal(calls, 1);
});

test('the request deadline has a distinct reason and never automatically retries', async context => {
  const deadline = new AbortController();
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 20_000);
    return deadline.signal;
  });
  const { request, local } = fixture(); let calls = 0;
  const pending = requestSignalReport(request, local, connection(), (async () => {
    calls++; return new Promise<Response>(() => {});
  }) as typeof fetch);
  deadline.abort();
  const result = await pending;
  assert.equal(result.reason, 'timeout'); assert.equal(result.report, local);
  assert.equal(result.transport, 'fallback'); assert.equal(calls, 1);
});
