import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLocalReport, buildOperatorReport, UPSTREAM } from '../src/server.mjs';

const input = () => JSON.parse(readFileSync(new URL('../examples/request.json', import.meta.url), 'utf8'));
const placeholder = 'non-deployable-guardrail-test-placeholder';

test('provider timeout produces grounded fallback without retry or sensitive exception text', async () => {
  const body = input();
  let calls = 0;
  const report = await buildOperatorReport(body, {
    upstreamEnabled: true, apiKey: placeholder, maxTokens: 400,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, UPSTREAM);
      assert(options.signal instanceof AbortSignal);
      assert.equal(options.redirect, 'error');
      throw new DOMException('synthetic-sensitive-timeout-detail', 'TimeoutError');
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(report, buildLocalReport(body));
  assert(!JSON.stringify(report).includes('synthetic-sensitive-timeout-detail'));
  assert(!JSON.stringify(report).includes(placeholder));
});

test('oversized provider stream stops processing and preserves deterministic fallback', async () => {
  const body = input();
  let calls = 0;
  const report = await buildOperatorReport(body, {
    upstreamEnabled: true, apiKey: placeholder, maxTokens: 400,
    fetchImpl: async () => {
      calls++;
      return new Response('x'.repeat(32769), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(report, buildLocalReport(body));
  assert(!JSON.stringify(report).includes(placeholder));
});
