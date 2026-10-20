## A swing play-brief could name a GEX wall as "nearest" while a different section in the SAME brief named the gamma flip — the third unreconciled "nearest level" precedence in this file — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit of the swing
play-brief's chart/GEX technical-level sections (`chartTechnicalsSection`, `chartLevelsSection`,
`gexPostureSection`, `wallDynamicsSection`, `vectorDeskSection`), adversarially verified (3-agent
pipeline: investigate → verify-by-source-tracing; confirmed real, not refuted).

**Root cause:** Three independent places in the swing play-brief answer "what's the nearest level
to spot" and used three different inputs:

1. `gexPostureSection`'s "Nearest wall" line (`src/lib/swing/play-brief-intel.ts`) called the
   shared `nearestWallFromLevels(callWall, putWall, spot)` (`gex-nearest-wall.ts`), which **only
   ever compares the call/put wall — it has no gamma-flip parameter at all.**
2. `chartLevelsSection`'s own "Nearest wall" line (same file) is sourced from
   `vec.proximity`/`deriveWallProximity`, which **does** consider the flip as a third, equally
   eligible candidate (`WallProximitySide = "call" | "put" | "flip"`).
3. `play-brief.ts`'s structured "Dealer posture" evidence line computed its own local wall-only
   answer via the same shared helper, then fell back to the raw (non-Vector-preferred) `gex.flip`
   **only when no wall existed at all** (`else if (gex.flip != null)`) — never comparing the two.

Whenever the flip genuinely sat closer to spot than either wall, (1) and (3) could only ever name
a wall, while (2) correctly named the flip — three sections of one envelope disagreeing about the
identical conceptual question. Same bug class this file has already fixed twice before for other
"two precedence rules, one conceptual level" cases (GEX king strike, 2026-09-09; GEX walls+spot,
2026-09-11) — this is the third instance, on the flip specifically.

A fourth, same-section defect surfaced tracing this: `chartLevelsSection`'s OWN "Nearest wall" line
(via `vec.proximity`) restates the identical value its own immediately-preceding "Gamma flip:" line
already rendered, whenever `vec.proximity.side === "flip"` — a same-section self-duplicate, not
just a cross-section one.

**Live impact:** Reachable in production for every CLOSED-bucket brief (the collapse pipeline
never strips these sections there) and for any bucket via the member-facing `expandIntel=1`
("Show detail") toggle. Concrete repro traced by the audit: spot 7550, call wall 7650 (1.3% away),
put wall 7400 (2.0% away), gamma flip 7560 (0.13% away, clearly nearest) — `chartLevelsSection`
correctly says *"Nearest wall: 7560.00 gamma flip overhead (0.13% away)..."* directly under its own
*"Gamma flip: 7560.00 — +0.1% ($10.00 from spot)"* (the self-duplicate), while `gexPostureSection`
in the SAME envelope says *"Nearest wall: 7650.00 (resistance, 100.0 pts from spot 7550.00)"* —
naming a level ten times farther away as "nearest."

**Fix:**
- Added `nearestLevelWithFlip(wall, flip, flipFromStaleGex, spot)` (`play-brief-intel.ts`) — a
  thin wrapper that extends a wall-only `NearestWall` answer with the flip as a third candidate,
  returning whichever is genuinely nearest.
- Extended `preferredGexWalls(ctx)` to also resolve `flip`/`flipFromStaleGex` with the identical
  Vector-first/GEX-matrix-fallback precedence `chartLevelsSection` already established inline —
  centralizing it the same way the function's own header already does for the walls, so every
  "nearest level" consumer reads the same flip value.
- `gexPostureSection` now calls `nearestLevelWithFlip` instead of rendering the wall-only answer
  directly; the rendered label swaps to "gamma flip" when the flip wins, otherwise unchanged.
- `play-brief.ts`'s Dealer-posture line now compares wall vs. flip via the same helper instead of
  an `else if` fallback-only-when-absent, and reads the Vector-preferred flip (previously raw
  `gex.flip`) — safe unconditionally there since that call site is already gated on `!gexStale`.
- `chartLevelsSection`'s own "Nearest wall" line is now suppressed when `vec.proximity.side ===
  "flip"` and the flip is already rendered above it — the self-duplicate fix. A genuine wall
  callout (`side === "call"`/`"put"`) is untouched.

**Fix rationale:** Deliberately NOT fixed inside the shared `nearestWallFromLevels` itself — that
helper also backs `gex-positioning.ts`'s general-purpose `nearest_wall` field, read by other desks
(e.g. Thermal) with no flip concept wired into this call shape; widening it there risks an
unreviewed behavior change outside swing. Wrapping at the three swing call sites keeps the fix
scoped to the actual bug and the actual blast radius.

**Blast radius:** All three call sites that answer "nearest level to spot" for swing
(`gexPostureSection`, `chartLevelsSection`, `play-brief.ts`'s Dealer-posture line) are now fixed in
this one PR, per the standing PR write-up policy's blast-radius requirement — not just the one the
audit happened to trip over first.

**Tests:** 2 pre-existing `play-brief.test.ts` fixtures had an incidental flip value closer to spot
than the wall they were asserting on (testing a different, still-valid concern — Vector-vs-GEX-matrix
wall precedence) — adjusted to a flip value that doesn't interfere, with a comment explaining why,
preserving each test's original intent. 5 new regression tests added (gexPostureSection flip-wins +
no-regression; chartLevelsSection self-duplicate suppression + no-regression; Dealer-posture
flip-wins) — all fail against the pre-fix code (verified via `git stash`), pass after. Full suite
green on Node 20, `tsc --noEmit` clean.
