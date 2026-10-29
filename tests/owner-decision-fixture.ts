import { isMarket, type City } from '../src/sim.ts';

/** Recorded cash stress before the session checkpoint gives the monthly AI
 * path a real contribution choice. Fully paid monthly profits now correctly
 * offer hold, not a second withdrawal of the development reserve. */
export function stressOwnerCash(city: City) {
  const firm = city.firms.find(isMarket)!;
  const amount = city.accounts[firm.wallet];
  city.accounts[firm.wallet] -= amount; city.accounts.landlord += amount;
  city.ledger.push({ tick: city.tick, from: firm.wallet, to: 'landlord', amount, reason: 'Synthetic reserve-boundary fixture' });
}
