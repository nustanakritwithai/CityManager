/** Physical road junctions are distinct from vehicle direction. Legacy maps have all adjacent links. */
const SIZE = 24, CELLS = SIZE * SIZE;
export type RoadTopology = { version: 1; blocked: number[]; oneWay: Record<string, number> };
export type RoadMap = { cells: { road: boolean }[]; roadTopology?: RoadTopology };
export const roadNeighbors = (i: number) => [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i >= SIZE ? i - SIZE : -1, i < CELLS - SIZE ? i + SIZE : -1].filter(n => n >= 0);
export const edgeKey = (a: number, b: number) => Math.min(a, b) * CELLS + Math.max(a, b);
export function roadLinked(c: RoadMap, a: number, b: number): boolean {
  return !!c.cells[a]?.road && !!c.cells[b]?.road && roadNeighbors(a).includes(b) && !c.roadTopology?.blocked.includes(edgeKey(a,b));
}
/** A junction permits turns, but never driving opposite the arrow of either road segment. */
export function roadDriveAllowed(c: RoadMap, a: number, b: number): boolean {
  if (!roadLinked(c,a,b)) return false;
  const delta=b-a;
  return c.roadTopology?.oneWay[a] !== -delta && c.roadTopology?.oneWay[b] !== -delta;
}
export function validateRoadTopology(c: RoadMap, value: unknown): asserts value is RoadTopology {
  const t=value as RoadTopology;
  if (!t || typeof t!=='object' || Array.isArray(t) || Object.keys(t).sort().join(',')!=='blocked,oneWay,version' || t.version!==1 || !Array.isArray(t.blocked) || t.blocked.length>SIZE*(SIZE-1)*2 || !t.oneWay || typeof t.oneWay!=='object' || Array.isArray(t.oneWay)) throw Error('Invalid road topology');
  let previous=-1;
  for(const key of t.blocked) {
    const a=Math.floor(key/CELLS),b=key%CELLS;
    if(!Number.isSafeInteger(key)||key<=previous||a>=b||!c.cells[a]?.road||!c.cells[b]?.road||!roadNeighbors(a).includes(b)) throw Error('Invalid road junction');
    previous=key;
  }
  if(Object.keys(t.oneWay).length>CELLS)throw Error('Too many road directions');
  for(const [key,dir] of Object.entries(t.oneWay)) if(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=CELLS||!c.cells[Number(key)]?.road||![1,-1,SIZE,-SIZE].includes(dir))throw Error('Invalid one-way road');
}
const copyTopology=(c:RoadMap):RoadTopology=>({version:1,blocked:[...(c.roadTopology?.blocked??[])],oneWay:{...c.roadTopology?.oneWay}});
export function setRoadJunction(c:RoadMap,a:number,b:number,connected:boolean):boolean {
  if(!c.cells[a]?.road||!c.cells[b]?.road||!roadNeighbors(a).includes(b))return false;
  const t=copyTopology(c),set=new Set(t.blocked),key=edgeKey(a,b);if(connected)set.delete(key);else set.add(key);
  t.blocked=[...set].sort((a,b)=>a-b);c.roadTopology=t;return true;
}
/** Explicit selected path only. Old junctions elsewhere and endpoint connections are preserved. */
export function configureRoadPath(c:RoadMap,path:number[],newCells:ReadonlySet<number>,oneWay:boolean):void {
  const t=copyTopology(c),blocked=new Set(t.blocked),edges=new Set(path.slice(1).map((b,i)=>edgeKey(path[i],b)));
  for(let at=0;at<path.length;at++) {
    const i=path[at];
    for(const n of roadNeighbors(i)) if(c.cells[n].road) {
      const key=edgeKey(i,n);
      if(edges.has(key))blocked.delete(key);
      else if(newCells.has(i)||(at>0&&at<path.length-1))blocked.add(key);
    }
    if(oneWay) { const delta=at<path.length-1?path[at+1]-i:i-path[at-1];t.oneWay[i]=delta; }
    else delete t.oneWay[i];
  }
  t.blocked=[...blocked].sort((a,b)=>a-b);validateRoadTopology(c,t);c.roadTopology=t;
}
export function forgetRoadTopology(c:RoadMap,i:number):void {
  if(!c.roadTopology)return;const t=copyTopology(c);t.blocked=t.blocked.filter(k=>Math.floor(k/CELLS)!==i&&k%CELLS!==i);delete t.oneWay[i];c.roadTopology=t;
}
export const roadTopologyKey=(c:RoadMap)=>c.roadTopology?JSON.stringify(c.roadTopology):'';

export function clearRoadDirections(c:RoadMap,path:readonly number[]):void {
 if(!c.roadTopology)return;const t=copyTopology(c);for(const i of path)delete t.oneWay[i];c.roadTopology=t;
}
