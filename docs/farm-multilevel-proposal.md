# Farm progression proposal

This component proposes same-cell autonomous farm growth beyond the existing three levels. Existing levels and economic rules are unchanged. Farm identity, crop choice, stock, owner, workers and account are retained by upgrading the existing building.

| Absolute level | Worker slots | Water units | Crop storage lots | Visual |
| --- | ---: | ---: | ---: | --- |
| 1 | 1 | 1 | 96 | Existing plot |
| 2 | 2 | 2 | 96 | Existing plot |
| 3 | 3 | 3 | 96 | Existing plot |
| 4 | 4 | 4 | 120 | One gold shed marker |
| 5 | 5 | 5 | 144 | Two gold shed markers |
| 6 | 6 | 6 | 168 | Three gold shed markers |

The new capacity and working-cash threshold are proposed balance values, separate from existing prices, wages, rent, export reserve and yield constants. Each upgrade costs the existing 20,000 satang construction charge. For levels 4–6 the firm must also retain 20,000 satang after that charge and earned payroll reserves. The existing monthly, profit, staffing, road, service and additional-water gates apply. One harvest per day is limited by employed workers, water, road, fertility and available storage; there is no additional level multiplier. Fertility continues to affect yield with the existing 50% floor, and manual crop selection is unrestricted.

The draft envelope is version 16/chain-11, subject to serial integrator assignment. Version 15 and older retain their historical maximum level and harvest worker validation. A saved level 4–6 farm has no separate level-history journal; replay accepts a harvest if a capacity consistent with some preceding level could have produced it. Removed farms retain the bounded maximum and conservation checks, while their former fertility and exact level cannot be recovered from the journal. The integrator must reconcile the envelope with housing, other businesses, park runtime and market identity before release.
