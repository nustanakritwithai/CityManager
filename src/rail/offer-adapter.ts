/** Synchronous proposed modal handoff. Not installed in PR100/104 or the frozen PR6 draft.
 * The host must commit the returned demand together with the rail runtime, before yielding or
 * saving. A batch-limit refusal retains original road ownership; no invisible demand eviction. */
import { reserveRailDemand, type ModalDemand } from './demand-contract.ts';
import { PassengerRail, type PassengerOffer } from './passenger.ts';

export function offerLeasedPassengerDemand(rail: PassengerRail, demand: ModalDemand, offer: PassengerOffer) {
  if (demand.id !== offer.requestId || demand.from !== offer.from || demand.to !== offer.to) throw Error('Offer source does not match modal demand');
  // Validate/reserve the candidate first. Failure never mutates demand or rail.
  const reserved = reserveRailDemand(demand, offer.leaseId, offer.persons);
  const result = rail.offer(offer);
  return { ...result, demand: result.accepted ? reserved : structuredClone(demand) };
}
