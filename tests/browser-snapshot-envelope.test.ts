import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('browser snapshot helpers reject wrong current save envelopes before preserving exact city state', () => {
  const directory = new URL('./', import.meta.url);
  const files = readdirSync(directory).filter(name => name.endsWith('-smoke.mjs'));
  let checked = 0;
  for (const file of files) {
    const line = readFileSync(new URL(file, directory), 'utf8').split('\n').find(text => text.startsWith('const state'));
    const expressions = [...(line?.matchAll(/evaluate\('([^']+)'\)/g) ?? [])].map(match => match[1]);
    const expression = expressions.at(-1);
    if (!expression) continue;
    const evaluate = (value: object) => runInNewContext(expression, { window: { cityManager: { snapshot: () => JSON.stringify(value) } } });
    const actual = evaluate({ version: 19, rulesVersion: 'chain-14', accounts: { treasury: 321 }, tick: 12 });
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), { version: 9, rulesVersion: 'chain-4', accounts: { treasury: 321 }, tick: 12 }, `${file}: full state preserved`);
    const educated = evaluate({ version: 22, rulesVersion: 'chain-17', education: { version: 1, origin: 'new-city', campuses: [], people: [] }, accounts: { treasury: 321 }, tick: 12 });
    assert.equal(educated.version, 9, `${file}: education save is normalized`);
    assert.equal(educated.rulesVersion, 'chain-4');
    assert.equal(educated.education.origin, 'new-city');
    for (const invalid of [
      { version: 18, rulesVersion: 'chain-13' },
      { version: 19, rulesVersion: 'chain-13' },
      { version: 19 },
      { version: 20, rulesVersion: 'chain-14' },
      { version: 22, rulesVersion: 'chain-14' },
    ]) assert.throws(() => evaluate(invalid), /Unexpected current save envelope/, `${file}: invalid envelope rejected`);
    if (file === 'compact-smoke.mjs') {
      assert.equal(expressions.length, 2, 'historical baseline has its own raw snapshot path');
      const legacy = { version: 1, accounts: { treasury: 123 } };
      const raw = runInNewContext(expressions[0], { window: { cityManager: { snapshot: () => JSON.stringify(legacy) } } });
      assert.deepEqual(JSON.parse(JSON.stringify(raw)), legacy, 'historical baseline remains unchanged');
    }
    checked++;
  }
  assert.equal(checked, 14, 'all browser city snapshot helpers are covered');
});
