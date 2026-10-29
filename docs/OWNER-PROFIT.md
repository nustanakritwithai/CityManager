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

## No-park regression evidence

Comparing the exact base `a6f4ada` with `69b39d1` for the existing no-park
seeds, day by day through day 119, finds the first difference on day 90.
Both firms paid a 20,000-satang expansion on day 60. Their month-90 owner
payouts must also respect cumulative earned funds after that spending:

| Seed | Closed profit | Taxes paid | Prior payouts | Development spent | Remaining retention | Allowed payout | Old payout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 61025 | 81,050 | 16,210 | 34,740 | 20,000 | 4,630 | 5,470 | 13,890 |
| 20261023 | 61,700 | 13,270 | 23,460 | 20,000 | 3,900 | 1,070 | 11,700 |

Allowed payout is closed profit minus the next four columns. The reductions
are 8,420 and 10,630 respectively. At day 119 the **only** changed fields are
firm 16's cumulative owner withdrawals, its firm cash, the receiving household
cash (household 6 or 4), and the single day-90 distribution ledger amount.
All people, employment, production, stock, tax, other transfers, buildings,
roads, education, RNG and other simulation state are identical.

`tests/parks.test.ts` retains both original full-state hashes. It asserts the
exact corrected payouts, reverses only those four documented field deltas in
a comparison copy, then checks the original hashes. Thus the test still fails
on any additional state change; it does not ignore owner accounting or replace
the golden with whatever the new simulation produces. Live-state money
conservation, save/reload, empty parks and residential occupancy gates remain
explicit assertions. No park runtime or policy is changed.
