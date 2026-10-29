import type { City, Firm } from './sim.ts';

/** One quarter of each month's after-tax profit stays in the business for development. */
export const OWNER_DEVELOPMENT_SHARE_DENOMINATOR = 4;
const positive = (n: bigint) => n > 0n ? n : 0n;
export const developmentShare = (net: bigint) => {
  const denominator = BigInt(OWNER_DEVELOPMENT_SHARE_DENOMINATOR);
  return (positive(net) + denominator - 1n) / denominator;
};

/**
 * Read-only reconstruction from the complete saved journals. No new save field,
 * balance migration or guessed historical reserve is needed. Crop purchases are
 * inventory, so only the crop journal's released costs enter operating profit.
 */
export function ownerProfitHistory(c: City, f: Firm, currentNet: bigint) {
  type Month = { profit: bigint; tax: bigint; invested: bigint };
  const months = new Map<number, Month>();
  const month = (tick: number) => {
    const key = Math.ceil(tick / 30);
    let row = months.get(key);
    if (!row) { row = { profit: 0n, tax: 0n, invested: 0n }; months.set(key, row); }
    return row;
  };
  for (const e of c.ledger) {
    const outgoing = e.from === f.wallet, incoming = e.to === f.wallet;
    if (!outgoing && !incoming) continue;
    const row = month(e.tick), amount = BigInt(e.amount);
    if (e.reason === 'Local wholesale goods' || e.reason === 'Outside goods import'
      || e.reason === 'Outside market goods export' || /^Household #\d+ purchase$/.test(e.reason)
      || e.reason === 'Monthly wages' || e.reason === 'Monthly firm rent' || e.reason === 'Monthly water and power bill') {
      row.profit += incoming ? amount : -amount;
    }
    if (outgoing && e.to === 'treasury' && e.reason === 'Monthly firm profit tax') row.tax += amount;
    // Opening construction is principal-funded; only actual later development
    // consumes retention. Labels unrelated to these two investments cannot unlock it.
    if (outgoing && e.to === 'construction' && (e.reason === 'Market to shop conversion' || e.reason === 'Profitable firm height investment')) row.invested += amount;
  }
  for (const e of c.cropLedger) {
    if (e.from !== f.wallet) continue;
    if (e.kind === 'trade' || e.kind === 'consumption' || e.kind === 'export') month(e.tick).profit += BigInt(e.cash) - BigInt(e.fromValue);
    else if (e.kind === 'writeoff') month(e.tick).profit -= BigInt(e.fromValue);
  }
  const closedMonth = Math.floor(c.tick / 30);
  let closedProfit = 0n, currentProfit = 0n, taxPaid = 0n, invested = 0n, retained = 0n, currentInvestment = 0n;
  for (const [key, row] of [...months].sort(([a], [b]) => a - b)) {
    invested += row.invested; taxPaid += row.tax;
    if (key <= closedMonth) {
      closedProfit += row.profit;
      // Net within each accounting month. Excess investment has no credit
      // against future months' retention; a loss never releases old retention.
      retained = positive(retained + developmentShare(row.profit - row.tax) - row.invested);
    } else { currentProfit += row.profit; currentInvestment += row.invested; }
  }
  retained = positive(retained + developmentShare(currentNet) - currentInvestment);
  const reconciled = closedProfit === BigInt(f.profit)
    && currentProfit === BigInt(f.monthlyRevenue) - BigInt(f.monthlyExpense)
    && taxPaid === BigInt(f.owner!.taxPaid);
  return { retained, invested, reconciled };
}
