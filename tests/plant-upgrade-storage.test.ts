import test from 'node:test';
import assert from 'node:assert/strict';
import { access, buildPlant, createCity, serialize, upgradePlant } from '../src/sim.ts';
import { SAVE_KEY, PLANT_UPGRADE_BACKUP_KEY, plantUpgradeBackupKeys, saveStoredCity, readStoredCity } from '../src/save-storage.ts';
import { decodeSaveCopy } from '../src/save-copy-codec.ts';
const fixture = () => {
 const c=createCity(123),cell=c.cells.findIndex((x,i)=>!x.road&&x.building===null&&access(c,i));buildPlant(c,cell,'power');
 const original=serialize(c);upgradePlant(c,c.plants[0].id,1);return {c,original,upgraded:serialize(c)};
};
const memory=()=>{const m=new Map<string,string>();return {m,getItem:(key:string)=>m.get(key)??null,setItem:(key:string,value:string)=>{m.set(key,value);}};};
test('first upgraded legacy-slot save preserves original bytes once and recovery can read them',()=>{
 const {c,original,upgraded}=fixture(),st=memory();st.m.set(SAVE_KEY,original);
 saveStoredCity(st,upgraded,null);assert.equal(decodeSaveCopy(st.m.get(PLANT_UPGRADE_BACKUP_KEY)!),original);
 assert.equal(readStoredCity(st,'backup')!.raw,original);assert.equal(st.m.get(SAVE_KEY),upgraded);
 upgradePlant(c,c.plants[0].id,2);saveStoredCity(st,serialize(c),null);
 assert.equal(st.m.get(`${PLANT_UPGRADE_BACKUP_KEY}.1`),undefined);
 assert.equal(decodeSaveCopy(st.m.get(PLANT_UPGRADE_BACKUP_KEY)!),original);
});
test('full or unwritable upgrade backups preserve the primary slot',()=>{
 const {original,upgraded}=fixture(),st=memory();st.m.set(SAVE_KEY,original);
 for(const key of plantUpgradeBackupKeys())st.m.set(key,'occupied');
 assert.throws(()=>saveStoredCity(st,upgraded,null),/backups full/);assert.equal(st.m.get(SAVE_KEY),original);
 const fail={getItem:(key:string)=>key===SAVE_KEY?original:null,setItem:()=>{throw Error('quota');}};
 assert.throws(()=>saveStoredCity(fail,upgraded,null),/quota/);
});
