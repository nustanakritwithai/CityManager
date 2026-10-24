import type { OwnerSnapshot } from '../../../src/owner-decision.ts';

export type OwnerCandidateId = 'hold' | 'safe-transfer';
export type OwnerDecisionRequest = { schemaVersion: 3; operation: 'owner-decision'; locale: 'th'; snapshot: OwnerSnapshot };
export type OwnerDecisionResponse = { schemaVersion: 3; operation: 'owner-decision'; mode: 'ai' | 'fallback'; snapshot: OwnerSnapshot; selection: { candidateId: OwnerCandidateId } };
export function validateOwnerSnapshot(value: unknown): OwnerSnapshot;
export function validateOwnerDecisionRequest(value: unknown): OwnerDecisionRequest;
export function ownerDecisionCandidates(snapshot: OwnerSnapshot): { id: OwnerCandidateId; action: string; amountSatang: number }[];
export function ownerProviderInput(snapshot: OwnerSnapshot): { tick: number; rulesVersion: string; moneyUnit: 'satang'; budgetKnown: boolean; missing: OwnerSnapshot['missing']; facts: OwnerSnapshot['facts']; candidates: { id: OwnerCandidateId; action: string; amountSatang: number }[] };
export function validateOwnerDecisionSelection(value: unknown, snapshot: OwnerSnapshot): { candidateId: OwnerCandidateId };
export function buildOwnerDecisionResponse(request: OwnerDecisionRequest, selection: unknown, mode?: 'ai' | 'fallback'): OwnerDecisionResponse;
export function acceptOwnerDecision(value: unknown, request: OwnerDecisionRequest): OwnerDecisionResponse | null;
