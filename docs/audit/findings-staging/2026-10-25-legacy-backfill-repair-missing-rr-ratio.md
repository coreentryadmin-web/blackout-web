## 2026-10-25 — [FINDING, P2 Night Hawk Legacy / Ask Largo] `repairStaleBackfillPlays` re-picks a dead BACKFILL contract but never backfills a missing `rr_ratio` — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | `nighthawk-backfill-repair` self-heal cron's pure repair function, `repairStaleBackfillPlays` (`src/features/nighthawk/lib/play-backfill.ts`) |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — parallel correctness sweep, 2026-10-25, following up on the earlier same-day `selectBackfillPlays` rr_ratio fix (#6679) |

### Symptom

`repairStaleBackfillPlays` re-picks a live replacement options contract for a BACKFILL play whose
own contract has expired relative to `editionFor` (the 2026-10-24 PLTR self-heal fix, #6665). It
only overwrites `options_play`/`entry_premium` on the play it's repairing. Any edition published
**before** the earlier same-day `selectBackfillPlays` fix (#6679 — which stopped
`mapClaudePlayToEdition` from silently dropping `rr_ratio` for new BACKFILL plays) shipped can
still carry a BACKFILL play with no structured `rr_ratio` at all. Repairing its dead contract does
nothing to fix that: a reader gated on `play.rr_ratio != null` (`PlaybookBriefingPanel.tsx`'s "R:R"
stat, `play-explainer.ts`'s "Risk/reward ratio: X" line — the same two consumers #6679 named) keeps
silently omitting the field even after the self-heal cron has "fixed" the play.

### Root cause

`rr_ratio` and the options contract are independent facts about a play: `rr_ratio` is computed from
the STOCK-level `direction`/`entry_range`/`target`/`stop` via `computeRiskReward`
(`play-levels.ts`), never from the option's strike/premium. Swapping a dead contract for a live one
touches none of those four fields, so it structurally cannot regenerate a missing `rr_ratio` as a
side effect — the repair pass needed to compute it explicitly, and didn't.

### Fix

`repairStaleBackfillPlays` now backfills a missing `rr_ratio` via `computeRiskReward`, using the
play's own already-present `direction`/`entry_range`/`target`/`stop` — the exact same inputs and
function `selectBackfillPlays` already uses for newly-created BACKFILL plays. Guarded with
`play.rr_ratio ?? computeRiskReward(...) ?? undefined`: an already-correct `rr_ratio` (any play
created after #6679) is left untouched, never silently recomputed and replaced.

### Blast radius

Scoped to `repairStaleBackfillPlays` only — `selectBackfillPlays` (the other producer of
BACKFILL-tier plays, already fixed by #6679) and the organic-path builders (`buildPlay`/
`buildRescuePlays`, which always compute `rr_ratio` directly) are untouched. No other caller of
`repairStaleBackfillPlays` or `repairStaleBackfillContracts` exists repo-wide besides
`republishBackfilledEdition` (`post-publish-backfill.ts`), which passes the repaired plays straight
through to `upsertNighthawkEdition` unmodified.

### Tests

- `play-backfill.test.ts` — 2 new tests: backfills a missing `rr_ratio` matching `computeRiskReward`
  exactly on the play's own existing levels (confirmed RED on pre-fix code, GREEN after); leaves an
  already-correct `rr_ratio` untouched rather than recomputing it.

Full `src/features/nighthawk/**/*.test.ts` (2091 tests) and `npx tsc --noEmit` both pass clean.
