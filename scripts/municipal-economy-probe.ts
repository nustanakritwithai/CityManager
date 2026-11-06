/** Limited deterministic treasury comparison, not a general playtest.
 * Run this unchanged against each rate; outputs JSONL with money in baht.
 * Utility construction is assisted by the same helper as balance tests.
 */
import { createCity, step, summary, serialize, deserialize, buildRoad, zoneCell, SIZE, MUNICIPAL_SERVICE_PER_RESIDENT } from '../src/sim.ts';
import { treasuryBudget } from '../src/overview-data.ts';
import { keepSupplied } from '../tests/plants.ts';

for (const expand of [false, true]) for (const seed of [61025, 2026, 42]) {
  let city = createCity(seed), minimumTreasury = city.accounts.treasury;
  const snapshots = [];
  let attemptedZones = 0, successfulZones = 0;
  for (let day = 1; day <= 720; day++) {
    if (expand && day === 200) {
      buildRoad(city, 12 * SIZE + 11, 18 * SIZE + 11);
      buildRoad(city, 18 * SIZE + 2, 18 * SIZE + 20);
      buildRoad(city, 15 * SIZE + 11, 15 * SIZE + 20);
      const zone = (cell: number, kind: 'R' | 'I' | 'C' | 'F') => {
        attemptedZones++;
        if (zoneCell(city, cell, kind).ok) successfulZones++;
      };
      for (let x = 2; x <= 10; x++) {
        zone(17 * SIZE + x, 'R'); zone(19 * SIZE + x, 'R');
      }
      for (let x = 12; x <= 19; x++) {
        zone(16 * SIZE + x, x < 16 ? 'I' : 'C');
        zone(14 * SIZE + x, 'F'); zone(19 * SIZE + x, 'F');
      }
    }
    step(city); keepSupplied(city);
    minimumTreasury = Math.min(minimumTreasury, city.accounts.treasury);
    if ([30, 90, 180, 360, 720].includes(day)) {
      const budget = treasuryBudget(city);
      snapshots.push({
        day, population: summary(city).population, treasury: city.accounts.treasury / 100,
        monthlyNet: budget.net / 100,
        services: (budget.expense.find(e => e.key === 'municipal-services')?.amount ?? 0) / 100,
        householdCash: city.households.reduce((sum, household) => sum + city.accounts[household.wallet], 0) / 100,
        brokeFirms: city.firms.filter(firm => city.accounts[firm.wallet] === 0).length,
      });
      city = deserialize(serialize(city));
    }
  }
  console.log(JSON.stringify({
    ratePerResident: MUNICIPAL_SERVICE_PER_RESIDENT / 100, expand, seed,
    attemptedZones, successfulZones, minimumTreasury: minimumTreasury / 100, snapshots,
  }));
}
