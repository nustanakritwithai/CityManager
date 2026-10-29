# Owner profit withdrawals

Manual withdrawals, monthly automatic income and owner-decision commands share
the same earned-profit and cash limits. Money remains integer satang (100 per credit).

- Current profit is revenue minus booked operating expenses minus outstanding
  wage claims. Paying a claim books the expense and removes the claim, so it is
  counted once. Rent and utility charges keep their existing booking dates.
- Current positive profit reserves the existing 20% tax, rounded down. Completed
  months use the tax actually recorded by the existing monthly settlement.
- Each month's positive after-tax profit retains 25%, rounded up. Retention
  carries across months; a loss or a new month does not release earlier retention.
- Only recorded `Market to shop conversion` and `Profitable firm height investment`
  payments to `construction` consume retention. The month's actual investment
  spending offsets prior retention plus that month's retention, floored at zero.
  Excess spending never gives credit against later months. Opening construction
  remains principal-funded, and unrelated cash movements do not release retention.
- Cumulative earned funds are reduced by taxes, prior distributions, actual
  development spending and the remaining development reserve. Deducting spending
  as the reserve is consumed prevents distributing the same earnings again from
  contributed principal. Negative availability blocks new draws; it does not
  claw back old payments or alter balances.
- The cash limit also preserves outstanding wages, current tax, remaining
  development retention and 20,000 satang working cash. Owner-decision proposals
  retain their additional next-rent buffer. Automatic monthly income is capped
  by that month's 75% allowance less manual draws already made in the month;
  retention is not deducted twice.

The complete money and crop journals reconstruct the reserve read-only, including
older owned markets, retail shops and market-to-shop conversions. Crop purchases
remain inventory until the crop journal releases their cost; they are not counted
again as cash expenses. There is no save-schema change and no balance rewrite.
The reconstructed closed/current operating results and tax payments must match
the saved firm totals. If they do not, new withdrawals are unavailable and the
finance reason reports the mismatch; the save and earned wage claims remain intact.

Regression coverage is in `tests/owner-profit.test.ts` and the existing owner
income/decision suites. The published v15 fixture verifies historical reserve
reconstruction and unchanged save state. The seed-42 day-62 wage example changes
current profit from 6,800 to 5,400 satang and tax from 1,360 to 1,080; the complete
policy also accounts for its earlier 20,000-satang expansion. The pre-fix day-210
firm-12 snapshot has 73,010 satang carried development retention after its 20,000
conversion, so its former additional 93,010-satang manual draw is rejected.
