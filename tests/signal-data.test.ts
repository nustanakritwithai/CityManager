import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, housingCapacity, serialize, step, summary } from '../src/sim.ts';
import {
  captureCitySignals, requestForCapture, buildLocalSignalReport, acceptRemoteSignalReport,
  validateSignalRequest, type SignalRequest, type SignalReport, type MetricId,
} from '../src/signal-data.ts';

const metric = (request: ReturnType<typeof captureCitySignals>, id: MetricId) => request.metrics.find(value => value.id === id)!;
const sample = () => JSON.parse(readFileSync(new URL('./fixtures/signal-request.json', import.meta.url), 'utf8')) as SignalRequest;
const expected = () => JSON.parse(readFileSync(new URL('./fixtures/signal-response.json', import.meta.url), 'utf8')) as SignalReport;

test('initial actual aggregates preserve household semantics and include actual grant without mutating the city', () => {
  const city = createCity(61025), before = serialize(city), capture = captureCitySignals(city);
  assert.deepEqual(capture.metrics.map(value => value.id), ['population', 'households', 'businesses', 'employed', 'unemployed', 'treasury', 'incomePerTick', 'expensesPerTick', 'housingCapacity']);
  assert.equal(city.version, 5);
  assert.equal(metric(capture, 'population').value, 0, 'no households means an observed zero population');
  assert.equal(metric(capture, 'population').unit, 'people');
  assert.equal(metric(capture, 'households').value, city.households.length);
  assert.equal(metric(capture, 'households').unit, 'households');
  assert.equal(metric(capture, 'businesses').value, city.firms.length);
  assert.equal(metric(capture, 'businesses').unit, 'establishments');
  assert.equal(metric(capture, 'treasury').value, 29450, 'initial road construction is already paid from the grant');
  assert.equal(metric(capture, 'treasury').unit, 'currency');
  assert.equal(metric(capture, 'incomePerTick').value, 30000, 'initial grant is an actual receipt at tick zero');
  assert.equal(metric(capture, 'expensesPerTick').value, 550, 'initial road construction is an actual current-day expense');
  const report = buildLocalSignalReport(requestForCapture(capture));
  assert(!report.data.missingData.some(value => value.id === 'missing.current.population'));
  assert(report.data.missingData.some(value => value.id === 'missing.current.averageHappiness'));
  assert(report.data.missingData.some(value => value.id === 'missing.prior.households'));
  assert(!report.data.signals.some(value => value.kind === 'trend'));
  assert.equal(serialize(city), before);
});

test('version-five mapping includes owner labour and distinguishes people, household records, workforce and actual person capacity', () => {
  const city = createCity(61025);
  for (let day = 0; day < 180; day++) step(city);
  const before = serialize(city), capture = captureCitySignals(city), actual = summary(city);
  assert(city.households.some(household => household.members > 1), 'real seeded family composition is present');
  assert.equal(metric(capture, 'population').value, actual.population);
  assert.equal(metric(capture, 'households').value, actual.households);
  assert.notEqual(metric(capture, 'population').value, metric(capture, 'households').value);
  assert.equal(metric(capture, 'employed').value, actual.employed);
  assert.equal(metric(capture, 'unemployed').value, actual.unemployed);
  assert.equal(metric(capture, 'unemployed').value, actual.workforce - actual.employed);
  assert.notEqual(metric(capture, 'unemployed').value, actual.population - actual.employed, 'dependents are not unemployed workforce');
  assert.equal(metric(capture, 'housingCapacity').value, actual.personCapacity);
  assert.equal(metric(capture, 'housingCapacity').unit, 'people');
  assert.equal(metric(capture, 'housingCapacity').value, city.buildings.filter(building => building.zone === 'R').reduce((total, building) => total + housingCapacity(building).persons, 0));
  const report = buildLocalSignalReport(requestForCapture(capture));
  assert.deepEqual(report.data.missingData.filter(value => value.reason === 'current_metric_unavailable').map(value => value.metricRefs[0]), ['averageHappiness', 'pollution', 'trafficPressure']);
  assert(report.data.signals.some(value => value.id === 'threshold.housing-capacity-exceeded'));
  assert.equal(serialize(city), before, 'capture/report preserve the complete version-five save and RNG');
});

test('ledger flows use only current-day treasury endpoints and convert integer satang to credits', () => {
  const city = createCity(61025);
  for (let day = 0; day < 65; day++) step(city);
  city.accounts.treasury = 123456;
  city.ledger = [
    { tick: city.tick - 1, from: 'outside', to: 'treasury', amount: 9900, reason: 'Earlier receipt' },
    { tick: city.tick, from: 'outside', to: 'treasury', amount: 1001, reason: 'Current grant' },
    { tick: city.tick, from: 'treasury', to: 'construction', amount: 205, reason: 'Current capital expense' },
    { tick: city.tick, from: 'household:1', to: 'firm:2', amount: 800, reason: 'Not a city receipt' },
    { tick: city.tick + 1, from: 'outside', to: 'treasury', amount: 77700, reason: 'Future receipt excluded' },
  ];
  const before = serialize(city), capture = captureCitySignals(city);
  assert.equal(metric(capture, 'households').value, city.households.length);
  assert.equal(metric(capture, 'businesses').value, city.firms.length);
  assert.equal(metric(capture, 'treasury').value, 1234.56);
  assert.equal(metric(capture, 'incomePerTick').value, 10.01);
  assert.equal(metric(capture, 'expensesPerTick').value, 2.05);
  assert.equal(serialize(city), before);
  city.accounts.treasury = 0;
  assert.equal(metric(capture, 'treasury').value, 1234.56, 'capture owns values rather than live state references');
});

