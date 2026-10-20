## A swing play-brief's Structure Ladder named a different "stop" than the SAME envelope's "Structural stop (committed)" line for an already-OPEN position — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit hunting for a
fourth instance of this lane's recurring bug class (two sections of one envelope disagreeing about
the same conceptual price level — previously fixed for GEX king strike, GEX walls+spot, and
wall-vs-gamma-flip), adversarially verified (4-agent pipeline: 2 independent investigation angles,
each finding verified by a dedicated skeptic re-tracing the claim against current source; both
confirmed real).

**Root cause:** `buildStructureLadder` (`src/lib/swing/play-brief-ladder.ts`) set
`StructureLadder.stop = plan.thesisInvalidationPx`, where
`plan = deriveSwingPlanLevels(play.direction, spot, null)` — because `atrIn` is always `null`, this
falls back to a generic ATR proxy (`price * 0.015`) and derives a fresh, TODAY's-spot-anchored
stop with no connection to the real position.

Meanwhile, for the identical OPEN/HOLD/TRIM play, `tradeManagerNarrativeSection`
(`play-brief-narrative.ts`'s `committedStructuralStopLine`) renders the REAL, frozen stop —
`play.invalidationUnderlyingPx`, sourced from the ledger's `thesis_invalidation_px`, pinned once at
commit. Both values land in the exact same JSON envelope (`play-brief.ts` composes
`buildIntelSections(...)` → "Trade manager read" and `structureLadder` from the same `play`/
`bucket`), both explicitly presented as "the level that invalidates/stops this swing thesis."

The divergence was not an oversight at build time — `play-brief-ladder.ts`'s own doc comment
explicitly justified the live recompute on the premise that "`thesis_invalidation_px` is not
threaded onto `TerminalPlay` today." That premise went stale on 2026-09-28, when
`invalidationUnderlyingPx` WAS threaded onto `TerminalPlay` (`committedStructuralStopLine` has read
it directly since 2026-10-16) — `play-brief-ladder.ts` was never revisited to use the now-available
real field, despite `buildStructureLadder` already receiving the full `play: TerminalPlay` object.

This also compounded downstream: every favorable-side rung's `rewardRisk` was
`|rung.price − plan.entryUnderlyingPx| / |plan.entryUnderlyingPx − plan.thesisInvalidationPx|`,
where `plan.entryUnderlyingPx` is ALSO just today's live spot (not the real entry), so every
displayed R:R ratio was built on a synthetic risk leg, not the real commit-time risk.

**Live impact:** reachable for every OPEN/HOLD/TRIM swing play (both the "Trade manager read"
section and the `structureLadder` field fire unconditionally for that bucket). Example: a LONG
committed at underlying 220 with a real structural stop of 205 (6.8% below entry), now OPEN with
spot risen to 240 — the narrative correctly says "Structural stop (committed): 205.00 (14.6%
away)" while `structureLadder.stop` showed 234.60 (only 2.25% away), a 29.60-point gap for what
both sections call the same trade's stop. The reward:risk denominator was understated accordingly.

**Fix:**
- `buildStructureLadder` now prefers the REAL `play.invalidationUnderlyingPx`/
  `play.entryTriggerUnderlyingPx` pair (pinned at commit) over the live ATR-based recompute
  whenever `bucket === "open"` AND both real values are present and finite — never a mixed
  real-stop/live-entry frame; falls back fully to the live recompute otherwise (a WATCH candidate,
  or an OPEN position missing one of the two real fields).
- Added `StructureLadder.stopIsCommitted: boolean` so the UI can tell which kind of `stop` it
  received, rather than inferring it from `positionState` alone (which no longer implies "always a
  live recompute" for `"open"`).
- `BieStructureLadder.tsx` (the member-facing widget) now renders "Committed stop" (with a line
  stating it's the real pinned invalidation level) instead of unconditionally showing "Reference
  stop ... recomputed from today's spot ... may differ" — that caveat would now be actively wrong
  whenever the real value is in use, which is exactly the kind of self-contradicting UI this audit
  lane exists to catch.
- `atr`/horizon classification are left on the live ATR value regardless — that's a
  volatility-bucket input, not a claim about this trade's actual risk level, so no reason to swap it.

**Fix rationale:** Kept the live recompute as the fallback (not removed) for WATCH candidates and
for an OPEN position missing real data — an honest estimate is still better than nothing, and the
existing `positionState`/`stopIsCommitted` fields let the UI distinguish all three cases correctly.
Did not touch `deriveSwingPlanLevels`/`structure-levels.ts` itself — that function is shared and
correct for its WATCH-candidate purpose; the bug was in `play-brief-ladder.ts`'s choice to always
call it even when a real, better answer existed.

**Blast radius:** `structureLadder.stop`, every favorable rung's `rewardRisk`, and
`BieStructureLadder.tsx`'s rendered stop line/caveat — all three fixed in this one PR (the UI
caveat fix is the same root cause: a field that used to always mean "live recompute" no longer does).

**Tests:** 3 new regression tests in `play-brief-ladder.test.ts` — an OPEN position with real
committed entry/stop uses those (not the live recompute); a WATCH candidate always uses the live
recompute even if the play somehow carries real fields; an OPEN position with only ONE real field
present falls back fully to the live recompute (no mixed frame). RED→GREEN proven via `git stash`
on `play-brief-ladder.ts` alone (1/24 failed pre-fix — exactly the new "uses THOSE" test — 24/24
pass post-fix). Full suite green on Node 20, `tsc --noEmit` clean.
