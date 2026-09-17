> **kind:** `FINDING`

## Vector commit boost inflated a CONDOR's score against its own nominal fade direction — FIXED

| | |
|---|---|
| **Area** | 0DTE — Vector ↔ 0DTE commit boost / Iron Condor |
| **Severity** | P2 (structural correctness defect that feeds a hard gate; live magnitude not separately measured, see below) |
| **Status** | FIXED |
| **Files** | `src/lib/zerodte/vector-commit-boost.ts`, `src/lib/zerodte/vector-commit-boost.test.ts`, `src/lib/zerodte/scan.ts` |

### Root cause

Found while investigating the sibling Cortex-layer defect
(`docs/audit/findings-staging/2026-09-17-cortex-condor-nominal-direction-misread.md`) — same
audit pass, same commit loop in `scan.ts`, one call earlier.

`condor.ts` stamps a CONDOR setup's `direction` as **nominal fade provenance only**
(`// nominal provenance only — the condor is delta-neutral`), but `scan.ts`'s commit loop called
`computeVectorGateBoost(s.direction, s.score, pulse)` **unconditionally for every setup**,
condors included, in two places that feed the score used for hard-gate evaluation:

```ts
const boost = computeVectorGateBoost(s.direction, s.score, pulse);
let gateScore = boost.score_bump > 0 ? Math.min(100, Math.round(s.score + boost.score_bump)) : s.score;
if (boost.score_bump > 0) s.score = gateScore;
...
const postBoost = computeVectorGateBoost(s.direction, gateScore, pulse);
```

`computeVectorGateBoost` asks "does Vector's live directional pulse for this ticker agree with
this setup's direction?" and, if so, adds +8 (winner) or +4 (runner) to the score and grants a
G-17/G-8 exemption. For a condor, "agreement" with a nominal fade direction the structure was
never actually betting on is coincidence, not corroboration — but the bump was applied anyway,
and **the inflated score feeds `evaluateZeroDteGates`'s G-3 score-floor and G-18 early-window
floor, neither of which is condor-exempt** (unlike G-17, which the gate stack itself already
skips for condors — `gates.ts`: `if (!isCondor && input.score >= 65 && input.score < 70)`). The
bump is purely additive (only ever raises the score, never lowers it), so the practical effect
was always in one direction: a condor could clear G-3/G-18 on evidence about a direction it
structurally does not hold.

### Why it wasn't caught in the earlier condor-direction sweep

Same reason as the Cortex sibling finding: `vector-commit-boost.ts` has zero
`condor`/`is_condor`/`play_type` references anywhere in the file, so nothing signaled it needed
condor awareness without reading the actual call-site arguments in `scan.ts`'s commit loop.
`gates.ts` is carefully condor-aware at nearly every gate (`isCondor` guards on G-1, G-7, G-14,
G-17, the G-8/G-9/G-10 liquidity-gate swap) — but the SCORE fed into those gates is computed
*before* `evaluateZeroDteGates` runs, in a separate module the gate-level condor-awareness sweep
never touched.

### What was checked and left alone (scope discipline)

Two further `computeVectorGateBoost(s.direction, ...)` call sites remain in `scan.ts`
(the post-commit A-tier-upgrade / `runnerConfluenceCount` block, ~line 1830/1836). These run
*after* the commit/reject decision, feed only `exit_policy_at_commit`/`runner_profile` metadata,
and condor exit management is entirely separate (`condor.ts`'s own `gradeCondorFromBars`, which
never reads `exit_policy_at_commit`) — per `scan.ts`'s own comments elsewhere ("the condor path
never reaches this block"), this metadata is structurally inert for a condor row. Left unfixed
deliberately to keep this PR scoped to the one call path that actually affects a real gate
decision; not itself a live bug, just adjacent dead-for-condor code already following the
established "condor fields are permanently null/unused" pattern documented elsewhere in
`scan.ts`.

`regimeScoreBump`/`planChaseContextFromSetup` (regime-commit-relief.ts) were also checked: this
bump requires `tapeBacked(discovery_origin)` (FLOW or BREAKOUT only), and a condor's only
discovery origin is PIN — so this bump structurally can never fire for a condor regardless of
direction. No fix needed there.

### Fix

Added `computeVectorGateBoostForPlayType(playType, direction, score, pulse)` to
`vector-commit-boost.ts` — wraps `computeVectorGateBoost`, returning a zero/no-op boost
(`{score_bump: 0, g17_exempt: false, confluence_credit: 0, reason: null}`) when
`playType === "CONDOR"`, otherwise delegating unchanged. `scan.ts`'s two gate-score-feeding call
sites now use the wrapper. Put the check in a small reusable helper (rather than inlining the
condition twice in `scan.ts`) so every future call site gets it for free and the test coverage
lives next to the function it guards.

### Blast radius

Two call sites in `scan.ts`'s commit loop, both fixed. The two post-commit call sites are
structurally inert for condors (see above) and left unchanged.

### Regression test

`src/lib/zerodte/vector-commit-boost.test.ts` — two new tests: a CONDOR gets zero boost even
with a perfectly aligned Vector winner, and a DIRECTIONAL setup (or `null`/`undefined` play type)
is byte-identical to calling `computeVectorGateBoost` directly. RED→GREEN proven via `git stash`
on `vector-commit-boost.ts`/`scan.ts` only (2 fail pre-fix, 0 fail post-fix). `tsc --noEmit`
clean. Full `scan.test.ts` + `vector-commit-boost.test.ts` + `condor.test.ts` (97 tests) green
on Node 20.

### Live impact — not separately measured

Same caveat as the sibling Cortex finding: the separate 0-condor-commits-in-90-days
investigation traced the near-total rejection rate to the hard-gate funnel (condor
liquidity/range gates + G-13), not to this score-inflation path specifically. This fix corrects
a real defect for whatever slice of condor candidates reach G-3/G-18 with a Vector-aligned
nominal direction, but its magnitude on the live commit count was not separately quantified —
consistent with this audit pass's discipline of not overstating live impact beyond what was
actually measured.
