import { access, firmCapacity, type City } from './sim.ts';
import { buildingCardData, householdCardData } from './building-card-data.ts';
import type { BuildingCardData, HouseholdCardData } from './building-card-data.ts';
import { makeEntitySnapshot, ENTITY_FACT_DEFINITIONS } from '../server/city-advisor/src/entity-contract.mjs';
import type { EntityFact, EntityMissingReason, EntitySnapshot } from '../server/city-advisor/src/entity-contract.mjs';

export type EntitySelection = { kind: 'building'; buildingId: number } | { kind: 'household'; householdId: number; sourceBuildingId: number; sourceCell: number };
export type { EntitySnapshot, EntityRequest, EntityResponse, EntityRow, EntityRows, EntityFact, EntityReportSelection } from '../server/city-advisor/src/entity-contract.mjs';
export { ENTITY_KIND_LABELS, ENTITY_FACT_DEFINITIONS, makeEntitySnapshot, validateEntitySnapshot, validateEntityRequest, validateEntitySelection, buildEntityReport, buildLocalEntityExplanation, acceptEntityExplanation, entityExplanationCandidates, entityExplanationRows, entityFactEvidence } from '../server/city-advisor/src/entity-contract.mjs';

/** The selected card is projected into copied bounded scalars. No save, wallet or journal is transmitted. */
export function captureEntityExplanation(city: City, selection: EntitySelection | null): EntitySnapshot | null {
  if (!selection) return null;
  try {
    let card: BuildingCardData | HouseholdCardData | null;
    if (selection.kind === 'building') card = buildingCardData(city, selection.buildingId);
    else if (selection.kind === 'household') {
      const source = city.buildings.find(building => building.id === selection.sourceBuildingId && building.cell === selection.sourceCell);
      const household = city.households.find(item => item.id === selection.householdId);
      if (!source || !household) return null;
      const sourceFirm = city.firms.find(item => item.building === source.id);
      const linked = household.home === source.id || sourceFirm && [...city.employment, ...city.ownerLabor].some(item => item.householdId === household.id && item.firmId === sourceFirm.id);
      if (!linked) return null;
      card = householdCardData(city, selection.householdId);
    } else return null;
    if (!card) return null;
    const facts: EntityFact[] = [], missing: EntitySnapshot['missing'] = [];
    const add = (id: string, value: number | null | undefined, reason: EntityMissingReason = 'unavailable') => {
      const definition = ENTITY_FACT_DEFINITIONS[id];
      if (!definition) throw new Error('unknown_entity_fact');
      if (card!.window.empty && definition.period !== 'snapshot') { missing.push({ id, reason: 'empty-period' }); return; }
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || !definition.signed && value < 0) { missing.push({ id, reason }); return; }
      facts.push({ id, value, unit: definition.unit, period: definition.period });
    };
    for (const id of ['current', 'inflow', 'outflow', 'net'] as const) add('cash.' + id, card.cash[id]);
    const firm = card.kind !== 'house' && card.kind !== 'household';
    if (firm) {
      for (const key of ['employeeWorkers', 'ownerWorkers', 'employed'] as const) add('workforce.' + key, card.workforce[key]);
      const building = city.buildings.find(item => item.id === card!.identity.buildingId);
      add('workforce.capacity', building ? firmCapacity(building, city.firms.find(f => f.building === building.id)) : null);
      for (const key of ['goods', 'crops', 'cropCostSatang'] as const) add('stocks.' + key, card.stocks[key]);
      for (const key of ['cropHarvested', 'cropProcessed', 'goodsProduced'] as const) add('today.' + key, card.today[key]);
    } else {
      for (const key of ['members', 'workforce', 'employed', 'employeeWorkers', 'ownerWorkers', 'dependents'] as const) add('workforce.' + key, card.workforce[key]);
      const available = card.workforce.workforce, employed = card.workforce.employed;
      add('workforce.unemployed', available === null || employed === null ? null : available - employed);
      for (const key of ['cropConsumed', 'goodsConsumed'] as const) add('today.' + key, card.today[key]);
      if (card.kind === 'house') for (const key of ['households', 'persons', 'householdCapacity', 'personCapacity'] as const) add('occupancy.' + key, card.occupancy[key]);
    }
    for (const key of ['goodsIn', 'goodsOut', 'cropsIn', 'cropsOut'] as const) add('quantities.' + key, card.quantities[key]);
    if (card.kind !== 'house') for (const key of ['goodsBuy', 'goodsSell', 'cropsBuy', 'cropsSell'] as const) {
      const price = card.prices[key];
      add('price.' + key, price.unitSatang, price.status === 'observed' || price.status === 'missing' ? 'unavailable' : price.status);
    }
    const building = city.buildings.find(item => item.id === card!.identity.buildingId);
    add('access.connected', building ? Number(access(city, building.cell)) : null);
    const { buildingId, firmId, householdId, cell } = card.identity;
    const id = card.kind === 'household' ? householdId : buildingId;
    if (id === null) return null;
    facts.sort((a, b) => a.id.localeCompare(b.id)); missing.sort((a, b) => a.id.localeCompare(b.id));
    return makeEntitySnapshot({ schemaVersion: 1, entity: { kind: card.kind, id, buildingId, firmId, householdId, cell }, tick: city.tick, window: { ...card.window }, facts, missing });
  } catch { return null; }
}
