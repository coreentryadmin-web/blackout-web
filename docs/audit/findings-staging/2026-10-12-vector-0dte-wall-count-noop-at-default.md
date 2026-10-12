## 2026-10-12 — [Vector] 0DTE wall-count override is a no-op at the desk's default 3m timeframe — OPEN (design question, not fixed here)
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Vector / visual density | P3 — comment is misleading; behavior may or may not be intentional | OPEN |

**What's wrong.** `src/features/vector/lib/vector-bar-timeframes.ts:18-23` documents
`VECTOR_0DTE_WALL_COUNT`:
```ts
/** Bead rows per side when a narrowed 0DTE horizon is active — wider than the 3m default (8) so the
 *  desk opens on more of the intraday rail than a tight spot cluster. ... */
export const VECTOR_0DTE_WALL_COUNT = 10;
```
But `VECTOR_DEFAULT_TIMEFRAME = 3` (line 16), and `wallCountForTimeframe` (line 51-78) already
gives `tf<=3 → Math.max(VECTOR_0DTE_WALL_COUNT, 11) = 11` — the 3m default is **11**, not 8 (8 is
the `tf<=1` value). Tracing `wallCountForHorizon` (line 81-86), which is what actually applies
the 0DTE override:
```ts
export function wallCountForHorizon(tf: VectorTimeframeMinutes, horizon: VectorDteHorizon): number {
  if (horizon === "0dte") {
    return Math.max(wallCountForTimeframe(tf), Math.min(VECTOR_WALL_NODES_PER_SIDE, VECTOR_0DTE_WALL_COUNT));
  }
  return wallCountForTimeframe(tf);
}
```
At `tf=3` (the live default), `wallCountForHorizon(3, "0dte")` = `Math.max(11, 10)` = **11** —
identical to the non-0DTE case. The override has **zero effect at the desk's actual default
timeframe**, directly contradicting the comment's stated purpose ("wider... so the desk opens on
more of the intraday rail"). It only widens anything at `tf=1` (8 → 10); at every other
timeframe `wallCountForTimeframe` alone already equals or exceeds 10.

**Why this is a comment problem AND an open behavioral question, not just a typo.** The
"(8)" in the comment is simply wrong (should read "11" to match the real 3m value) — that part
is a safe, mechanical text fix. But fixing only the text leaves the deeper question unexamined:
was the 0DTE override ever meant to widen the rail beyond 11 at the 3m default, and did a later
tuning pass (the `tf<=3` branch's own floor of 11, per that function's extensive "THE WALK STEPS
UP" / "RESTORED 2026-09-07" git-archaeology comments) silently absorb what `VECTOR_0DTE_WALL_COUNT`
used to control? `VECTOR_0DTE_WALL_COUNT` itself carries its own revision history ("Was 12.
Reduced to 10 (member-directed, 2026-08-09)") — it has been deliberately member-tuned before,
so bumping it again to restore a real effect at tf=3 is a product/visual-density decision, not
a drive-by fix. This file's `wallCountForTimeframe` has already absorbed several corrections
from exactly this kind of entanglement (see its own comment: "#4460 mistakenly raised counts...
thinking that was Sep-3" — a prior session changed a number here based on a misreading, and it
visibly broke the chart's reference density until reverted).

**Not fixed here** — per the standing "write up bigger findings/enhancements rather than
unilaterally building them" discipline: changing `VECTOR_0DTE_WALL_COUNT` (or the `tf<=3` floor)
to restore a real 0DTE-specific widening touches the SPX desk's live, carefully-tuned bead
density, which has broken from well-intentioned changes before. The one safe, mechanical part
(correcting "(8)" to "(11)" in the comment) is deliberately left for whoever resolves the
behavioral question too, so the comment doesn't get marked "accurate" while the real question —
should 0DTE widen the rail at the default timeframe at all — goes unexamined.

**Recommended next step (not done here).** Either (a) raise `VECTOR_0DTE_WALL_COUNT` above 11 if
0DTE really should widen the 3m view beyond the baseline, confirmed against a live SPX 0DTE
session the way prior tunings in this file were (member screenshot comparison), or (b) if the
`tf<=3` floor already does what 0DTE needed, document that explicitly and correct the comment to
say the override is now effectively dormant except at `tf=1`, rather than leave it claiming an
effect it doesn't have.

**Verification.** Traced `wallCountForTimeframe`/`wallCountForHorizon`/`VECTOR_DEFAULT_TIMEFRAME`
directly in `src/features/vector/lib/vector-bar-timeframes.ts`; confirmed `Math.max(11, 10) = 11`
by direct computation, not inferred.

Found via a background Explore-agent sweep of the Vector/Thermal desk UI, independently
re-verified (recomputed the exact `wallCountForHorizon(3, "0dte")` result from source) before
writing this up.
