import {createTrafficGameWorkerEngine} from './game-worker-engine.ts';
import type {TrafficGameInput} from './game.ts';
import type {GameWorkerInput} from './game-worker-client.ts';
const engine=createTrafficGameWorkerEngine();
self.addEventListener('message',(event:MessageEvent<GameWorkerInput<TrafficGameInput>>)=>self.postMessage(engine(event.data)));
