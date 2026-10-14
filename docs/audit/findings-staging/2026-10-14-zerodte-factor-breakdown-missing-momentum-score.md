> **kind:** FINDING

## 0DTE board: "Why this play was picked" factor_breakdown silently omits momentum_score, a 7th real scorer component — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `scoreCandidate` (`src/features/nighthawk/lib/scorer.ts`) folds **seven** named
components into `preRegimeSum` (and therefore into `total`/`dossier_score` after the regime
multiplier is applied): `flow_score`, `tech_score`, `pos_score`, `news_score`,
`smart_money_score`, plus five more optional ones (`fundamental_score`, `catalyst_score`,
`short_interest_score`, `wall_proximity_score`, `vex_alignment_score`, `skew_score`,
`iv_adjustment`, `anomaly_penalty`, `flow_conviction_bonus`, `regime_adjustment`) — and
**`momentum_score`**, which is also read directly by `confirmingSignals`'s own
`momentumScore >= 5` check (scorer.ts:1292), so it is a real, load-bearing scoring input, not a
cosmetic extra.

`board.ts`'s `SetupDossierView["scored"]` type (the narrower view `enrichSetup` builds the member-
facing `factor_breakdown` from) and `enrichSetup`'s `factor_breakdown` object literal both declared
every one of those fields **except `momentum_score`** — so the Night Hawk 0DTE "Why this play was
picked" panel's listed factors silently under-counted the real `dossier_score` by exactly the
momentum contribution, every time momentum was nonzero.

This is the **same defect class fixed twice already in this exact file** (in-code comments at
`board.ts:1871-1884`, labeled "9-8" and "9-9"): `scoreCandidate` grows a new scoring component,
`SetupDossierView`/`enrichSetup` are not updated to mirror it, and the breakdown silently drifts out
of sync with the number it claims to explain — until the next live repro catches it. Each prior fix
explicitly left a comment saying "mirrors the identical, already-shipped mapping in
`deterministic-edition.ts`" — and indeed `deterministic-edition.ts` (Legacy's two independent
`factor_breakdown` builders) already carries `momentum: scored.momentum_score` at **both** of its
own call sites (lines 893 and 1259) and was never missing it. `board.ts` (0DTE) is the one surface
that drifted again.

**Evidence.** Live `GET /api/market/zerodte/board` (2026-10-14 ~19:52 ET, Ask Largo standing
deep-dive, this cycle's 5-engine health sweep), 7 real FLOW-origin setups, comparing each
`factor_breakdown`'s own sum against its sibling `dossier_score`:

| ticker | dossier_score | factor_breakdown sum (pre-fix) | gap |
|---|---|---|---|
| SPXW | 28 | 28.00 | 0.00 |
| MU | 64 | 64.20 | 0.20 (rounding) |
| TSLA | 33 | 33.20 | 0.20 (rounding) |
| QQQ | 61 | 56.20 | **4.80** |
| SMH | 61 | 56.00 | **5.00** |
| SPY | 31 | 25.60 | **5.40** |
| IWM | 45 | 39.60 | **5.40** |

SPXW/MU/TSLA (momentum ≈ 0 that cycle) show no real gap beyond rounding noise; QQQ/SMH/SPY/IWM —
all real, non-rounding gaps — are tickers where the scorer computed a nonzero `momentum_score` that
never reached the rendered breakdown. This reproduces live, on the production board, with no
synthetic fixture.

**Blast radius.** Checked for every other consumer of `SetupDossierView["scored"]`/
`enrichSetup`'s `factor_breakdown` (`grep -rn "momentum_score" src`): the only other reader is
`deterministic-edition.ts` (Legacy), which already handles it correctly at both its call sites —
confirmed unaffected by this fix (its own test suite, 87/87, run clean before and after). No other
call site reads `scored.momentum_score` or `factor_breakdown.momentum`, so this is a single, clean,
additive gap with one real fix location (`board.ts`) and one already-correct sibling
(`deterministic-edition.ts`) left untouched.

**Fix.** Widened `SetupDossierView["scored"]`'s type with an optional `momentum_score?: number`
field (matching the existing optionality convention for every other post-9-8/9-9 field), and added
one conditional-spread line to `enrichSetup`'s `factor_breakdown` object literal —
`...(scored.momentum_score != null ? { momentum: scored.momentum_score } : {})` — using the exact
same "omit, don't zero-fill, when the scorer never evaluated this dimension" convention every
sibling field already follows (a real `0` and an absent input are different facts and must not
collapse to the same rendered bar), and the same `momentum` label `deterministic-edition.ts` already
uses so the two surfaces stay vocabulary-consistent.

**Fix rationale.** Mirrored the established pattern exactly (same optional-field style, same
conditional-spread style, same label as the already-correct Legacy mapping) rather than inventing a
new shape — this is the smallest change that closes the gap and stays consistent with the two prior
fixes in the same function. Did not touch `scorer.ts` itself (it was already correct — `momentum_score`
was already computed, folded into `total`, and exposed on `ScoredCandidate`; the gap was purely in the
narrower `board.ts` view type and its mapping) and did not touch `deterministic-edition.ts` (already
correct, confirmed by its own passing test suite).

**Tests.** Added two tests to `board.test.ts`, modeled directly on the existing 9-8/9-9 tests in the
same file: (1) `enrich: factor_breakdown carries momentum_score and sums to dossier_score (7th scorer
component)` — asserts the breakdown includes `momentum` and that `Object.values(factor_breakdown)`
sums exactly to `dossier_score`; (2) `enrich: factor_breakdown omits momentum when the scorer never
returned it` — asserts no fabricated `momentum: 0` bar appears when the field is absent (covers the
pre-existing `fakeDossier()` fixture, which omits it exactly as older `scored` payloads do).
RED→GREEN proven directly (not via git-stash, since this is a pure addition with no risk of a stash
reverting unrelated lines): the new tests failed with the breakdown missing the `momentum` key
before the fix (`not ok ... Expected values to be strictly deep-equal ... - momentum: -12`), and
passed clean after. Full `board.test.ts` suite: 134/134 pass (was 132/132 before this PR's two new
tests were added). `deterministic-edition.test.ts`: 87/87 pass, unaffected. `scan.test.ts`: 46/46
pass (scan.ts is the other consumer of `enrichSetup`/`factor_breakdown` via `applyIntradayEdgeToBreakdown`,
confirmed unaffected since that function only touches the `breakout_core`-gated BREAKOUT shape, not
this FLOW/PIN shape). `tsc --noEmit` clean on Node 20.
