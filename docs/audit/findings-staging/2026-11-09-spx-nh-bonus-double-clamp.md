## 2026-11-09 — [FINDING, P2 SPX 0DTE] Night Hawk morning-prior bonus double-clamped `confluence.score` on a saturated setup — FIXED

> **kind:** `FINDING`

**Status.** FIXED — this PR.

### Summary

`GET /api/market/spx/play`'s Night Hawk "morning prior" mutation site
(`src/features/spx/lib/spx-play-engine.ts`, the `if (nhBonus && nhBonus.bonus !== 0)` block) fed the
*already-clamped* `confluence.score` into `reclassifyConfluenceScore`, which clamps again
internally. On a saturated raw factor sum (comfortably reachable — see
`spx-signals.test.ts`'s own golden fixture, raw sum 154) with an *opposing* Night Hawk bonus (always
exactly ±3, per `getNhConfluenceBonus`'s own contract), this double clamp understated how extreme
the correct, single-clamped score should be — by up to the bonus's own ±3 range. `grade`/`direction`/
`agreeing` are then derived from this slightly-wrong score, which can matter right at a grade
boundary (30/45/58/72).

Found via static source trace while auditing the three prior "BUG FIX" comments already stacked at
this exact call site (2026-09-22 grade/direction/agreeing, 2026-10-18 rawScore, 2026-11-01 levels) —
each hardened the mutation site against a different staleness bug, but none addressed this
arithmetic layer. Affects `GET /api/market/spx/play` (via `evaluateSpxPlay` →
`evaluateOpenPlay`/`evaluateFlatPlay`) — **not** `GET /api/market/spx/desk`, which returns the raw
desk payload only and never surfaces `confluence.score`.

### Root cause

`computeSpxConfluence()` (`spx-signals.ts` ~line 915) sums all factor weights into a raw score and
clamps it **once**, as the last step before returning:

```ts
score = clamp(score, -100, 100);
```

The returned `SpxConfluence` carries no unclamped raw-sum field anywhere — only the already-clamped
`score`. `reclassifyConfluenceScore()` (~line 240) independently clamps whatever `score` argument
it's given:

```ts
const clamped = clamp(score, -100, 100);
```

Each function is correct in isolation. The bug was at the call site
(`spx-play-engine.ts`, the NH-bonus mutation block):

```ts
const reclass = reclassifyConfluenceScore(desk, confluence.score + nhBonus.bonus, confluence.factors);
```

This adds the bonus to the **already-clamped** `confluence.score`, then clamps **again** inside
`reclassifyConfluenceScore` — a double clamp. It is only equivalent to the mathematically correct
single `clamp(rawSum + bonus)` when the pre-bonus raw sum was itself already inside `[-100, 100]`.

Concrete example: raw pre-bonus sum = −105 (clamped internally to `confluence.score = -100`), bonus
= +3 (opposing) → double-clamped result = `clamp(-100 + 3) = -97`, while the mathematically correct
single-clamp result is `clamp(-105 + 3) = clamp(-102) = -100`. A genuine, checkable divergence of up
to 3 points (bounded by the bonus's own ±3 range) from the invariant
`score === clamp(sum(factors[].weight), -100, 100)` that `computeSpxConfluence` itself satisfies in
isolation (and that `spx-signals.test.ts` already pins directly).

This is a distinct layer from PR #4574's `spx-confidence-boundary.ts` fix — that one adds an honest
`factor_sum_pre_clamp`/`score_clamp_note` annotation **only** at the Largo tool-calling boundary and
explicitly does not touch the engine or the member-facing `/api/market/spx/play` route.

### Evidence (RED → GREEN)

RED (pre-fix, via a temporary revert of only `spx-play-engine.ts` — the pre-fix line
`confluence.score + nhBonus.bonus` restored from `git show HEAD:...`, both new test files left in
place):

- `spx-play-engine.test.ts`: **20/21 pass, 1 fail** — the new source-text regression test
  ("evaluateSpxPlayCore NH-bonus mutation site recomputes the raw pre-bonus factor sum...") failed
  because the restored source still matched the buggy
  `reclassifyConfluenceScore(desk, confluence.score + nhBonus.bonus, ...)` pattern.

GREEN (post-fix, fix restored):

- `spx-play-engine.test.ts`: **21/21 pass.**
- `spx-signals.test.ts`: **18/18 pass**, including the new numeric test
  ("reclassifyConfluenceScore mutation path: a saturated raw sum + opposing NH bonus...") which
  pins the exact divergence on a concrete fixture (raw sum −105, bonus +3): fixed formula →
  `clamp(-105 + 3) = -100`; buggy formula → `clamp(-100 + 3) = -97`.
- All 10 sibling SPX test files that reference `computeSpxConfluence`/`reclassifyConfluenceScore`
  run together: **125/125 pass.**
- `npx tsc --noEmit` (Node 20.20.2): clean, exit 0.

### Fix

At the NH-bonus mutation site in `spx-play-engine.ts`, recompute the true pre-bonus raw (unclamped)
sum directly from `confluence.factors` **before** pushing the "Night Hawk prior" factor onto it:

```ts
const rawPreBonusSum = confluence.factors.reduce((sum, f) => sum + f.weight, 0);
confluence.factors.push({ label: "Night Hawk prior", weight: nhBonus.bonus, detail: nhBonus.label });
// ...
const reclass = reclassifyConfluenceScore(desk, rawPreBonusSum + nhBonus.bonus, confluence.factors);
```

This keeps the single-clamp invariant (`score === clamp(sum(factors[].weight), -100, 100)`) that
`computeSpxConfluence` already satisfies in isolation, extended correctly through the NH-bonus
mutation path — `reclassifyConfluenceScore` itself needed no change, since it already performs the
single correct clamp on whatever raw value it is given.

**Why this fix and not an alternative:** the task considered adding a new unclamped raw-sum field to
`SpxConfluence`'s return shape (e.g. `rawSumPreClamp`), which would be more explicit, but that
touches `computeSpxConfluence`'s public return shape and every consumer that spreads/serializes it
(the member API route, Largo's `get_spx_confluence` tool, the three shadow-logging call sites
upstream of the mutation). Recomputing the sum locally from the already-available
`confluence.factors` array — the exact same array `reclassifyConfluenceScore` already consumes for
`bullFactors`/`bearFactors`/`weighted_conflicts` — is a smaller, local fix with zero blast radius
outside this one call site. Deliberately left unchanged: `computeSpxConfluence`'s return shape,
`reclassifyConfluenceScore`'s own signature/logic (already correct), and the three prior BUG FIX
layers at this same call site (grade/direction/agreeing reassignment, rawScore, levels) — all still
apply unmodified on top of the corrected score argument.

### Blast radius

One call site: `spx-play-engine.ts`'s NH-bonus mutation block, reached from `evaluateSpxPlay` →
`evaluateOpenPlay`/`evaluateFlatPlay` → `GET /api/market/spx/play`. No other caller passes a
post-hoc score mutation into `reclassifyConfluenceScore` — it is otherwise only exercised directly
in tests. `computeSpxConfluence`'s own single-clamp behavior (verified correct, unchanged) and
`reclassifyConfluenceScore`'s own clamp (verified correct, unchanged) are both untouched; the fix is
purely in what value feeds the second clamp. `GET /api/market/spx/desk` is unaffected (never
surfaces `confluence.score`).

### Regression tests added

- `src/features/spx/lib/spx-signals.test.ts` — "reclassifyConfluenceScore mutation path: a saturated
  raw sum + opposing NH bonus needs a SINGLE clamp(rawSum + bonus), not a double clamp through the
  already-clamped score." Pins the exact numeric divergence (−105/+3 → fixed −100 vs buggy −97) using
  the real, unmodified `reclassifyConfluenceScore`.
- `src/features/spx/lib/spx-play-engine.test.ts` — "evaluateSpxPlayCore NH-bonus mutation site
  recomputes the raw pre-bonus factor sum from confluence.factors, not the already-clamped
  confluence.score." A source-text regression guard (same idiom this file already uses for the
  adjacent `getNhConfluenceBonus` staleness check and the closed-market mixed-tape wiring, both
  equally hard to drive end-to-end without the heavy DB/provider mocking this suite's own header
  explicitly avoids) — asserts the real mutation site's literal code implements the fixed formula,
  not the buggy one. This is the test that actually goes RED against the pre-fix source (see
  Evidence above).
