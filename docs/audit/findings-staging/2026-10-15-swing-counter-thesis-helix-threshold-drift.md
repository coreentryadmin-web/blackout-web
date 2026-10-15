## 2026-10-15 — [Ask Largo / Swing] `counterThesisLine`'s HELIX put/call-led gate used a 1.2x threshold while every sibling check in the same file (and its two neighbor files) uses 1.3x, producing a self-contradicting brief — FIXED

> **kind:** `FINDING`

| **Status** | **PR** |
|---|---|
| Fixed | (this branch) |

### Summary
`counterThesisLine` (`src/lib/swing/play-brief-narrative.ts`) is the function behind the swing
play-brief's "Counter-thesis" bullet — the one that steelmans the opposing case for a swing
position. Its HELIX put/call-led check fired at a **1.2x** premium-ratio threshold, while every
other HELIX call/put-heavy check in this exact codebase family uses **1.3x**:

- `flowNarrative` — same file (`play-brief-narrative.ts`), a *different* function whose "HELIX
  tape" bullet lands in the exact same "Trade manager read" bullet list `counterThesisLine`
  renders into.
- `flowIntelSection` (`play-brief-intel.ts`) — the "Flow & positioning" section's call-heavy /
  put-heavy / balanced label.
- `crossDeskCoaching` (`play-brief-narrative-coaching.ts`) — the "Cross-desk friction" conflict
  check.
- the same `callHeavy`/`putHeavy` shape in `play-brief.ts` itself.

No comment at the 1.2x call site explained a deliberate divergence — every other place in this
file that intentionally differs from a sibling (dedup against `crossDeskCoaching`'s Vector
reason, the `vectorConflictAlreadyNoted` flag, etc.) documents *why*. This one didn't, which is
the signature of an unnoticed constant drift, not a design choice.

### Root cause
At a put/call premium ratio between 1.2x and 1.3x (e.g. $1.25M puts vs $1.0M calls), the SAME
underlying flow numbers render two incompatible verdicts in the SAME "Trade manager read" bullet
list of the SAME brief:

- `flowNarrative`'s "HELIX tape" bullet: **"balanced"** (1.3x not cleared — `bias =
  callHeavy ? "call-heavy" : putHeavy ? "put-heavy" : "balanced"`, both false at this ratio).
- `counterThesisLine`'s "Counter-thesis" bullet: **"HELIX put-led"** steelmanned as a bear-case
  reason (1.2x cleared).

A member reading one document sees the flow called "balanced" in one bullet and "put-led" (cited
as evidence the thesis could fail) two bullets later — a visible internal contradiction over
identical numbers, not a difference of opinion between two independent reads (which the Largo
product contract's disagreement principle protects — this isn't that; it's the SAME function
family citing the SAME field with two different unexplained gates).

### Evidence
Regression test added to `src/lib/swing/play-brief-narrative.test.ts` (RED before the fix, GREEN
after): a LONG play with `call_premium: 1_000_000, put_premium: 1_250_000` (ratio 1.25x).

Before the fix, `counterThesisLine` returned:
```
**Counter-thesis (bear case)** — a single, uncorroborated signal — HELIX put-led ($1.3M vs $1.0M calls). If this wins, honor invalidation — don't hope.
```
while `flowNarrative`'s own threshold (1.3x, used elsewhere in the same file) would have called
this exact ratio "balanced" had it been exercised on the same numbers — confirmed by code
inspection of all 6 other 1.3x call sites (`grep -n "premium \* 1\.3" src/lib/swing/*.ts`) and the
isolated single 1.2x outlier at the two lines fixed below.

Live board check this cycle (56 real SWING board plays, `GET /api/market/nighthawk/horizons?
view=swings` + `GET /api/market/swing/play-brief` per play, two snapshots ~10 min apart) did not
catch a live HELIX ratio landing in the 1.2x–1.3x gap specifically (HELIX pipeline was globally
stale overnight for this entire sample, gating `trustedHelixFlow` off for every play checked), so
this is a code-inspection-confirmed defect with a reproducing unit test, not a live-board repro —
disclosed honestly per this repo's own discipline rather than overstated.

### Fix
Changed the two conditions in `counterThesisLine` (`play-brief-narrative.ts`, HELIX put/call-led
block) from `* 1.2` to `* 1.3`, matching every other call site. Added an in-code comment at the
fixed lines naming the inconsistency and all four sibling call sites, so a future reader sees why
1.3x is the number, not just that it changed.

### Blast radius
Scoped to `counterThesisLine` only — the one function with the drifted constant. No other call
site touched (they were already correct). A HELIX ratio in [1.2x, 1.3x) that previously
steelmanned a counter-thesis reason now correctly reports no HELIX-flow counter-thesis signal,
consistent with every sibling section's "balanced" read of the same data. Ratios ≥1.3x are
unaffected (reason still fires, confirmed by the added test's second assertion).

### Verification
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts` —
  123/123 pass (new test RED pre-fix with the literal old-threshold output captured above, GREEN
  post-fix).
- `npx tsc --noEmit -p .` — clean.
- Full `npm test` — run alongside this fix; see PR CI for the authoritative result.
