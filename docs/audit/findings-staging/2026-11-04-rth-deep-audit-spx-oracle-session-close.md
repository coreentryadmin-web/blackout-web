> **kind:** FINDING

## RTH deep audit false P0: off-hours SPX oracle used yesterday /prev vs session desk

| **Status** | FIXED |

### What was broken

After fixing the Nov-02 off-hours false positive (wrong live field), the oracle still used **`I:SPX/prev`** off-hours. Platform snapshot **desk spot** after the close is **today's session level** (~7683 on 2026-11-04), while `/prev` is **yesterday's close** (7568). On a +1.5% day the audit read `Δ 1.518% > 1.5% tol` at **16:02 ET** — P0, not a data defect.

### Fix

Off-hours: compare desk to Polygon **index snapshot `session.close`** (same session), same 1.5% tolerance. RTH unchanged (live `value`).

### Verify

Next post-close RTH deep audit on a |day move| > 1.5% should still PASS the oracle line when desk aligns with Polygon session close.
