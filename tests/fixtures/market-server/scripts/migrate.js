import { migrate, pool } from '../src/db.js';
try { await migrate(); console.log('migration complete'); } finally { await pool.end(); }
