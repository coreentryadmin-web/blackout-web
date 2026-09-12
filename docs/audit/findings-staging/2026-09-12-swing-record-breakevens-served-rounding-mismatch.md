> **kind:** FINDING

## Swing record `summary.breakevens` disagreed with the served `worstLegPnlPct:0` count in the SAME payload — FIXED

**Status:** FIXED (PR opened off `fix/swing-record-breakevens-rounding-mismatch`)

### Root cause

`GET /api/market/swing/record`'s `route.ts` wraps its entire response (`summary` AND `records`)
in `roundFloats(..., 2)` before serializing — the shared response-shaping helper that rounds every
float to 2 decimal places (`src/lib/round-floats.ts`). But `buildSwingRecord`
(`src/lib/swing/record.ts`) computed `composite.worstLegPnlPct` at **full, unrounded float
precision** (`Math.min(...pnls)`), and `buildSwingRecordSummary`'s `breakevens` field — introduced
2026-09-09 to surface "how many of the reported losses are exact breakevens rather than a real
drawdown" — tested that RAW value for an exact `worstLegPnlPct === 0`.

The client never sees the raw value, only the `roundFloats(2)`'d one. A genuinely non-zero leg P&L
of, say, `-0.03%` (real money-math noise from `gradeParentFromMark`'s `((mark - entry) / entry) *
100`, the roll-freeze grader) is NOT exactly 0, so `summary.breakevens` correctly excluded it — but
depending on the exact sub-cent value, the SAME chain's `worstLegPnlPct` can round to a displayed
`0` in the served `records[].composite.worstLegPnlPct` (`JSON.stringify(-0)` is even literally
`"0"`). A member or Largo reading the payload has no way to see the raw, unrounded number — only
the served one — so counting "how many records show a worst-leg P&L of 0.00%" and comparing it to
`summary.breakevens` can disagree, inside one response, about the same data.

### Evidence

Live `GET /api/market/swing/record` (2026-09-12, temp Clerk premium session, `scripts/audit/lib/
prod-clerk-session.mjs`):

```json
"summary": {"chains": 21, "resolved_chains": 21, "wins": 5, "losses": 16, "breakevens": 3, ...}
```

But of the 21 served `records`, **5** (root ids 12, 13, 16, 17, 24) show `composite.outcome:
"loss"` AND `composite.worstLegPnlPct: 0` — not 3. All 5 are `swing.roll.markfreeze.v1` freezes
(`grade_json.basis: "live_option_mark_vs_entry_premium"` or `"latched_last_mark_vs_entry_premium"`)
whose `entry_premium`/`exit_mark` display equal at 2dp but whose underlying `realized_pnl_pct =
((mark - entry) / entry) * 100` is computed at full float precision before any rounding — so a
sub-cent, non-exactly-zero move is fully possible and fully consistent with what the code computes.
A member reading the record page (or Largo narrating it) sees 5 rows reading "0.00%" while the
summary they'd naturally cross-check against says only 3 breakevens — an unexplainable, internally
contradictory pair of numbers in the same response, the same shape as this hour's other self-
contradicting-number fixes (gamma posture, invalidation callout, condor direction).

Reproduced deterministically with a fixture (`src/lib/swing/record.test.ts`, new test): a chain
graded `realized_pnl_pct: -0.001` is correctly excluded from `summary.breakevens` pre-fix (raw
value isn't exactly 0), but the SAME chain's `roundFloats(2)`'d served `worstLegPnlPct` displays as
`0` — `git stash` on `record.ts` alone reproduces this RED, restoring it turns it GREEN.

### Fix

`buildSwingRecord` now rounds `worstLegPnlPct` to 2dp at construction (`round2(Math.min(...pnls))`,
the same helper already used for the module's other two money views, `sumPnlPct` and
`compoundedReturnPct`, which were already round2'd and therefore never had this bug). Rounding at
source means `buildSwingRecordSummary`'s exact-0 test operates on the SAME number the API later
serves (`roundFloats(2)` on an already-2dp value is a no-op), so the two views can no longer
disagree — a chain that rounds to a displayed `0.00%` is now consistently classified as a
breakeven in BOTH `summary.breakevens` and every served `records[].composite.worstLegPnlPct`. This
also changes the semantics slightly: a genuinely-tiny (<0.005%) real loss now DOES count as a
breakeven, which is the more honest reading — a member cannot distinguish a mathematically-real
-0.001% loss from an exact 0% one at the precision the product actually displays, so treating them
identically for THIS reporting field is correct, not a regression.

### Blast radius

Only `worstLegPnlPct`'s construction changes; `sumPnlPct`/`compoundedReturnPct` were already
round2'd (unaffected) and `isSwingWin`/win-loss classification is computed from the raw
`realizedPnlPct` per-leg, not from `worstLegPnlPct` — no change to which chains are wins vs losses,
only to which losses are additionally flagged as breakevens and to the served preserved-loss-witness
number's precision. No other reader of `SwingChainComposite.worstLegPnlPct` was found repo-wide
(`grep -rn "worstLegPnlPct" src`) — this is the only load-bearing consumer.

### Fix rationale

Rounding at the summary layer instead (i.e., leaving `worstLegPnlPct` raw and rounding only inside
`buildSwingRecordSummary`'s breakevens test) was considered and rejected: it would fix the count
but leave the SERVED `worstLegPnlPct` field itself still capable of displaying `0` for a
non-breakeven chain, reintroducing the exact member-facing contradiction this fix targets. Rounding
at construction (matching the existing pattern for the module's other two derived fields) is the
single point of truth — every consumer (summary, `records`, and any future consumer) now agrees.
