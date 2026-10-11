## 0DTE `isSingleRailWithoutFlow` — dead code left behind by G-17's score-band restructure — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/zerodte-dead-single-rail-predicate) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `isSingleRailWithoutFlow` (`src/lib/zerodte/gates.ts`) was the rail-composition
predicate G-17 originally used ("single-rail-without-flow needs the 75 prime floor; multi-rail/FLOW
is exempt in 65-74"). The 2026-09-09 operator-approved CTO gate-architecture review (see
`docs/audit/FINDINGS.md`'s "G-17's 75-floor exemption... removed" entry, and the RESTRUCTURED
comment directly above G-17's current code in `gates.ts`) replaced that whole rail-composition
check with a pure score-band architecture (<65 reject / 65-69 unconditional reject / 70-74
conditional on confluence+tape+VIX+execution / 75+ prime) that reads only `input.score` — it never
consults `discovery_origin` at all anymore. The restructure correctly updated G-17's block logic but
left the now-orphaned predicate function sitting in the file.

**Evidence:** `grep -rwn "isSingleRailWithoutFlow" --include=*.ts --include=*.tsx src scripts docs`
→ only the function's own definition and 3 assertions in `gates.test.ts` (which tested the function
directly, not anything it fed into — `evaluateZeroDteGates`'s actual G-17 block condition
(`gates.ts`, the `score >= 65 && score < 70` / `70 <= score < 75` checks) never calls it). The paired
constant `ZERODTE_SINGLE_RAIL_PRIME_MIN` is still read by that same gate logic and is untouched.

**Fix:** Removed `isSingleRailWithoutFlow` from `gates.ts`. Removed its import and the 3 direct
assertions from `gates.test.ts`'s G-17 test (the test's real coverage — asserting
`ZERODTE_SINGLE_RAIL_PRIME_MIN` and running real candidates through `evaluateZeroDteGates` across the
65-69/70-74/75+ bands — is untouched and still the thing that actually exercises G-17).

**Fix rationale:** Deletion only — no behavior change, since the function had no caller in the real
gate path. Left `ZERODTE_SINGLE_RAIL_PRIME_MIN` and every other G-17/G-18 constant/comment alone;
this finding is scoped to the one orphaned predicate, not a broader G-17 audit.

**Blast radius:** `src/lib/zerodte/gates.ts`, `src/lib/zerodte/gates.test.ts` only. No other file
imported this function.

**Regression guard:** `gates.test.ts` — 208/208 pass (Node 20, `--experimental-test-module-mocks`).
`tsc --noEmit` clean.
