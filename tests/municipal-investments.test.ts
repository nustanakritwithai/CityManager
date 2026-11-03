import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, serialize, treasurySpendable } from '../src/sim.ts';
import { EDUCATION_COST } from '../src/education.ts';
import { PARK, PARK_STAFF } from '../src/parks.ts';
import { PLANTS } from '../src/utilities.ts';
import { municipalInvestments, renderMunicipalInvestments, type MunicipalInvestmentTool } from '../src/municipal-investments.ts';

class FakeElement {
  children: FakeElement[] = []; dataset: Record<string,string> = {}; className = ''; textContent = ''; type = ''; disabled = false;
  handler?: () => void;
  append(...nodes: FakeElement[]) { this.children.push(...nodes); }
  addEventListener(event: string, handler: () => void) { if (event === 'click') this.handler = handler; }
  click() { if (!this.disabled) this.handler?.(); }
}
const all = (el: FakeElement): FakeElement[] => [el, ...el.children.flatMap(all)];

test('investment choices use actual costs, include wage caveats, and omit unavailable education', () => {
  const c = createCity(61025), before = serialize(c), rows = municipalInvestments(c);
  assert.deepEqual(rows.map(r => r.tool), ['park','power','water','school','university']);
  assert.deepEqual(rows.map(r => r.cost), [PARK.cost, PLANTS.power.cost, PLANTS.water.cost, EDUCATION_COST.school.build, EDUCATION_COST.university.build]);
  assert.deepEqual(rows.map(r => r.upkeep), [PARK.upkeep, PLANTS.power.upkeep, PLANTS.water.upkeep, EDUCATION_COST.school.upkeep, EDUCATION_COST.university.upkeep]);
  assert.match(rows[0].benefit, /เมื่อมีคนสมัครและงบค่าจ้าง/);
  assert.match(rows[0].benefit, new RegExp(String(PARK_STAFF.monthlyWage / 100)));
  assert.equal(serialize(c), before, 'opening projections does not spend');
  delete c.education; assert.deepEqual(municipalInvestments(c).map(r => r.tool), ['park','power','water']);
  c.accounts.treasury = 0; assert.equal(treasurySpendable(c), 0); assert.ok(municipalInvestments(c).every(r => !r.affordable));
});

test('buttons only select placement tools, and are disabled without a handler', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new FakeElement() } });
  try {
    const city = createCity(61025), before = serialize(city), selected: MunicipalInvestmentTool[] = [];
    const node = renderMunicipalInvestments(city, t => selected.push(t)) as unknown as FakeElement;
    const buttons = all(node).filter(e => e.dataset.investmentTool);
    assert.equal(buttons.length, 5); buttons.forEach(b => b.click());
    assert.deepEqual(selected, ['park','power','water','school','university']);
    assert.equal(serialize(city), before, 'tool selection never places or pays');
    const noHandler = renderMunicipalInvestments(city) as unknown as FakeElement;
    assert.ok(all(noHandler).filter(e => e.dataset.investmentTool).every(b => b.disabled));
  } finally { if (original) Object.defineProperty(globalThis, 'document', original); else delete (globalThis as { document?: unknown }).document; }
});
