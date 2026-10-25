## 2026-10-25 — [FINDING, P2 Night Hawk Swings / Ask Largo] "Setup score" evidence[] fact stamped read-time `asOf` for a commit-pinned value — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Swing play-brief evidence array builder, `evidenceFromContext` (`src/lib/swing/play-brief.ts`) — the "Setup score" fact added earlier today by the OUST-style score evidence-gap fix (#6481) |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — parallel correctness sweep + adversarial verify pass, 2026-10-25 |

### Symptom

The "Setup score" evidence fact (`Setup score: 72 (Rel. strength +18, Regime +12).`) carries
`provenance: { source: "Swing ledger", asOf: ctx.asOf, freshness: "recent" }`. `ctx.asOf` is the
brief's own read/composition timestamp — "now", every time the brief is composed. But `play.score`
and `play.factors` are a COMMIT-TIME snapshot (the frozen `feature_vector.evidence_score`, per
`scoreWithheld`'s own doc comment in `closed-plays.ts`) that is never recomputed on a later read. A
play committed days or weeks ago would have its score cited as `freshness: "recent"` forever —
the exact dead-wired-timestamp shape the 2026-10-07 `pinnedProvenance` fix for WATCH levels
(anchored to `play.detectedAt` instead of `ctx.asOf`) already corrected for a sibling fact in the
same function.

### Root cause

`evidenceFromContext` had access to the real pin timestamp (`ctx.play.committedAt`) but stamped
the generic read-time `ctx.asOf`/`"recent"` instead, the same "convenient but wrong" default every
other fix in this file traces back to a commit-time fact being treated as read-time.

### Fix

Anchored the "Setup score" fact's provenance to `ctx.play.committedAt`: `asOf` now uses
`etStampFromIso(ctx.play.committedAt) ?? ctx.asOf` (falls back only when `committedAt` is
genuinely absent), and `freshness` is computed via `freshnessFromObservedMs(committedMs, readMs)`
instead of the hardcoded `"recent"` — identical pattern to the WATCH-levels `pinnedProvenance`
fix a few hundred lines above in the same file.

### Blast radius

Scoped to this one evidence fact. The sibling "concurrent live position(s)" fact a few lines above
(line ~1659) legitimately uses `ctx.asOf` — it's a live count read fresh every composition, not a
commit-pinned value, so it was correctly left untouched.

### Tests

- `play-brief.test.ts` — new test: a score committed 2 real days before the brief's `asOf` must
  cite the commit timestamp (not the read timestamp) and read `freshness: "stale"`, never
  `"recent"`. Confirmed RED on pre-fix code via `git stash` (asserted asOf fell back to `ctx.asOf`),
  GREEN after. The pre-existing test (fixture has no `committedAt`) is unaffected — the fallback
  path reproduces its exact prior behavior.

Full `src/lib/swing/*.test.ts` (2044 tests) and `npx tsc --noEmit` both pass clean.