test('observed capture history keeps exact windows and never reconstructs missing or same-day history', () => {
  const city = createCity(), prior = captureCitySignals(city);
  step(city); step(city);
  const current = captureCitySignals(city), request = requestForCapture(current, prior);
  assert.deepEqual(request.snapshot.window, { startTick: 0, endTick: 2 });
  const report = buildLocalSignalReport(request);
  assert.equal(report.data.provenance.comparisonPriorTick, 0);
  assert.equal(report.data.provenance.trust, 'client_reported_unverified');
  assert.equal(report.data.signals.filter(value => value.kind === 'trend').length, 9);
  assert(report.data.signals.filter(value => value.kind === 'trend').every(value => value.window.startTick === 0 && value.window.endTick === 2));
  assert(report.data.metrics.every(value => value.window.startTick === 2 && value.window.endTick === 2));
  assert(report.data.priorMetrics.every(value => value.window.startTick === 0 && value.window.endTick === 0));
  assert.equal(requestForCapture(current, current).snapshot.prior, undefined);
  assert.equal(requestForCapture(prior, current).snapshot.prior, undefined);
  current.metrics[0].value += 100;
  assert.notEqual(request.snapshot.metrics[0].value, current.metrics[0].value, 'request copies captures');
});

test('offline report matches the standalone backend synthetic contract fixture exactly', () => {
  assert.deepEqual(buildLocalSignalReport(sample()), expected());
});

test('strict input rejects invented fields, ambiguous units and malformed metric identifiers', () => {
  const cases: ((value: any) => void)[] = [
    value => { value.question = 'Mutate state'; },
    value => { value.snapshot.metrics[0].id = ['treasury']; },
    value => { value.snapshot.metrics[0].id = { toString: 'treasury' }; },
    value => { value.snapshot.metrics[0].value = Infinity; },
    value => { value.snapshot.metrics[0].unit = 'USD'; },
    value => { value.snapshot.metrics.push(value.snapshot.metrics[0]); },
    value => { value.snapshot.window.endTick++; },
    value => { value.snapshot.prior.tick = value.snapshot.tick; },
    value => { value.snapshot.metrics.find((metric: any) => metric.id === 'population').value = 1.5; },
  ];
  for (const change of cases) { const value = sample(); change(value); assert.throws(() => validateSignalRequest(value), /invalid_signal_request/); }
});

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}
test('remote acceptance checks deterministic data independent of key order and retains only local text', () => {
  const local = buildLocalSignalReport(sample());
  const remote = structuredClone(local);
  remote.mode = 'ai';
  remote.report.observations.forEach(observation => { observation.text = '<img src=x onerror=alert(1)> invented prose'; });
  remote.report.limitations = ['untrusted remote limitation'];
  const original = structuredClone(local);
  const accepted = acceptRemoteSignalReport(reverseKeys(remote), local);
  assert(accepted);
  assert.equal(accepted.mode, 'ai');
  assert.deepEqual(accepted.data, local.data);
  assert.deepEqual(accepted.report.observations, local.report.observations);
  assert.deepEqual(accepted.report.limitations, local.report.limitations);
  assert.deepEqual(local, original);
  assert(!JSON.stringify(accepted).includes('<img'));
});

test('remote references, tick, rules, category, missing-data or causal invention are rejected', () => {
  const local = buildLocalSignalReport(sample());
  const cases: ((value: any) => void)[] = [
    value => { value.snapshotTick++; },
    value => { value.mode = 'authoritative'; },
    value => { value.data.metrics[0].value++; },
    value => { value.data.signals[0].delta++; },
    value => { value.data.missingData = []; },
    value => { value.data.provenance.trust = 'verified'; },
    value => { value.report.severity = 9; },
    value => { value.report.summarySignalIds = ['invented']; },
    value => { value.report.summarySignalIds = [value.report.summarySignalIds[0], value.report.summarySignalIds[0]]; },
    value => { value.report.groups[0].category = 'mobility'; },
    value => { value.report.groups.push(value.report.groups[0]); },
    value => { value.report.groups[0].signalIds.push(value.report.groups[0].signalIds[0]); },
    value => { value.report.observations[0].signalRefs = ['invented']; },
    value => { value.report.observations[0].metricRefs = ['unavailable']; },
    value => { value.report.observations[0].emphasized = !value.report.observations[0].emphasized; },
    value => { value.report.observations.pop(); },
    value => { value.report.observations[1] = value.report.observations[0]; },
    value => { value.report.hypotheses = ['unproven cause']; },
  ];
  for (const change of cases) { const value = structuredClone(local); change(value); assert.equal(acceptRemoteSignalReport(value, local), null); }
});

