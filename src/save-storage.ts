import {decodeSaveCopy} from './save-copy-codec.ts';
export const SAVE_CONFLICT_LATEST_KEY='citymanager.backup.save-conflict.latest';
export const AUTOSAVE_CHECKPOINT_KEY='citymanager.checkpoint.latest';
export const PRE_AUTOSAVE_BACKUP='citymanager.backup.before-autosave';
export const SAVE_CONFLICT_INDEX_KEY='citymanager.backup.save-conflict.index';
export function saveConflictBackupKeys(storage?:Pick<Storage,'getItem'>){
 const base=Array.from({length:8},(_,i)=>`citymanager.backup.save-conflict.${i}`);
 const raw=storage?.getItem(SAVE_CONFLICT_INDEX_KEY);if(!raw)return base;
 const extra:unknown=JSON.parse(raw);
 if(!Array.isArray(extra)||!extra.every(k=>typeof k==='string'&&/^citymanager\.backup\.save-conflict\.[0-9]+$/.test(k)))throw Error('Recovery index requires repair; original saves preserved');
 return [...new Set([...base,...extra])];
}
export const BUSINESS_CAPACITY_BACKUP_KEY = 'citymanager.backup.before-business-capacity';
export const businessCapacityBackupKeys = () => Array.from({ length: 8 }, (_, i) => i ? `${BUSINESS_CAPACITY_BACKUP_KEY}.${i}` : BUSINESS_CAPACITY_BACKUP_KEY);
export const EDUCATION_BACKUP_KEY = 'citymanager.backup.before-education';
export const TAXI_BACKUP_KEY = 'citymanager.backup.before-taxi';
export const taxiBackupKeys = () => Array.from({ length: 8 }, (_, i) => i ? `${TAXI_BACKUP_KEY}.${i}` : TAXI_BACKUP_KEY);
export const educationBackupKeys = () => Array.from({ length: 8 }, (_, i) => i ? `${EDUCATION_BACKUP_KEY}.${i}` : EDUCATION_BACKUP_KEY);
export const POPULATION_BACKUP_KEY = 'citymanager.backup.before-population-capacity';
export const populationBackupKeys = () => Array.from({length:8}, (_,i) => i ? `${POPULATION_BACKUP_KEY}.${i}` : POPULATION_BACKUP_KEY);
import { validateRoadTopology } from './road-topology.ts';
export const roadTopologyBackupKeys = () => Array.from({length:8},(_,i)=>i?`${ROAD_TOPOLOGY_BACKUP_KEY}.${i}`:ROAD_TOPOLOGY_BACKUP_KEY);
export const ROAD_TOPOLOGY_BACKUP_KEY = 'citymanager.backup.before-road-topology';
/** Loading never writes; original v1-v6 bytes are independent of the v7 slot. */
export const SAVE_KEY = 'citymanager.save.v7';
export const GROWTH_SAVE_KEY = 'citymanager.save.v6';
export const COMMERCIAL_SAVE_KEY = 'citymanager.save.v5';
export const AGRICULTURE_SAVE_KEY = 'citymanager.save.v4';
export const WORKER_SAVE_KEY = 'citymanager.save.v3';
export const HOUSEHOLD_SAVE_KEY = 'citymanager.save.v2';
export const LEGACY_SAVE_KEY = 'citymanager.save.v1';
export const LEGACY_BACKUP_KEY = 'citymanager.backup.v1';
export const HOUSEHOLD_BACKUP_KEY = 'citymanager.backup.v2';
export const WORKER_BACKUP_KEY = 'citymanager.backup.v3';
export const AGRICULTURE_BACKUP_KEY = 'citymanager.backup.v4';
export const COMMERCIAL_BACKUP_KEY = 'citymanager.backup.v5';
export const GROWTH_BACKUP_KEY = 'citymanager.backup.v6';
export const LATEST_BACKUP_KEY = 'citymanager.backup.latest';
/** The 1.x (v7 / chain-2) bytes in the main slot, copied once before the first v8 write replaces them. */
export const CHAIN2_BACKUP_KEY = 'citymanager.backup.chain-2';
/** The 2.0 (v8 / chain-3) bytes in the main slot, copied once before the first v9 write replaces them. */
export const CHAIN3_BACKUP_KEY = 'citymanager.backup.chain-3';
export const FOOD_BACKUP_KEY = 'citymanager.backup.before-food-demand';
export const FACTORY_CHOICE_BACKUP_KEY = 'citymanager.backup.before-factory-choice';
export const FARM_CHOICE_BACKUP_KEY = 'citymanager.backup.before-farm-choice';
export const PARKS_BACKUP_KEY = 'citymanager.backup.before-parks';
export const FACTORY_PROGRESS_BACKUP_KEY = 'citymanager.backup.before-factory-progression';
const factoryProgressBackupKeys = () => Array.from({ length: BACKUP_SLOTS }, (_, i) => i ? `${FACTORY_PROGRESS_BACKUP_KEY}.${i}` : FACTORY_PROGRESS_BACKUP_KEY);
export const PARK_WORKFORCE_BACKUP_KEY = 'citymanager.backup.before-park-workforce';
export const HOUSING_BACKUP_KEY = 'citymanager.backup.before-housing-density';
const housingBackupKeys = () => Array.from({ length: BACKUP_SLOTS }, (_, i) => i ? `${HOUSING_BACKUP_KEY}.${i}` : HOUSING_BACKUP_KEY);
export const RETAIL_BACKUP_KEY = 'citymanager.backup.before-retail-levels';
const retailBackupKeys = () => Array.from({ length: BACKUP_SLOTS }, (_, i) => i ? `${RETAIL_BACKUP_KEY}.${i}` : RETAIL_BACKUP_KEY);
export const FARM_LEVEL_BACKUP_KEY = 'citymanager.backup.before-farm-levels';
const farmLevelBackupKeys = () => Array.from({ length: BACKUP_SLOTS }, (_, i) => i ? `${FARM_LEVEL_BACKUP_KEY}.${i}` : FARM_LEVEL_BACKUP_KEY);
const workforceBackupKeys = () => Array.from({ length: BACKUP_SLOTS }, (_, i) => i ? `${PARK_WORKFORCE_BACKUP_KEY}.${i}` : PARK_WORKFORCE_BACKUP_KEY);
const BACKUP_SLOTS = 8;
const parksBackupKeys = () => Array.from({ length: BACKUP_SLOTS }, (_, i) => i ? `${PARKS_BACKUP_KEY}.${i}` : PARKS_BACKUP_KEY);
const factoryBackupKeys = () => Array.from({ length: BACKUP_SLOTS }, (_, i) => i ? `${FACTORY_CHOICE_BACKUP_KEY}.${i}` : FACTORY_CHOICE_BACKUP_KEY);
const foodBackupKeys = () => Array.from({ length: BACKUP_SLOTS }, (_, i) => i ? `${FOOD_BACKUP_KEY}.${i}` : FOOD_BACKUP_KEY);
type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'getItem' | 'setItem'>;
export type SaveSource = 'current' | 'growth' | 'commercial' | 'agriculture' | 'worker' | 'household' | 'legacy' | 'backup' | 'checkpoint' | 'conflict';
const backupKey = (version: 1 | 2 | 3 | 4 | 5 | 6, i: number) => {
  const base = version === 1 ? LEGACY_BACKUP_KEY : version === 2 ? HOUSEHOLD_BACKUP_KEY : version === 3 ? WORKER_BACKUP_KEY : version === 4 ? AGRICULTURE_BACKUP_KEY : version === 5 ? COMMERCIAL_BACKUP_KEY : GROWTH_BACKUP_KEY;
  return i === 0 ? base : `${base}.${i}`;
};
const backupKeys = (version: 1 | 2 | 3 | 4 | 5 | 6) => Array.from({ length: BACKUP_SLOTS }, (_, i) => backupKey(version, BACKUP_SLOTS - i - 1));
export function readStoredCity(storage: Reader, source: SaveSource = 'current'): { raw: string; key: string } | null {
  let keys: string[];
  if (source === 'current') keys = [SAVE_KEY, GROWTH_SAVE_KEY, COMMERCIAL_SAVE_KEY, AGRICULTURE_SAVE_KEY, WORKER_SAVE_KEY, HOUSEHOLD_SAVE_KEY, LEGACY_SAVE_KEY];
  else if (source === 'checkpoint') keys=[AUTOSAVE_CHECKPOINT_KEY];
  else if (source === 'conflict') {keys=saveConflictBackupKeys(storage);const latest=storage.getItem(SAVE_CONFLICT_LATEST_KEY);if(latest&&keys.includes(latest))keys=[latest,...keys.filter(key=>key!==latest)];}
  else if (source === 'growth') keys = [GROWTH_SAVE_KEY];
  else if (source === 'commercial') keys = [COMMERCIAL_SAVE_KEY];
  else if (source === 'agriculture') keys = [AGRICULTURE_SAVE_KEY];
  else if (source === 'worker') keys = [WORKER_SAVE_KEY];
  else if (source === 'household') keys = [HOUSEHOLD_SAVE_KEY];
  else if (source === 'legacy') keys = [LEGACY_SAVE_KEY];
  else {
    keys = [PRE_AUTOSAVE_BACKUP,...saveConflictBackupKeys(storage),...businessCapacityBackupKeys(), ...educationBackupKeys(), ...taxiBackupKeys(), ...populationBackupKeys(), ...roadTopologyBackupKeys(), ...backupKeys(6), ...backupKeys(5), ...backupKeys(4), ...backupKeys(3), ...backupKeys(2), ...backupKeys(1), CHAIN2_BACKUP_KEY, CHAIN3_BACKUP_KEY, FARM_CHOICE_BACKUP_KEY, ...foodBackupKeys(), ...factoryBackupKeys(), ...parksBackupKeys(), ...workforceBackupKeys(), ...housingBackupKeys(), ...factoryProgressBackupKeys(), ...retailBackupKeys(), ...farmLevelBackupKeys()];
    const latest = storage.getItem(LATEST_BACKUP_KEY);
    // Old installations have no pointer. Only accept our bounded backup keys;
    // never let a corrupt metadata value redirect recovery to another slot.
    if (latest !== null && keys.includes(latest)) keys = [latest, ...keys.filter(key => key !== latest)];
  }
  for (const key of keys) { const raw = storage.getItem(key); if (raw !== null) return { raw:decodeSaveCopy(raw)!, key }; }
  return null;
}
export function saveStoredCity(storage: Writer, raw: string, importedLegacy: string | null): { backup: string | null } {
  const parsed = JSON.parse(raw);
  const market10 = parsed?.version === 10 && parsed?.rulesVersion === 'chain-5' && parsed?.market?.version === 10 && parsed?.market?.rulesVersion === 'chain-5' && typeof parsed.market.cityId === 'string' && typeof parsed.market.seq === 'string' && Array.isArray(parsed.market.operations) && Array.isArray(parsed.market.escrow) && parsed.market.receipts && typeof parsed.market.receipts === 'object';
  const farm11 = parsed?.version === 11 && parsed?.rulesVersion === 'chain-6' && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  const factory12 = parsed?.version === 12 && parsed?.rulesVersion === 'chain-7' && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  const food13 = parsed?.version === 13 && parsed?.rulesVersion === 'chain-8' && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  const parks14 = parsed?.version === 14 && parsed?.rulesVersion === 'chain-9' && Array.isArray(parsed.parks) && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  const workforce15 = parsed?.version === 15 && parsed?.rulesVersion === 'chain-10' && Array.isArray(parsed.parks) && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  const housing16 = parsed?.version === 16 && parsed?.rulesVersion === 'chain-11' && Array.isArray(parsed.parks) && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  const factory17 = parsed?.version === 17 && parsed?.rulesVersion === 'chain-12' && Array.isArray(parsed.parks) && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  const retail18 = parsed?.version === 18 && parsed?.rulesVersion === 'chain-13' && Array.isArray(parsed.parks) && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  const business23 = parsed?.version === 23 && parsed?.rulesVersion === 'chain-18' && parsed?.businessCapacityVersion === 1;
  const education22 = parsed?.version === 22 && parsed?.rulesVersion === 'chain-17' && parsed?.education?.version === 1 && parsed?.education?.rules === 'education-1';
  const population21 = parsed?.version === 21 && parsed?.rulesVersion === 'chain-16' && parsed?.populationCapacityVersion === 1;
  const road20 = parsed?.version === 20 && parsed?.rulesVersion === 'chain-15' && parsed?.roadTopology?.version === 1 || population21 && parsed.roadTopology?.version === 1;
  const farm19 = ((parsed?.version === 19 && parsed?.rulesVersion === 'chain-14') || road20 || population21 || education22 || business23) && Array.isArray(parsed.parks) && (!parsed.market || (parsed.market.version === 10 && parsed.market.rulesVersion === 'chain-5'));
  if (parsed?.version !== 9 && !market10 && !farm11 && !factory12 && !food13 && !parks14 && !workforce15 && !housing16 && !factory17 && !retail18 && !farm19 && !education22) throw new Error('Expected a supported CityManager snapshot.');
  if (road20 || population21 && parsed.roadTopology !== undefined) validateRoadTopology(parsed, parsed.roadTopology);
  let backup: string | null = null;
  if (importedLegacy !== null) {
    const version: unknown = JSON.parse(importedLegacy)?.version;
    if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6) throw new Error('Expected the original version 1, 2, 3, 4, 5 or 6 snapshot.');
    let available: string | null = null;
    for (let i = 0; i < BACKUP_SLOTS; i++) {
      const key = backupKey(version, i), previous = storage.getItem(key);
      if (previous === importedLegacy) { backup = key; break; }
      if (previous === null && available === null) available = key;
    }
    if (backup === null && available !== null) { storage.setItem(available, importedLegacy); backup = available; }
    if (backup === null) throw new Error('Legacy backup slots are full; the current save was preserved.');
    // A small pointer makes "latest backup" truthful across all old versions.
    // Failure here still aborts before changing the primary save.
    if (storage.getItem(LATEST_BACKUP_KEY) !== backup) storage.setItem(LATEST_BACKUP_KEY, backup);
  }
  // The slot keeps its v7 name; an older chain's save there is kept once, untouched, before v9 replaces it.
  const current = storage.getItem(SAVE_KEY);
  if (current !== null) {
    let version: unknown; try { version = JSON.parse(current)?.version; } catch { version = undefined; }
    // First save that carries taxi data: keep the last taxi-free save once, untouched.
    let currentTaxi = false; try { currentTaxi = JSON.parse(current)?.taxi !== undefined; } catch { currentTaxi = false; }
    if (parsed?.taxi !== undefined && !currentTaxi) { const keys = taxiBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current); if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Taxi migration backups full; original save preserved'); storage.setItem(slot, current); } storage.setItem(LATEST_BACKUP_KEY, slot); }
    if (business23 && typeof version === 'number' && version >= 9 && version <= 22) {
      const keys = businessCapacityBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Business capacity migration backups full; original save preserved'); storage.setItem(slot, current); }
      storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if (education22 && typeof version === 'number' && version >= 9 && version <= 21) { const keys = educationBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current); if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Education migration backups full; original save preserved'); storage.setItem(slot, current); } storage.setItem(LATEST_BACKUP_KEY, slot); }
    if (population21 && typeof version === 'number' && version >= 9 && version <= 20) { const keys=populationBackupKeys(); let slot=keys.find(k=>storage.getItem(k)===current); if(!slot){slot=keys.find(k=>storage.getItem(k)===null);if(!slot)throw Error('Population migration backups full; original save preserved');storage.setItem(slot,current);}storage.setItem(LATEST_BACKUP_KEY,slot); }
    let currentTopology = false; try { currentTopology = JSON.parse(current)?.roadTopology?.version === 1; } catch { currentTopology = false; }
    if (!population21 && parsed.roadTopology?.version === 1 && !currentTopology && (version === 19 || version === 22)) { const keys=roadTopologyBackupKeys();let slot=keys.find(k=>storage.getItem(k)===current);if(!slot){slot=keys.find(k=>storage.getItem(k)===null);if(!slot)throw Error('Road migration backups full; original save preserved');storage.setItem(slot,current);}if(!education22)storage.setItem(LATEST_BACKUP_KEY,slot); }
    if (farm19 && (version === 15 || version === 16 || version === 17 || version === 18)) {
      const keys = farmLevelBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Farm level backup slots are full; the current save was preserved.'); storage.setItem(slot, current); }
      if (storage.getItem(LATEST_BACKUP_KEY) !== slot) storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if (retail18 && (version === 15 || version === 16 || version === 17)) {
      const keys = retailBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Retail backup slots are full; the current save was preserved.'); storage.setItem(slot, current); }
      if (storage.getItem(LATEST_BACKUP_KEY) !== slot) storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if ((food13 || parks14 || workforce15 || housing16 || factory17 || retail18 || farm19) && version === 12) {
      const keys = foodBackupKeys();
      let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Food demand backup slots are full; the current save was preserved.'); storage.setItem(slot, current); }
      if (storage.getItem(LATEST_BACKUP_KEY) !== slot) storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if ((factory12 || food13 || parks14 || workforce15 || housing16 || factory17 || retail18 || farm19) && version === 11) {
      const keys = factoryBackupKeys();
      let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Factory choice backup slots are full; the current save was preserved.'); storage.setItem(slot, current); }
      if (storage.getItem(LATEST_BACKUP_KEY) !== slot) storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if ((farm11 || factory12 || food13 || parks14 || workforce15 || housing16 || factory17 || retail18 || farm19) && (version === 9 || version === 10) && storage.getItem(FARM_CHOICE_BACKUP_KEY) === null) { storage.setItem(FARM_CHOICE_BACKUP_KEY, current); storage.setItem(LATEST_BACKUP_KEY, FARM_CHOICE_BACKUP_KEY); }
    if ((parks14 || workforce15 || housing16 || factory17 || retail18 || farm19) && version === 13) {
      const keys = parksBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Park backup slots are full; the current save was preserved.'); storage.setItem(slot, current); }
      if (storage.getItem(LATEST_BACKUP_KEY) !== slot) storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if ((workforce15 || housing16 || factory17 || retail18 || farm19) && version === 14) {
      const keys = workforceBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Park workforce backup slots are full; the current save was preserved.'); storage.setItem(slot, current); }
      if (storage.getItem(LATEST_BACKUP_KEY) !== slot) storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if (housing16 && version === 15) {
      const keys = housingBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Housing backup slots are full; the current save was preserved.'); storage.setItem(slot, current); }
      if (storage.getItem(LATEST_BACKUP_KEY) !== slot) storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if (factory17 && (version === 15 || version === 16)) {
      const keys = factoryProgressBackupKeys(); let slot = keys.find(key => storage.getItem(key) === current);
      if (!slot) { slot = keys.find(key => storage.getItem(key) === null); if (!slot) throw new Error('Factory progression backup slots are full; the current save was preserved.'); storage.setItem(slot, current); }
      if (storage.getItem(LATEST_BACKUP_KEY) !== slot) storage.setItem(LATEST_BACKUP_KEY, slot);
    }
    if (version === 7 && storage.getItem(CHAIN2_BACKUP_KEY) === null) storage.setItem(CHAIN2_BACKUP_KEY, current);
    if (version === 8 && storage.getItem(CHAIN3_BACKUP_KEY) === null) storage.setItem(CHAIN3_BACKUP_KEY, current);
  }
  // Native setItem is atomic: failed primary writes retain the previous bytes,
  // while a successful preceding backup remains recoverable.
  storage.setItem(SAVE_KEY, raw);
  return { backup };
}
