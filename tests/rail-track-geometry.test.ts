import test from 'node:test';import assert from 'node:assert/strict';
import {trackMeshData} from '../src/rail/track-geometry.ts';
test('bidirectional rail segment renders once in three finite shared-finish meshes',()=>{
 const graph={revision:1,links:[{from:25,to:26,minutes:1},{from:26,to:25,minutes:1}]},before=JSON.stringify(graph),rows=trackMeshData(graph);
 assert.equal(rows.length,3);assert.equal(rows.reduce((n,r)=>n+r.boxes,0),7);assert.equal(JSON.stringify(graph),before);
 for(const r of rows){assert.equal(r.positions.length,r.normals.length);assert.ok(r.positions.every(Number.isFinite));assert.ok(r.indices.every(i=>i>=0&&i<r.positions.length/3));assert.equal(r.indices.length,r.boxes*36);}
 assert.deepEqual(trackMeshData({revision:2,links:[]}),[]);
});
test('whole allowed grid remains three batched track meshes without dropping segments',()=>{
 const links=[];for(let c=0;c<576;c++)for(const to of [c%24<23?c+1:-1,c<552?c+24:-1])if(to>=0)links.push({from:c,to,minutes:1},{from:to,to:c,minutes:1});
 const rows=trackMeshData({revision:0,links});assert.equal(links.length,2208);assert.equal(rows.length,3);assert.equal(rows.reduce((n,r)=>n+r.boxes,0),1104*7);assert.equal(rows.reduce((n,r)=>n+r.positions.length/3,0),1104*7*24);
});
