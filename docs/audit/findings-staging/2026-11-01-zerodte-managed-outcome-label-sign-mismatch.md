> **kind:** FINDING

## 0DTE record: `managedOutcomeLabel` can render a self-contradictory outcome label vs. the real realized sign — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** five-engine-largo-cycle-57 live audit (2026-11-01, `check:zerodte` agent), per the
standing 5-engine live monitor mandate. Cross-checked against `GET /api/market/zerodte/record?days=90`
(production): 589 graded plays, grading-math identity holds (wins+losses+breakeven==graded), but
2/589 rows (0.34%) carry a `managed_outcome` label that contradicts the row's own realized sign.

**Root cause:** `src/lib/zerodte/record.ts`'s `managedOutcomeLabel(reason, pnl)` maps an engine
exit's `reason` to an outcome label purely by `categorizeExitReason` category (`"stop"→"stopped"`,
`"target"→"doubled"`, etc.), with no check against the realized `pnl` sign — unlike the
function's own `reason == null` branch, which correctly falls back to a bare win/loss/breakeven
label by sign (`bySign`). But two of these categories have an unambiguous implied sign:
- `"stop"` is **exclusively** `reason === "plan_stop"` (`categorizeExitReason`,
  `exit-engine.ts:1073-1090`), which only ever fires when `currentMark <= input.planStop`
  (`exit-engine.ts:787`) — the fixed -50% plan stop. A positive realized pnl under this reason is
  structurally impossible for a genuine stop-out.
- `"target"` covers `plan_target*`/`trim_scale*` reasons (dead-zone floor excluded) — exclusively
  profit-taking exits; a non-positive pnl under this reason is the symmetric contradiction.

**Live evidence from the 90-day pull (2026-11-01):**
- `plays[588]` META, session 2026-08-03: `managed_pnl_pct=+3.41`, `managed_outcome="stopped"` —
  a real win rendered under the "stopped" (loss) family. Traced to the `entryBasisDiverged`-era
  bug (fixed going forward 2026-08-06, `exit-sync.ts:427-430`, per `FINDINGS.md:126965`) that
  caused `plan_stop` to fire off a diverged basis for this specific frozen row — the row's
  `entry_context.exit` is intentionally frozen-at-commit and never rebuilt, so every future read
  of `/record` (and therefore Largo's `get_zerodte_record`) kept rendering the contradiction.
- `plays[336]` QQQ, session 2026-09-10: `managed_pnl_pct=-2.27`, `managed_outcome="ratchet"` —
  also pre-existing frozen data (the `resolveExitMark`/`honored` rounding-boundary bug,
  `exit-engine.ts` doc comment near `ratchetFloorPct`), but **not** touched by this fix: ratchet
  mode has no clean universal sign guarantee (a floor armed near breakeven can still close at a
  small loss by design), so adding a sign guard there risks mislabeling legitimate data. Only the
  two categories with an unambiguous invariant (`stop`, `target`) are guarded.

**Fix:** added a sign check inside the `"stop"` and `"target"` branches — falls back to `bySign`
when the category-derived label's implied sign disagrees with the real `pnl`, same discipline as
the function's existing `reason == null`/unrecognized-category fallback. Read-time reconciliation
only (same pattern as `clampManagedPnlToPeak`/`withRoundedTrailingRuleDisplay` elsewhere in this
file) — never mutates the frozen `entry_context.exit` data, only the label a future read renders.
`"ratchet"`/`"thesis"`/`"flat"` categories deliberately left unguarded (no clean sign invariant to
check against).

**Evidence (RED → GREEN):** added 4 test cases to `src/lib/zerodte/record.test.ts` (2 contradiction
cases matching the live evidence shape, 2 confirming a genuine stop-loss/target-win still labels
correctly). RED (via `git stash` on `record.ts` alone): 2 failing — a positive-pnl `plan_stop` row
still labeled `"stopped"`, a non-positive-pnl `plan_target_final` row still labeled `"doubled"`.
GREEN (post-fix): `npx tsx --experimental-test-module-mocks --test record.test.ts` → 49/49 pass.
`npx tsc --noEmit`: clean.

**Blast radius:** `managedOutcomeLabel` has two call sites in this file (`line ~208` and the
`managedGradeView`'s `source: "engine"` branch, `~line 566`) — both fixed at the single shared
function. Feeds `plays[].managed_outcome` and the `by_outcome` bucket key
(`record.ts`'s `bucketize`), so both are corrected for any future row whose frozen exit data
predates one of these upstream fixes. Scope: 2 of 589 rows (0.34%) in the audited 90-day window;
the top-level win/loss math (`wins+losses+breakeven==graded`) was already correct before this fix
— only the per-row label and `by_outcome`'s per-bucket breakdown were affected.
