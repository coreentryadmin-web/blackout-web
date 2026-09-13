> **kind:** FINDING

## Swing thesis-health's Persistence pillar showed stale point values after a manage-action degrade — its own row contradicted itself — fix/swing-thesis-health-persistence-recompute — 2026-09-13

- **What was broken (found by a parallel audit workflow's Ask Largo × Night Hawk Swings deep-dive,
  live 2026-09-13):** `computeSwingThesisHealth()` (`src/lib/swing/thesis-health.ts`) builds five
  pillars, computing each one's `contributionPts`/`deltaPts` from its `currentScore` at construction
  time — **before** `degradeFromManage()` runs. `degradeFromManage()` then mutates the Persistence
  pillar's `currentScore`/`status`/`currentLabel` directly on the same array when the live
  `manageAction` is `EXIT`/`STOP_OUT` (→ `currentScore: 0`, `status: "lost"`, `currentLabel: "exit
  signal"`) or `TAKE_PARTIAL`/`EXIT_RUNNER` (→ `currentScore` capped at 0.55, `status: "faded"`,
  `currentLabel: "scale-out"`) — but `contributionPts`/`deltaPts` were never recomputed afterward.
  The result: a pillar row could display `status: "lost"`, `currentLabel: "exit signal"`,
  `currentScore: 0` (all correctly updated) alongside a `contributionPts` still showing its OLD,
  pre-degrade positive value and a `deltaPts` reflecting a much smaller (or even positive) change
  than the real drop to zero — the SAME pillar's own fields contradicting each other on the same
  row. The aggregate `health` score itself was never affected (it always summed the post-mutation
  `currentScore` straight off `pillars`) — only each pillar's own displayed point values were stale.
- **Blast radius:** `src/lib/swing/play-brief-narrative-coaching.ts`'s `thesisPillarCoaching()` (the
  Ask Largo brief's "Pillar fade" narrative) reads `p.deltaPts` directly off the SAME shared
  `ThesisHealthPayload` to pick the worst-faded pillar and narrate its "Δ ±N pts" — it does not
  recompute anything itself, so it inherited the identical stale-delta bug for any play whose
  Persistence pillar had just been degraded by a manage action. No separate fix needed there: it
  consumes the shared payload, so fixing the one source of truth in `thesis-health.ts` fixes both
  consumers.
- **What changed:** pillar construction now stamps `contributionPts`/`deltaPts` as placeholders,
  runs `degradeFromManage()`, then a final pass recomputes `contributionPts = round(weight ×
  currentScore × 100)` and `deltaPts = round(weight × (currentScore − commitScore) × 100)` for
  every pillar from its own (possibly-mutated) `currentScore`/`commitScore`/`weight` — the exact
  same formula, just re-run after the mutation instead of before it. `commitScore` is never touched
  by `degradeFromManage`, so this recompute is safe for every pillar, degraded or not.
- **Fix rationale:** recomputing generically for all five pillars (rather than special-casing only
  Persistence) costs nothing extra and is robust if `degradeFromManage` is ever extended to mutate
  another pillar — no future caller needs to remember to add a second recompute site.
- **Evidence:** `src/lib/swing/thesis-health.test.ts` — two new tests: an EXIT-degraded Persistence
  pillar's `contributionPts` must be exactly 0 (matching its degraded `currentScore` of 0) and its
  `deltaPts` must equal `round(weight × (0 − commitScore) × 100)`, not the smaller pre-degrade
  value; a TAKE_PARTIAL-degraded pillar's points must match its capped `currentScore`. RED→GREEN
  confirmed via `git stash` on `thesis-health.ts` (both new tests failed pre-fix, passed post-fix).
  Full suite 14060/14060 pass (3 pre-existing unrelated skips), `tsc --noEmit` clean.
- **Not attempted here:** touching `degradeFromManage`'s own degrade rules (the 0 / 0.55 cap
  values, or which manage actions trigger it) — those are unrelated calibration decisions; this fix
  is scoped purely to making the already-degraded score's DERIVED display fields consistent with it.

| **Status** | Fixed — PR opened, CI pending |
