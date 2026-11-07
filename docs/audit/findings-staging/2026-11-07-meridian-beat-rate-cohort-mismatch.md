> **kind:** FINDING

## Meridian earnings History tab's EPS/Revenue/Combined beat-rate bars all shared ONE (EPS-only) cohort size, hiding a valid Revenue/Combined rate whenever EPS had zero graded prints — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** round-365 discovery-lane sweep. Started from the recurring "a rate without its
own cohort size is a false statement about the sample" defect shape this codebase has already
fixed twice elsewhere for the exact same `dualBeatRateFromPrints` aggregate — once in
`meridian-earnings-history.ts`'s `printHistorySummary` ("The EPS half of this sentence carries
its denominator and the revenue half did not, in the SAME string") and once in
`meridian-sector-core.ts`'s `PeerReactionSummary` ("a caller that shows `beatRate` next to this
`n` is reporting the wrong sample size for it — the historical bug this comment now documents").
Checked every other render site reading `beat_rates` for the same gap and found a third,
un-fixed instance in `MeridianEarningsHistoryPanel.tsx`.

**Root cause:** `dualBeatRateFromPrints` (`src/lib/meridian/meridian-benzinga-earnings-core.ts`)
grades `eps_beat_rate`, `revenue_beat_rate` and `combined_beat_rate` on **three different,
independently-sized cohorts**:
- `eps_graded` — prints with a gradeable EPS surprise (`p.beat != null`)
- `revenue_graded` — prints with a gradeable revenue surprise (`p.revenue_surprise_pct != null`)
- `combined_graded` — the POOLED reading count (`eps_graded + revenue_graded`; a print graded on
  both measures counts twice; explicitly documented as "wrong as a noun" if printed as "N prints")
- `prints_graded` — distinct prints with ≥1 gradeable measure (the honest "over N prints" count)

That same file's own doc comment states the denominators routinely diverge: "of 4,484 names
carrying both rates, 140 (3.1%) have denominators differing by 3+ prints and 52 (1.2%) have one
side at ≤2 while the other is ≥6."

`MeridianEarningsHistoryPanel.tsx` ignored all four of these server-computed fields and instead
recomputed a single `graded = prints.filter(p => p.beat != null).length` — which is, by
construction, identical to `eps_graded` alone — and passed that **one shared number** as `n` to
all three `RateBar`s (EPS, Revenue, Combined) and to the single "over N graded prints" caption
below them.

**This is not merely a cosmetically-wrong denominator — it suppresses a real, non-null rate.**
`RateBar` renders "—" whenever `n === 0`, independent of whether `rate` itself is null:
```tsx
if (rate == null || !Number.isFinite(rate) || n === 0) { return <...>—</...>; }
```
So whenever a ticker has zero EPS-graded prints (no `eps_estimate`/`eps_actual` on file for any
recent print — not rare; per the same core file, 20-25% of names get no EPS rate at all) but one
or more revenue-graded prints, the shared `graded` is 0, and the Revenue AND Combined bars render
"—" even though `revenue_beat_rate`/`combined_beat_rate` are valid, non-null, finite numbers the
server already computed. A member reading the Revenue beat-rate bar in this case sees "no data"
for a rate the platform actually has.

In the inverse, non-degenerate case (both cohorts non-empty but merely different sizes — the
3.1%/1.2% population above), the single "over N graded prints" caption under all three bars
silently reports the wrong N for at least one of them, and for the Combined bar it can report
the POOLED reading count as a print count once the component is changed to use the right field
naively (guarded against here by using `prints_graded`, not `combined_graded`, for that caption).

**Blast radius:** `MeridianEarningsHistoryPanel.tsx`'s "Beat rates" card only — this is the sole
render site that recomputed its own shared cohort instead of reading the aggregate's own fields.
`meridian-earnings-history.ts`'s `printHistorySummary` and `meridian-sector-core.ts`'s
`summarizePeerReaction` already use per-field cohorts correctly (the precedent this fix follows).

**Fix:** extracted `resolveBeatRateCohortCounts()` to a new, pure, client-safe sibling module
(`src/features/meridian/lib/meridian-beat-rate-display.ts` — no render harness exists for this
`"use client"` component per this repo's usual CI constraint, so the pure logic is isolated and
tested directly) that reads `eps_graded`/`revenue_graded`/`combined_graded`/`prints_graded`
straight off the server-computed `beat_rates` aggregate, independently, with no field borrowing
another's value. The component now passes `cohorts.eps`/`cohorts.revenue`/`cohorts.combined` to
the three bars respectively, and `cohorts.captionPrints` (the honest distinct-print count) to the
shared caption.

**Fix rationale:** reuse the aggregate the server already computed rather than re-deriving a
(wrong) cohort client-side from raw prints — the same shape of fix already applied to the two
earlier instances of this exact defect class in this codebase. Left unchanged: `RateBar`'s own
`n === 0` gating (correct — it exists precisely to distinguish "ungraded" from "0% rate"; the bug
was only ever in what `n` was fed), and every other field on `beat_rates`/`MeridianEarningsPrint`.

**Evidence (RED → GREEN):** `src/features/meridian/lib/meridian-beat-rate-display.test.ts`, 4
tests. Proven via `git stash`-style before/after on just the new lib file: temporarily reverted
`resolveBeatRateCohortCounts` to the original bug shape (one `shared = rates?.eps_graded ?? 0`
value reused for every field) — RED: 3/4 tests fail (`6 !== 0` on the "mixed cohorts... other
direction" case, and the two cases exercising the degenerate EPS=0/Revenue>0 scenario). Restored
the real per-field fix — GREEN: 4/4 pass. Also ran the full `src/features/meridian` +
`src/lib/meridian` test suites (590 tests, 25 suites): 590/590 pass. `npx tsc --noEmit`: clean.
