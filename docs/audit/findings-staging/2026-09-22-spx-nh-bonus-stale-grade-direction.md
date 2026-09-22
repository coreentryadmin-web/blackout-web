> **kind:** FINDING

### 337. SPX Slayer: Night Hawk "morning prior" bonus mutated confluence.score without recomputing grade/direction/agreeing — fix/spx-nh-bonus-stale-grade-direction — 2026-09-22

| **Status** | FIXED |
|---|---|

- **What was broken:** `spx-play-engine.ts` applies the Night Hawk morning-prior bonus (a signed
  confluence factor bounded ±3 by `getNhConfluenceBonus`'s own contract) by mutating an
  already-built `SpxConfluence` object in place — `confluence.score += nhBonus.bonus` and
  `confluence.factors.push({ label: "Night Hawk prior", ... })` — but never recomputed
  `grade`/`direction`/`agreeing`/`conflicts`/`weighted_conflicts`. Those fields were derived once,
  inside `computeSpxConfluence` (spx-signals.ts), from the PRE-bonus score/factors, then frozen
  into the returned object. `evaluatePlayGates` (spx-play-gates.ts) reads `confluence.grade` and
  `confluence.direction` directly — not re-derived from score — so a play could be gated (grade
  minimum, mixed-tape threshold, `agreeing` factors check, direction null-check) against a stale
  classification while `confluence.score` itself already reflected the bonus. Worse,
  `evaluateMtfHybrid(direction, keyLevel, technicals, confluence.grade, confluence.score)` is
  called with the STALE grade and the ALREADY-MUTATED score in the same call — a mismatched pair
  feeding `soft3mAllowed(grade, score)`'s soft-pass eligibility check directly.
  Grade thresholds sit at abs score 30/45/58/72 (`scoreToGrade`), and the bonus is bounded at ±3,
  so a boundary score (e.g. 57→60, crossing the 58 A-grade threshold) is a real, reachable case —
  not a hypothetical one. Similarly the null/non-null direction boundary sits at abs score 10; a
  score of 8→11 crosses it and would leave `direction` frozen at `null` post-bonus.
  `agreeing` alone was accidentally shielded from this staleness: `spx-play-gates.ts` happens to
  recompute its own local `agreeing` from `confluence.factors` (a pre-existing, unrelated
  duplication of the same field) rather than trusting `confluence.agreeing`, so it picks up the
  newly-pushed "Night Hawk prior" factor even though the frozen `confluence.agreeing` field itself
  does not. `grade`/`direction`/`conflicts`/`weighted_conflicts` had no such accidental safety net.
- **Evidence:** `git stash` of the fix (keeping the new tests) reproduces the failure — 2/7 tests
  in `spx-signals.test.ts` fail with `reclassifyConfluenceScore is not a function` pre-fix; all 7
  pass post-fix (`npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-signals.test.ts`).
  New unit tests assert: (1) a fixture at score 57 (factors summing to abs 57, 0 conflicts) grades
  "B"; the same factors + a +3 Night Hawk prior bonus at score 60 must reclassify to "A", not stay
  frozen at "B"; `agreeing` must include the newly-pushed factor. (2) a fixture at score 8 (abs <
  10) has `direction: null`; the same + a +3 bonus at score 11 must reclassify `direction: "long"`.
- **Blast radius:** every consumer of `confluence.grade`/`confluence.direction`/`confluence.agreeing`/
  `confluence.conflicts`/`confluence.weighted_conflicts` downstream of the Night Hawk prior mutation
  in `spx-play-engine.ts` — both `evaluateFlatPlay` (via `evaluatePlayGates`, `evaluateMtfHybrid`)
  and any headline/thesis text built from `confluence.grade`/`direction` further downstream in the
  same function. Nothing outside `spx-play-engine.ts` mutates `confluence.score` post-build, so this
  is the only call site affected.
- **Fix rationale:** added `reclassifyConfluenceScore(desk, score, factors)`, an exported pure
  function in `spx-signals.ts` that mirrors `computeSpxConfluence`'s own bias/action/grade/
  direction/agreeing/conflicts derivation (same thresholds, verified via the new tests), and called
  it in `spx-play-engine.ts` right after the score/factors mutation, reassigning every field it
  returns together — so score and its derived classification can never disagree again. Deliberately
  did NOT refactor `computeSpxConfluence` itself to call this new helper internally (it has its own
  tight byte-for-byte regression test guarding untouched behavior); the new function intentionally
  duplicates the classification logic with a code comment cross-referencing the original, rather
  than risk touching a heavily-tested working code path for an unrelated bug fix.
- **In-code comments**: both the new function (spx-signals.ts) and its call site
  (spx-play-engine.ts) carry a full trace of the bug and why every field must be reassigned
  together, not just `score`.

**Market-open validation**: see `docs/audit/MARKET-OPEN-VALIDATION.md` for the RTH check to run
next session.
