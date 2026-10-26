## Night Hawk (Legacy): BACKFILL-tier `gate_warnings` cited the governor-penalized `effectiveMeritScore` while every other "score" on the same play card cites the raw `scored.score` — contradictory numbers, unreconciled

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit, Ask Largo × Night Hawk Swings standing ownership mandate ("Add the complete Night Hawk product like everything.. 0dte, Swings, Legacy into your hourly items"), 2026-10-26 |
| **Scope** | `src/features/nighthawk/lib/play-backfill.ts` (`selectBackfillPlays`, the only `gate_warnings`-producing call site across `play-backfill.ts`/`deterministic-edition.ts`/`edition-builder.ts` that embeds a numeric score at all) |

### Root cause

`effectiveMeritScore(scored)` (`edition-quality.ts:130`, `scored.score - (scored.govPenalty ?? 0)`)
is the cross-edition sector-concentration-governor-adjusted score — used ONLY for ranking/
selection order (`selectBackfillPlays`'s own pool sort, `countRankedClearingMerit`, etc.). Every
other place a play's score reaches the member cites the RAW, un-penalized `scored.score`:

- `play.score` itself (`mapClaudePlayToEdition`'s `pinnedScore`, from `claude-edition.ts:49`, which
  reads `dossier?.scored?.score` — the raw field).
- `nhTierInputFromScored` (`nighthawk-tiers.ts:215`) — feeds `tier.factors` prose, e.g. "Score 39
  is under 40 — below the measured viability threshold."
- `PlaybookBriefingPanel.tsx` — both the "Desk score" `BriefingScoreBar` section (line 112-117,
  `score` prop) and the "Raw score" section (line 239-244, `Desk score {play.score}`) render
  `play.score` (raw).
- `play-explainer.ts:84` (`` `Score: ${play.score}` ``) — fed to the Largo/AI play-explainer LLM
  prompt.

`play-backfill.ts:296` was the lone exception: it built its `gate_warnings` entry as
`` `Ranked-pool merit fill (#N by score ${Math.round(effectiveMeritScore(scored))}) — verify entry
geometry before acting` `` — citing the penalized number, unlabeled as anything other than "score".

**Live repro** (`GET /api/market/nighthawk/edition`, `edition_for=2026-10-26`): PLTR
(`selection_tier: "BACKFILL"`, `gate_promoted: true`) carried `score: 39` and
`tier.factors: [{detail: "Score 39 is under 40 — below the measured viability threshold."}]`, but
`gate_warnings: ["Ranked-pool merit fill (#3 by score 24) — verify entry geometry before acting"]`.
39 vs 24 is a real 15-point governor penalty (confirmed against the formula, not a rounding
artifact) — nothing anywhere on the play card told the reader these are two different numbers
measuring two different things.

**Both are member-facing in the same panel**: `PlaybookBriefingPanel.tsx` renders "Desk score 39"
in one `BriefingSection` and `play.gate_warnings` verbatim ("...by score 24...") in the adjacent
"Gate caveats" section, so a member reading top-to-bottom sees two contradicting scores for the
identical play with no reconciliation. The same raw score (39) also feeds the Largo/AI
play-explainer prompt ("Score: 39"), so the LLM-generated narrative and the gate-caveat text could
disagree too.

Blast radius checked: `deterministic-edition.ts` and `edition-builder.ts`'s own `gate_warnings`
sites (rescue-play hedge warnings, critic-rejection warning) were inspected and confirmed to embed
no numeric score at all — the contradiction was isolated to this one call site.

### Fix

`play-backfill.ts:296` now always cites the raw `scored.score` first (matching every other
"score" display for the same play, never disagreeing with it), and — only when the governor
actually demoted the candidate (`govPenalty > 0`) — appends a separately-labeled "effective N
after an M-pt sector-concentration penalty, used only for ranking order" clause. This preserves
the genuinely useful governor-rank information (why this candidate, not a higher-raw-scored one,
was chosen) without ever presenting it as a second, unreconciled "score". When there is no
penalty, the note is just the bare raw score (identical to the pre-fix text in the common case,
since `effectiveMeritScore === scored.score` when `govPenalty` is 0/undefined).

Deliberately left unchanged: the ranking logic itself (`selectBackfillPlays`'s pool sort still
sorts by `effectiveMeritScore`, respecting the governor exactly as before) — this is a display-only
fix, not a ranking-behavior change.

### Regression test

Added 2 tests to `src/features/nighthawk/lib/play-backfill.test.ts`:
- `selectBackfillPlays: gate_warnings cites the SAME raw score as play.score, never the bare
  governor-penalized effectiveMeritScore unlabeled` — reproduces the exact live PLTR shape (raw 39,
  govPenalty 15 → effective 24) and asserts the warning cites "score 39" (matching `play.score`),
  never bare "by score 24", and explicitly labels the effective/ranking number with its
  sector-concentration-penalty reason.
- `selectBackfillPlays: gate_warnings shows only the bare raw score (no 'effective' clause) when
  the governor never demoted the candidate` — the no-penalty case stays a plain "score N" note.

### Verification

- RED→GREEN proof: temporarily reverted the fix in `play-backfill.ts` (restored the bare
  `effectiveMeritScore`-only warning text) with the new tests left in place —
  `selectBackfillPlays: gate_warnings cites the SAME raw score...` failed with
  `actual: 'Ranked-pool merit fill (#1 by score 24) — verify entry geometry before acting'`,
  byte-for-byte matching the originating live-production repro. Restoring the fix turned it GREEN.
- `node --experimental-test-module-mocks --test src/features/nighthawk/lib/play-backfill.test.ts`
  (Node 20) — 35/35 pass (33 pre-existing + 2 new).
- `node --experimental-test-module-mocks --test src/features/nighthawk/lib/*.test.ts` (Node 20) —
  1545/1545 pass, 0 fail (full Night Hawk feature suite — no other consumer of `gate_warnings` or
  `effectiveMeritScore` regressed).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
