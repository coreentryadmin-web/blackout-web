# Legacy morning-confirm-promoted Swing plays showed "score pillars" that never summed to their own score

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product-honesty/trust — same failure class as #4826's Banger/Vector-bump fixes and the same-day live-position drift finding, a fourth distinct occurrence of the invariant `contributionsToFactors` itself documents) |
| **Area** | Night Hawk Swings — `src/lib/swing/legacy-confirm-promote.ts` (`buildLegacySwingArtifacts`); consumed by the command deck's "Why this play was picked" panel and Ask Largo's `play-brief-intel.ts::whyThisSetupSection` for any Legacy-morning-confirm-promoted Swing row |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — 2026-09-12 deep-dive cycle |

## Root cause

`buildLegacySwingArtifacts` promotes a Night Hawk **Legacy** edition play into a **Swing**
`HorizonPlay` when Legacy's own morning-confirm step re-validates it intraday. The promoted
play's `score` is Legacy's own published edition conviction score
(`horizonScores: { SWING: play.score ?? 70 }`) — the one real, authoritative number behind this
promotion; the code even says so directly ("Ground strength in the published edition score —
never fabricate a whale-print premium").

But `factors` (the `{label, points}[]` breakdown rendered as "Score pillars" next to that score)
was sourced from `meta.factors`, i.e. `contributionsToFactors(scoredDossier.score.contributions)`
— a **freshly re-run dossier's own synthetic pillar score**, built from structure heuristics plus
a hardcoded `regime01=0.55`/`dataQuality01=0.55`. That is a completely different scoring run from
the Legacy edition score shown next to it. `swing-pillars.ts`'s own doc comment on
`contributionsToFactors` names this exact failure mode: "never a freshly re-run dossier's
contributions paired with a frozen/pinned score from a different run" — this call site violated
its own house rule.

This is the fourth occurrence of the same bug class in this codebase (see #4826 for the first two
— Banger-lane and Vector-lane — and the same-day live-position drift finding for the third): a
"Why this play was picked" panel whose itemized factor rows do not sum to the score displayed
beside them, each time because two independently-computed numbers were paired as if they were one
connected explanation.

## Evidence

Live `GET /api/market/nighthawk/horizons?view=swings` (2026-09-12), three Legacy-morning-confirm
promoted rows (`reason` field carries `"Legacy morning confirm"`):

| Ticker | Shown score | Factors sum | Gap |
|---|---|---|---|
| MRVL | 81 | 74.7 | −6.3 |
| IREN | 61 | 75.8 | **+14.8** (factors LARGER than score) |
| SKHY (WATCH) | 59 | 26.6 | −32.4 |

A member reading "Score pillars" next to any of these three scores would be looking at a
breakdown of a *different number* than the one shown — the IREN case is the most visibly wrong,
where the itemized pillars overshoot the headline score entirely.

## Fix

Same shape as the Banger-lane fix in #4826: replace the borrowed dossier decomposition with a
single honest factor equal to the actual displayed score —
`factors: [{ label: "Night Hawk edition score", points: swingPlay.score }]` — so the breakdown
always sums to exactly the score shown next to it, by construction. `meta.archetype`/
`meta.regime`/`meta.thesisLevel`/etc. are unaffected: those are independent classification reads,
not additive-sum-to-score fields, so they keep using the dossier's real values unchanged.

**Why this fix and not re-deriving comparable dossier pillars**: there is no honest way to
decompose Legacy's edition score into sub-components — that score is computed entirely inside the
separate Legacy pipeline, and this promotion path never receives its breakdown, only the final
number. Inventing a plausible-looking split would fabricate precision the promotion path does not
have (violates the Largo product contract's "precision" point) — a single transparent factor is
the honest representation of what is actually known here.

## Tests

Added to `src/lib/swing/legacy-confirm-promote.test.ts`:
- `buildLegacySwingArtifacts: factors sum to the play's own SHOWN score, not the dossier's
  synthetic one` — asserts `factors` is exactly `[{ label: "Night Hawk edition score", points:
  play.score }]` for a high (97) conviction score chosen specifically to be unlikely to coincide
  with the dossier's own synthetic pillar score by chance.
- `buildLegacySwingArtifacts: score/factor reconciliation holds even when it falls back to the
  default 70` — covers the `play.score ?? 70` fallback path.

Verified RED before the fix (both new tests fail: `not ok 4`, `not ok 5`) and GREEN after
(19/19 pass in `legacy-confirm-promote.test.ts`), full `npm test` clean, `tsc --noEmit` clean.
