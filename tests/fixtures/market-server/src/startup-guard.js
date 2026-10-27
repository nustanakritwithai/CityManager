// Run before the HTTP listener or background writers. A missing/corrupt marker
// after tables exist is not evidence that an older writer is safe.
export async function checkStartupGuard(pool, tradeRejectionsEnabled) {
  const {rows:[tables]} = await pool.query(`SELECT
    to_regclass('market_runtime_guard') IS NOT NULL AS marker,
    to_regclass('trade_rejections') IS NOT NULL AS rejections,
    to_regclass('trade_cancel_results') IS NOT NULL AS cancellations`);
  if (!tables.marker) {
    if (tradeRejectionsEnabled || tables.rejections || tables.cancellations)
      throw new Error('market startup guard is missing');
    return;
  }
  const {rows} = await pool.query('SELECT trade_rejections_protocol FROM market_runtime_guard WHERE singleton=true');
  if (rows.length !== 1 || rows[0].trade_rejections_protocol !== 1 || !tables.rejections || !tables.cancellations)
    throw new Error('market startup guard is incompatible');
  if (!tradeRejectionsEnabled) throw new Error('market startup requires guarded trade rejections');
}
