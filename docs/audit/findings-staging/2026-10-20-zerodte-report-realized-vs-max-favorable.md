## 2026-10-20 — [FINDING, P3 Night Hawk 0DTE] Public record now reports realized P&L and max favorable excursion SEPARATELY — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Context.** Member audit directive, point 6 of the original brief: "Prove performance
honestly... separate realized exits from maximum potential gains." Checked the public
`/api/market/zerodte/record` route (the multi-day track record surface `buildZeroDteRecord`
shapes): every per-play object carries `plan_pnl_pct` (mechanical grade) and `managed_pnl_pct`
(as-managed/realized grade) at the TOP LEVEL — but the position's own tracked peak
(`entry_context.exit.peak_pnl_pct`, already stamped by the exit engine on every live-managed
exit) was buried in a nested blob, never promoted to a labeled, top-level field. This is exactly
the shape of confusion this same audit session traced on a real TSLA 2026-10-19 row: a member or
Largo reading the headline `managed_pnl_pct: -22.57` has no easy way to also see
`peak_pnl_pct: 0` ("this position never showed a paper gain before it closed") sitting right next
to it — both numbers are real, but only one was visible without digging into the raw blob.

### What changed

- `record.ts`: `readManagedExit` now also returns `peak_pnl_pct` (additive — existing callers
  destructuring `{reason, pnl_pct}` are unaffected). New `extractMaxFavorablePct(entryContext)`:
  reads the real, already-stamped peak off the SAME live-managed exit object `managedGradeView`
  reads — never a second, independently-computed peak, so it can never disagree with the engine's
  own tracking. Returns null (never a fabricated zero) when the row never carried a live-managed
  exit at all.
- `ZeroDteRecordPlay` gained a new top-level `max_favorable_pct: number | null` field, populated
  alongside `managed_pnl_pct` in the row-shaping function — now every play in the public record
  carries BOTH numbers side by side, clearly separated, never conflated into one.

### Checked for a redundant/competing field before adding this

`src/lib/platform/zerodte-service.ts` (the Largo-facing live-board surface, a DIFFERENT route from
the public multi-day record) already carries its OWN `peak_pnl_pct` field, computed from the raw
`entry_premium`/`peak_premium` DB columns via `peakPnlPct()` (marks-math.ts) — a real, already-
correct, already-wired computation on that surface. Confirmed this is sound and did NOT need a
duplicate addition there; the gap was specifically on the `/record` route's per-play shape, not on
the live-board surface.

### Tests

6 new tests in `record.test.ts` (`readManagedExit` carries the new field, non-finite/missing
degrades to null, `extractMaxFavorablePct` reads the real stamp vs. returns null on absence, and
two `buildZeroDteRecord` tests confirming the real TSLA shape — `peak_pnl_pct: 0` alongside
`managed_pnl_pct: -22.57`, both surviving separately — and that a row with no exit stamp reads
`null`, never a fabricated `0`). RED→GREEN proven (reverted `record.ts` to pre-change, confirmed 6
failures; restored, confirmed 41/41 pass). `npx tsc --noEmit`: clean across the whole repo (no
other consumer does a strict/exhaustive shape match against `ZeroDteRecordPlay` that a new
additive field would break).

### Deliberately not done here

- Did not add an aggregate `avg_max_favorable_pct` alongside the existing `avg_pnl_pct` rollup —
  a real, separately-scoped follow-up (touches the `rollup`/`rollupCounts` aggregation machinery,
  not just the per-play shape); left for a future pass if wanted.
- Did not touch the Largo live-board surface (`zerodte-service.ts`) — already correct, see above.
