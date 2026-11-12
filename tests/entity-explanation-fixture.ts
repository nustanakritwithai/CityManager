import { createCity, serialize, step, summary, housingCapacity, type City } from '../src/sim.ts';
import { deserializeParkSession, expandValidatedParkSession } from '../src/park-runtime.ts';
import { captureEntityExplanation } from '../src/entity-explanation-data.ts';

/** Real legacy-size simulated fixtures and their validated server-loaded cities. */
const load = (raw: string) => expandValidatedParkSession(deserializeParkSession(raw)).city;
export function entityExplanationCity() {
  const source = createCity(61025);
  for (let n = 0; n < 29; n++) step(source);
  const raw = serialize(source);
  return { raw, city: load(raw) };
}
export function entityInsufficientFixture() {
  const young = createCity(61025);
  for (let n = 0; n < 35; n++) {
    const raw = serialize(young), city = load(raw);
    for (const building of city.buildings) {
      const snapshot = captureEntityExplanation(city, { kind: 'building', buildingId: building.id });
      if (snapshot?.missing.length) return { raw, city, building: { ...building }, snapshot };
    }
    step(young);
  }
  throw Error('Actual early-game entity must provide missing evidence');
}

/** Exact ten public aggregate facts expected from this initialized fixture. */
export function entitySignalMetrics(city:City) {
  const aggregate=summary(city);
  if(!city.happiness?.rows.length)throw Error('Entity signal fixture requires initialized happiness');
  return {
    population:aggregate.population,households:city.households.length,businesses:city.firms.length,
    employed:aggregate.employed,unemployed:aggregate.unemployed,treasury:city.accounts.treasury/100,
    incomePerTick:city.ledger.filter(e=>e.tick===city.tick&&e.to==='treasury').reduce((n,e)=>n+e.amount,0)/100,
    expensesPerTick:city.ledger.filter(e=>e.tick===city.tick&&e.from==='treasury').reduce((n,e)=>n+e.amount,0)/100,
    averageHappiness:city.happiness.rows.reduce((sum,row)=>sum+row.score,0)/city.households.length,
    housingCapacity:city.buildings.reduce((n,b)=>n+housingCapacity(b).persons,0),
  };
}
