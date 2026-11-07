> **kind:** FINDING

## 2026-11-07 — Ask Largo: swing play-brief's top-level `invalidation` field (C7 structured field) kept showing a future-risk stop level even after the bid had already breached it — FIXED

| **Status** | FIXED on `fix/swing-invalidation-ignores-exec-breach` |
| --- | --- |

**Symptom (live-confirmed, CAVA:2483 and WMB:2357, both OPEN/HOLD, 2026-11-07):** the swing
play-brief's top-level `envelope.invalidation` field — and `evidence_numbers`'s "Invalidation:
..." line, built verbatim from it — stated a plain, forward-looking "Premium stop at $X" level,
even though the SAME response's "Trade manager read" narrative, computed from the identical
bid/stop pair, already said:

> **Break watch — stop already breached on the executable side** — bid **$0.36** is at/through
> your premium stop **$0.40** right now → exit or cut size.

CAVA: mid $0.53, bid $0.36, stop $0.40 — `envelope.invalidation` read "Premium stop at $0.40".
WMB: mid $1.30, bid $0.00 (confirmed, no buyer at any price), stop $0.32 —
`envelope.invalidation` read "Premium stop at $0.32". A negative control (PLTR, bid $5.45 > stop
$3.61, genuinely not breached) showed both surfaces agreeing, confirming the mismatch is a real
conditional defect and not a blanket disagreement.

**Root cause:** `composeSwingPlayBrief`'s `invalidation` fallback chain
(`src/lib/swing/play-brief.ts`, the `bucket === "open" && invalidationStopPremium != null` branch)
renders a bare `"${label} at ${fmtUsd(stop)}"` string with no check of whether the bid has already
crossed that stop. Meanwhile `tradeManagerNarrativeSection`
(`src/lib/swing/play-brief-narrative.ts`) independently computes `execBreached` — `effectiveStop
!= null && execMarkForBreach != null && execMarkForBreach <= effectiveStop` — using only
bid/execBidZero + stop_premium, no spot/GEX/Vector required, so it correctly fires even when
`resolveBreakInvalidation` can't resolve a live spot (true for both repro tickers: GEX positioning
and Vector desk state were both in `unavailableSources`). The two computations never shared state,
so the same response could carry both a "future risk" framing and an "already breached" framing
for the identical stop level — the same "two sections of one brief disagreeing about reality" bug
class this file has repeatedly fixed (dead pre-scale stop 2026-11-01, moot-gate framing
2026-10-25, fetch-failure attribution 2026-10-16, momentum-flip wrong-side fallback 2026-09-11),
but this specific asymmetry was never itself closed.

This matters specifically because `envelope.invalidation`/`evidence_numbers` are the structured,
Largo-contract C7 evidence fields — exactly what a model or a headline UI chip is most likely to
read in isolation without parsing the free-text narrative bullets — so the consumer this contract
exists to serve got the stale, lower-urgency framing while the prose (which it may not surface)
had the correct, urgent one.

**Fix:** Mirror `tradeManagerNarrativeSection`'s own breach check at this call site: compute
`invalidationExecMark` (treating a confirmed `execBidZero` as $0.00, same as the narrative's
`execMarkForBreach`) and `invalidationExecBreached` (`invalidationStopPremium != null &&
invalidationExecMark != null && invalidationExecMark <= invalidationStopPremium`), then append
"— already breached on the executable side" to the fallback string when true. Direction-agnostic
(a swing play is always long-premium regardless of LONG/SHORT thesis direction, per this file's
own prior comments) and works identically for the pre-scale premium stop and the post-scale
runner trailing stop, since both flow through the same `invalidationStopPremium` variable.

**Blast radius:** `composeSwingPlayBrief`'s `invalidation` assignment only (`play-brief.ts`) — one
fallback branch. `evidence_numbers`'s "Invalidation: ..." line is built verbatim from this same
field (`play-brief-adapter.ts`), so it's fixed for free. No other call site changed.

**Evidence:**
- Live repro (CAVA:2483, WMB:2357, prod, 2026-11-07): confirmed both rendered the stale
  future-risk framing while the narrative in the same response already flagged the breach.
- RED→GREEN proven via `git stash` on just the source fix (test changes kept): 2 new regression
  tests (CAVA-shaped plain-bid breach, WMB-shaped confirmed-$0.00-bid breach) both FAIL against
  the pre-fix code and PASS after the fix. A third new negative-control test (bid above the stop)
  confirms the fix is conditional, not a blanket suffix.
- Full `play-brief.test.ts`: 199/199 pass post-fix (196 pre-existing + 3 new).
- `npx tsc --noEmit` clean (repo-wide).
- Full `npm test` run before merge.

Found via the standing "5-ENGINE LIVE MONITOR + Ask Largo" deep-dive mandate (CLAUDE.md).
