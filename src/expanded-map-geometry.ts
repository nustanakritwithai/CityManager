import { expandedCellAt, expandedCellCoordinate, LEGACY_MAP_CELLS } from './expanded-map-grid.ts';
/** Logical coordinates keep every legacy cell fixed even though new IDs are appended. */
export function cellWorldPosition(cell:number,unit=2) { const p=expandedCellCoordinate(cell);return {x:(p.x-11.5)*unit,z:(p.z-11.5)*unit}; }
export function worldPositionCell(x:number,z:number,expanded:boolean,unit=2):number|null {
 const cell=expandedCellAt(Math.floor(x/unit+12),Math.floor(z/unit+12));return cell!==null&&(expanded||cell<LEGACY_MAP_CELLS)?cell:null;
}
export function mapLayout(size:number,expanded:boolean) {const rows=expanded?28:24,cell=size/rows;return {cell,xOffset:(size-24*cell)/2,yOffset:expanded?4*cell:0};}
export function cellMapPosition(id:number,size:number,expanded:boolean) {const {cell,xOffset,yOffset}=mapLayout(size,expanded),p=expandedCellCoordinate(id);return {x:xOffset+p.x*cell,y:yOffset+p.z*cell};}
export function mapPositionCell(x:number,y:number,size:number,expanded:boolean):number|null {
 if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(size)||size<=0||x<0||y<0||x>=size||y>=size)return null;
 const {cell,xOffset,yOffset}=mapLayout(size,expanded),id=expandedCellAt(Math.floor((x-xOffset)/cell),Math.floor((y-yOffset)/cell));return id!==null&&(expanded||id<LEGACY_MAP_CELLS)?id:null;
}

/** Human-facing labels keep old row numbers and explicitly name appended northern rows. */
export function formatCellCoordinate(id:number):string {const p=expandedCellCoordinate(id);return `${p.x+1},${p.z<0?`เหนือ ${-p.z}`:p.z+1}`;}
