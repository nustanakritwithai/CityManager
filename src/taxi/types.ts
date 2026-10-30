/**
 * Public taxi (phase D, design: taxi-design.th.md). Pure, economy-neutral in round 1: fares and
 * driver wages are shadow figures only; nothing here transfers money, allocates labour or saves.
 */
import type { TripPurpose } from '../traffic/types.ts';
/** Feature flag. OFF: no taxi demand is split, nothing changes. */
export const TAXI_ENABLED = false;
/** Logit sensitivity per minute of generalized cost difference. */
export const TAXI_THETA = .15;
/** Extra minutes a private car pays for parking (city-wide default for now). */
export const PARKING_PENALTY_MIN = 4;
/** Taxis never take more than this share of any OD. */
export const TAXI_AVAILABILITY_CAP = .35;
/**
 * Shadow value of time, satang per minute (converts fare to minutes). Scaled to this economy's
 * wages (1_400 satang/day); the design doc's first placeholders (3_500 flag fall) were ~6 daily
 * wages per ride and drove the share to zero. Placeholders, not approved balance.
 */
export const VALUE_OF_TIME_SATANG_PER_MIN = 20;
/** Shadow fare per person, satang: flag fall + per km + per minute. */
export const TAXI_FARE = Object.freeze({ flagFall: 50, perKm: 20, perMinute: 5 });
/** Purposes that may use taxis (owner default: school trips allowed). Freight never does. */
export const TAXI_PURPOSES: ReadonlySet<TripPurpose> = new Set<TripPurpose>(['commute', 'school', 'park']);
/** Costs of one OD for the mode choice, in minutes and km. Null = no taxi offered (e.g. outside coverage). */
export type TaxiOdCost = { carMinutes: number; taxiMinutes: number; waitMinutes: number; km: number };
/** Whole people choosing taxi for one purpose/OD in one period. */
export type TaxiRequestMass = { purpose: TripPurpose; from: number; to: number; persons: number; fareSatang: number };
/** Fractional taxi persons carried to the next period per `purpose:from:to`. */
export type TaxiCarry = Record<string, number>;
export type TaxiSplit = { taxi: TaxiRequestMass[]; roadPersons: { purpose: TripPurpose; from: number; to: number; persons: number }[]; offeredPersons: number; taxiPersons: number; carry: TaxiCarry };
