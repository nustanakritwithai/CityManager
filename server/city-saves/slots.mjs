import { createServerCityService } from './service.mjs';

const legacyTables = /\bcity_server_(heads|snapshots|requests|archives|archive_sources)\b/g;
const slots = [1, 2, 3];

export function allowsCitySlotRequest(method, path) {
  const base = '/v1/city-save/slots';
  if (method === 'GET' && path === base) return true;
  if (!path.startsWith(base + '/')) return false;
  const suffix = path.slice(base.length);
  if (method === 'GET') return /^\/[123](?:\/archives(?:\/[a-f0-9]{64})?)?$/.test(suffix);
  return method === 'POST' && /^\/[123](?:\/archives)?$/.test(suffix);
}

function tablePrefix(slot) {
  return slot === 1 ? 'city_server_' : `city_slot_${slot}_`;
}

// The store retains its existing transaction, owner lock, account and market
// tables. Only the five save relations move into a separate namespace per slot.
function scopeQueries(queryable, slot) {
  return {
    query(sql, args) {
      return queryable.query(sql.replace(legacyTables, `${tablePrefix(slot)}$1`), args);
    },
  };
}

async function slotSummary(pool, owner, slot) {
  const prefix = tablePrefix(slot);
  const { rows: [head] } = await pool.query(`
    SELECT h.city_id, h.deleted, s.metadata
      FROM ${prefix}heads h
      LEFT JOIN ${prefix}snapshots s ON s.account_id=h.account_id AND s.revision=h.revision
      WHERE h.account_id=$1
    UNION ALL
    (SELECT city_id, false, metadata FROM ${prefix}snapshots
      WHERE account_id=$1 AND NOT EXISTS (SELECT 1 FROM ${prefix}heads WHERE account_id=$1)
      ORDER BY revision DESC LIMIT 1)
  `, [owner]);
  if (!head || head.deleted) return { slot, state: 'empty' };
  if (!head.metadata) throw Error('active-head-snapshot-missing');
  return { slot, state: 'occupied', cityId: head.city_id, metadata: head.metadata };
}

// Mount inside the existing Guest-authenticated save boundary, before the
// default JSON parser. The same router owns the legacy and numbered paths.
export function createCitySlotRouter({ Router, json, guest, csrf, pool, tx, createStore, createSaveRouter }) {
  const router = Router();
  router.get('/', guest, async (req, res, next) => {
    try {
      const owner = req.account.id;
      const summaries = await Promise.all(slots.map(slot => slotSummary(pool, owner, slot)));
      res.set('Cache-Control', 'no-store').json({ slots: summaries });
    } catch (error) {
      next(error);
    }
  });
  for (const slot of slots) {
    const store = slot === 1 ? createStore({pool, tx}) : createStore({
      pool: scopeQueries(pool, slot),
      tx: work => tx(client => work(scopeQueries(client, slot))),
    });
    const service = createServerCityService(store);
    router.use(`/${slot}`, createSaveRouter({ Router, json, guest, csrf, service }));
  }
  return router;
}
