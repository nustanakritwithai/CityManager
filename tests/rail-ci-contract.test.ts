import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('rail traffic acceptance runs exact PR head, conserved fixtures, and hosted Chrome',()=>{
 const yml=readFileSync(new URL('../.github/workflows/rail-traffic.yml',import.meta.url),'utf8');
 for(const expected of ['github.event.pull_request.head.sha || github.sha','persist-credentials: false','contents: read','tests/rail-game-worker.test.ts','tests/rail-game-bridge.test.ts','tests/rail-traffic-intake.test.ts','tests/rail-browser-fixture.test.ts','tests/fixtures/save-smoke/bus-optional-day60.json','src/sim.ts','CITYMANAGER_RAIL_CHECKS: activation','CITYMANAGER_BROWSER: google-chrome','tests/server-save-browser-smoke.mjs'])assert.ok(yml.includes(expected),expected);
});
