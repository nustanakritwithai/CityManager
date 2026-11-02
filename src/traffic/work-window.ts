import {WORK_TRIP_START_MINUTE,WORK_TRIP_END_MINUTE} from './game.ts';

/** Latest work window intersected by a forward observed game-time interval.
 * Returns a single day even when a frame skips many days: no catch-up burst. */
export function crossedWorkWindowDay(from:number,to:number):number|null {
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from)throw Error('Invalid work clock interval');
 if(to===from)return null;
 const day=Math.floor((to-WORK_TRIP_START_MINUTE)/1440);
 if(day<0)return null;
 return day*1440+WORK_TRIP_END_MINUTE>from?day:null;
}
