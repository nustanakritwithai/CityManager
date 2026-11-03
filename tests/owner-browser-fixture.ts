/** Natural, commercially owned, fully migrated server fixtures for browser acceptance. */
import { createCity, deserialize, expandValidatedCity, isCommercial, serialize, step } from '../src/sim.ts';
import { captureOwnerSnapshot, proposeOwnerDecision, type OwnerProposal } from '../src/owner-decision.ts';
import type { City } from '../src/sim.ts';

export function ownerBrowserFixtures() {
  const city = expandValidatedCity(createCity(61025));
  let monthly: City | undefined, manual: City | undefined, proposal: OwnerProposal | undefined;
  for (let day = 1; day <= 720 && (!monthly || !manual); day++) {
    step(city);
    const firms = city.firms.filter(f => isCommercial(f) && f.owner).sort((a, b) => a.id - b.id);
    if (!monthly && city.tick % 30 === 29 && firms.length) monthly = deserialize(serialize(city));
    if (!manual && city.tick >= 31 && city.tick % 30 >= 1 && city.tick % 30 <= 25) {
      for (const firm of firms) {
        const snapshot = captureOwnerSnapshot(city, firm.id); if (!snapshot) continue;
        const candidate = proposeOwnerDecision(snapshot);
        if (candidate.command.type !== 'hold') {
          manual = deserialize(serialize(city));
          const restored = captureOwnerSnapshot(manual, firm.id);
          if (!restored) throw Error('Owner fixture could not restore the validated snapshot');
          proposal = proposeOwnerDecision(restored); break;
        }
      }
    }
  }
  if (!monthly || !manual || !proposal || proposal.command.type === 'hold') throw Error('Natural seed61025 must produce a commercial owner and executable proposal');
  return { monthly, manual, proposal };
}
