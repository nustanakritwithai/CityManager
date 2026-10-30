// Node-only test adapter; the browser uses game-worker-entry.ts.
import {parentPort} from 'node:worker_threads';
import {createTrafficGameWorkerEngine} from '../src/traffic/game-worker-engine.ts';
const engine=createTrafficGameWorkerEngine();parentPort.on('message',m=>parentPort.postMessage(engine(m)));
