import type { City, Firm } from './sim.ts';
import type { HistoryOwnerProfit } from './city-history-types.ts';

/** One quarter of each month's after-tax profit stays in the business for development. */
export const OWNER_DEVELOPMENT_SHARE_DENOMINATOR = 4;
const positive = (n: bigint) => n > 0n ? n : 0n;
export const developmentShare = (net: bigint) => {
  const denominator = BigInt(OWNER_DEVELOPMENT_SHARE_DENOMINATOR);
  return (positive(net) + denominator - 1n) / denominator;
};

/**
 * Read-only reconstruction from retained journals and exact closed-month checkpoint.
 * No balance migration or guessed historical reserve is used. Crop purchases are
 * inventory, so only the crop journal's released costs enter operating profit.
 */
function profitMonths(c: City, f: Firm, throughTick = c.tick) {
  type Month = { profit: bigint; tax: bigint; invested: bigint };
  const months = new Map<number, Month>();
  const month = (tick: number) => {
    const key = Math.ceil(tick / 30);
    let row = months.get(key);
    if (!row) { row = { profit: 0n, tax: 0n, invested: 0n }; months.set(key, row); }
    return row;
  };
  for (const e of c.ledger) {
    if (e.tick > throughTick) continue;
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
    if (e.tick > throughTick) continue;
    if (e.from !== f.wallet) continue;
    if (e.kind === 'trade' || e.kind === 'consumption' || e.kind === 'export') month(e.tick).profit += BigInt(e.cash) - BigInt(e.fromValue);
    else if (e.kind === 'writeoff') month(e.tick).profit -= BigInt(e.fromValue);
  }
  return months;
}
/** Closed-month sufficient statistic; no old transaction identities are retained. */
export function captureOwnerProfit(c: City, f: Firm, throughTick: number): HistoryOwnerProfit {
  const old = c.history?.ownerProfit[f.wallet];
  let profit = BigInt(old?.profit ?? 0), tax = BigInt(old?.tax ?? 0), invested = BigInt(old?.invested ?? 0), retained = BigInt(old?.retained ?? 0);
  for (const [, row] of [...profitMonths(c, f, throughTick)].sort(([a], [b]) => a - b)) {
    profit += row.profit; tax += row.tax; invested += row.invested;
    retained = positive(retained + developmentShare(row.profit - row.tax) - row.invested);
  }
  const safe = (v: bigint) => { const n=Number(v); if(!Number.isSafeInteger(n))throw Error('history-total-overflow'); return n; };
  return {profit:safe(profit),tax:safe(tax),invested:safe(invested),retained:safe(retained)};
}
export function ownerProfitHistory(c: City, f: Firm, currentNet: bigint) {
  const months = profitMonths(c,f), old=c.history?.ownerProfit[f.wallet];
  const closedMonth = Math.floor(c.tick / 30);
  let closedProfit = BigInt(old?.profit??0), currentProfit = 0n, taxPaid = BigInt(old?.tax??0), invested = BigInt(old?.invested??0), retained = BigInt(old?.retained??0), currentInvestment = 0n;
  for (const [key, row] of [...months].sort(([a], [b]) => a - b)) {
    invested += row.invested; taxPaid += row.tax;
    if (key <= closedMonth) {
      closedProfit += row.profit;
      retained = positive(retained + developmentShare(row.profit - row.tax) - row.invested);
    } else { currentProfit += row.profit; currentInvestment += row.invested; }
  }
  retained = positive(retained + developmentShare(currentNet) - currentInvestment);
  const reconciled = closedProfit === BigInt(f.profit)
    && currentProfit === BigInt(f.monthlyRevenue) - BigInt(f.monthlyExpense)
    && taxPaid === BigInt(f.owner!.taxPaid);
  return { retained, invested, reconciled };
}
