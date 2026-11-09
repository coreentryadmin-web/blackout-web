# Swing `closedReason` discards the real gating rung, so "stopped"/"target" is asserted as if it names the mechanism when it may not

> **kind:** `FINDING`

### Summary
`evaluateSwingManagement` (`src/lib/swing/manage.ts`) computes one of four genuinely distinct
gating rungs when a live swing position is force-closed: `structural_stop` (underlying crossed the
pinned invalidation level), `thesis_stop` (an archetype-specific pillar-invalidation signal,
unrelated to the invalidation price), `premium_stop` (the -60% capital-preservation backstop), or
`expiry_risk` (a DTE theta-cliff forced close, independent of thesis health or P&L sign). That real
rung reached `decideRollAction` (`src/lib/swing/roll.ts`), which even built a descriptive reason
string from it — but that string was only ever `console.info`'d, never persisted. The terminal DB
write (`gradeParentFromMark` → `gradeSwingPosition`) stamped only price mechanics into `grade_json`
(entry/exit premium, realized P&L%, mark provenance) — the triggering rung itself was nowhere in
the persisted grade.

`closedReasonFromRow` (`src/lib/swing/closed-plays.ts`) then reconstructed a label purely from the
**sign** of `realized_pnl_pct`: positive → `"target"`, negative → `"stopped"`, exactly 0 →
`"flat"`. All four distinct close mechanisms collapsed into whichever of those three a coin-flip
sign happened to land on — and a gating rung can fire regardless of P&L sign at the moment it
fires (a thesis break can happen while the position is still slightly green), so the guess could
be wrong in both directions, not just "stopped" vs the real mechanism.

The narrative then treated the fabricated-precision label as if it specifically named the
structural stop. `play-brief-intel.ts`'s Lessons section and `play-brief-narrative-coaching.ts`'s
closed-play coaching both gate on `closedReason === "stopped"` and render structural-invalidation-
specific framing ("check if invalidation level was respected") for **every** negative close,
regardless of whether the real trigger was a thesis-pillar break (unrelated to the invalidation
price), a capital backstop, or a DTE cliff. Live verification (`GET /api/market/swing/record`):
MRNA positionId 65 closed `realized_pnl_pct=-34.47%` — nowhere near the -60% `premium_stop`
threshold, so almost certainly a `thesis_stop` or `structural_stop` — with `closedReason="stopped"`
asserting the structural framing regardless.

### Root cause
Exactly as described above — the real rung was computed and even transiently logged, but never
survived past `decideRollAction`'s return value into the position's terminal `grade_json`.

### Fix
Additive, two-file change:
1. `gradeParentFromMark` (`src/lib/swing/roll-plan.ts`) takes a new optional `closingRung` param
   and stamps it into `grade_json.closing_rung` when supplied. `buildSwingRollPlan` passes
   `verdict.rung` (the real gating rung — only ever one of the four `GATING_RUNGS` values at this
   call site, since `decideRollAction` only reaches CLOSE/ROLL for those) at its one call site.
   Omitted entirely (no key at all) when the caller supplies nothing, so a direct-call test or a
   row graded before this field existed never gets a fabricated/undefined placeholder.
2. `closedReasonFromRow` (`src/lib/swing/closed-plays.ts`) reads `grade_json.closing_rung` first:
   `thesis_stop` → `"thesis"`, `structural_stop` → `"stopped"`, anything else (`premium_stop`/
   `expiry_risk`) → the raw rung name (an honest generic label — no dedicated narrative branch
   exists for them yet, so they never claim a mechanism they don't have). Only when the rung is
   absent (a row graded before this field existed, or any closing path that doesn't thread it
   through) does it fall back to the exact pre-existing sign-based guess — strictly additive, zero
   regression on historical data.
3. **No narrative-file changes needed.** Both `play-brief-intel.ts`'s Lessons section and
   `play-brief-narrative-coaching.ts`'s closed-play coaching already have a dedicated
   `closedReason === "thesis"` branch with correct, specific coaching text ("Thesis break exit —
   pillar degradation was the signal; review which pillar failed first.") — it was simply
   unreachable for swing before this fix, since `closedReasonFromRow` never produced that value.
   The fix makes it reachable; the text itself needed no changes.

### Evidence
- RED: new/extended tests in `roll-plan.test.ts` (stamps the rung into `grade_json`, omits the key
  when none supplied, threads through on both the CLOSE and ROLL happy paths) and
  `closed-plays.test.ts` (reports the real rung even against a contradicting P&L sign; falls back
  to the sign guess when no rung is recorded) fail against pre-fix source (`git stash` of just
  `roll-plan.ts`/`closed-plays.ts`): 63/68 pass, 5 fail.
- GREEN: same files, 68/68 pass post-fix.
- Full `src/lib/swing/*.test.ts` regression: 2289/2289 pass.
- `npx tsc --noEmit` clean project-wide.

### Blast radius
`src/lib/swing/roll-plan.ts` (the one write site — `gradeParentFromMark`) and
`src/lib/swing/closed-plays.ts` (the one read site — `closedReasonFromRow`). The sibling
chain-composite mapper (`closedDeckSourcesFromChains`, same file) derives its own label from the
chain's worst-leg outcome rather than calling `closedReasonFromRow`, and attributing the real rung
there requires identifying which LEG in a multi-leg rolled chain is the worst one — a separable,
more complex problem — left as a follow-up, not fixed here, per the standing "never guess"
discipline. Severity P3 — a narrative-honesty gap in post-close coaching, not a crash or anything
affecting live position sizing/risk (the fix only changes which label is applied to an already-
closed position's history).

| **Status** | FIXED — this PR. |
