import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createCity, isMarket, step } from '../src/sim.ts';

// Node's test runner does not load CSS; the application bundler still does.
registerHooks({ load(url, context, nextLoad) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context); } });
const { renderAgriculture } = await import('../src/context-panels.ts');

class FakeElement {
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  className = '';
  textContent = '';
  classList = { add: (..._names: string[]) => undefined };
  style = { setProperty: (_name: string, _value: string) => undefined };
  append(...children: FakeElement[]) { this.children.push(...children); }
  setAttribute(_name: string, _value: string) {}
  addEventListener(_name: string, _callback: unknown) {}
}
const findMetric = (node: FakeElement): FakeElement | undefined => node.dataset.contextMetric === 'crop-stock' ? node : node.children.map(findMetric).find(Boolean);

test('farm inspector renders stock against each real level capacity without changing market or factory caps', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new FakeElement() } });
  try {
    const city = createCity(61025); for (let day = 0; day < 60; day++) step(city);
    const farm = city.firms.find(f => f.zone === 'F')!, factory = city.firms.find(f => f.zone === 'I')!, market = city.firms.find(isMarket)!;
    assert.ok(farm && factory && market);
    const farmBuilding = city.buildings.find(b => b.id === farm.building)!;
    for (const [level, capacity] of [[1, 96], [2, 96], [3, 96], [4, 120], [5, 144], [6, 168]]) {
      farmBuilding.level = level; farm.cropInventory = level > 3 ? 100 : 90;
      const [body] = renderAgriculture(city, farmBuilding, farm, 1);
      const metric = findMetric(body as unknown as FakeElement)!;
      assert.ok(metric, `level ${level} crop stock metric`);
      assert.equal(metric.dataset.value, String(farm.cropInventory));
      assert.equal(metric.dataset.capacity, String(capacity));
      assert.equal(metric.children[1]?.textContent, `${farm.cropInventory} / ${capacity} ล็อต`);
    }
    const factoryBuilding = city.buildings.find(b => b.id === factory.building)!;
    for (const [level, capacity] of [[1, 24], [4, 28], [6, 36]]) {
      factoryBuilding.level = level;
      const metric = findMetric(renderAgriculture(city, factoryBuilding, factory, 1)[0] as unknown as FakeElement)!;
      assert.equal(metric.dataset.capacity, String(capacity));
    }
    const marketBuilding = city.buildings.find(b => b.id === market.building)!;
    market.owner = null;
    const metric = findMetric(renderAgriculture(city, marketBuilding, market, 1)[0] as unknown as FakeElement)!;
    assert.equal(metric.dataset.capacity, '48');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
});
