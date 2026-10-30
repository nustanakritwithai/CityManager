/** Proposed PR6 boundary, NOT an adapter installed in the current traffic runtime.
 * Integer people own mass; the current road model uses ten-person representative units.
 * Leasing removes only unadmitted demand from road eligibility immediately. Waiting/onboard
 * rail is unresolved RAIL-owned demand, never simultaneously assigned to road. Only actual
 * completed journeys earn service credit. No City, wallet, save or renderer dependency. */
import { PEOPLE_PER_VEHICLE } from '../traffic/types.ts';
import { safeCount, validId } from './graph.ts';

export type RailLease = { id: string; persons: number; completedPersons: number };
export type ModalDemand = {
  id: string; from: number; to: number; offeredPersons: number;
  /** Cumulative handoff to the road owner (includes its eventual completions). */
  roadAdmittedPersons: number; leases: RailLease[];
};
export type RailServiceReceipt = {
  requestId: string; leaseId: string; from: number; to: number;
  /** Cumulative for this lease, not a delta; retry/reordering cannot duplicate service. */
  completedPersons: number;
};
function validate(d: ModalDemand): void {
  if (!validId(d.id) || ![d.from, d.to, d.offeredPersons, d.roadAdmittedPersons].every(safeCount) || !Array.isArray(d.leases)) throw Error('Invalid modal demand');
  const ids = new Set<string>(); let leased = 0;
  for (const l of d.leases) {
    if (!validId(l.id) || ids.has(l.id) || !safeCount(l.persons) || l.persons < 1 || !safeCount(l.completedPersons) || l.completedPersons > l.persons) throw Error('Invalid rail lease');
    ids.add(l.id); leased += l.persons;
  }
  if (!safeCount(leased) || d.roadAdmittedPersons + leased > d.offeredPersons) throw Error('Modal ownership exceeds offered demand');
}
export function modalDemandSummary(d: ModalDemand) {
  validate(d);
  const leased = d.leases.reduce((n, l) => n + l.persons, 0), railCompleted = d.leases.reduce((n, l) => n + l.completedPersons, 0);
  const roadAssignable = d.offeredPersons - d.roadAdmittedPersons - leased, railPending = leased - railCompleted;
  return { offered: d.offeredPersons, roadAdmitted: d.roadAdmittedPersons, roadAssignable, railPending, railCompleted,
    unresolved: roadAssignable + railPending,
    completedRailRoadEquivalents: railCompleted / PEOPLE_PER_VEHICLE,
    conservationError: d.offeredPersons - d.roadAdmittedPersons - roadAssignable - railPending - railCompleted };
}
export function reserveRailDemand(d: ModalDemand, leaseId: string, persons: number): ModalDemand {
  const summary = modalDemandSummary(d);
  if (!validId(leaseId) || !safeCount(persons) || persons < 1) throw Error('Invalid rail reservation');
  const existing = d.leases.find(l => l.id === leaseId);
  if (existing) { if (existing.persons !== persons) throw Error('Conflicting lease retry'); return structuredClone(d); }
  if (persons > summary.roadAssignable) throw Error('Cannot lease already assigned or reserved road demand');
  return { ...d, leases: [...d.leases.map(l => ({ ...l })), { id: leaseId, persons, completedPersons: 0 }] };
}
export function admitRoadDemand(d: ModalDemand, persons: number): ModalDemand {
  const summary = modalDemandSummary(d);
  if (!safeCount(persons) || persons > summary.roadAssignable) throw Error('Road cannot admit rail-owned demand');
  return { ...structuredClone(d), roadAdmittedPersons: d.roadAdmittedPersons + persons };
}
export function acknowledgeRailService(d: ModalDemand, receipt: RailServiceReceipt): ModalDemand {
  validate(d);
  const lease = d.leases.find(l => l.id === receipt.leaseId);
  if (receipt.requestId !== d.id || receipt.from !== d.from || receipt.to !== d.to || !lease || !safeCount(receipt.completedPersons) || receipt.completedPersons > lease.persons) throw Error('Rail receipt does not match leased demand');
  return { ...d, leases: d.leases.map(l => ({ ...l, completedPersons: l === lease ? Math.max(l.completedPersons, receipt.completedPersons) : l.completedPersons })) };
}
