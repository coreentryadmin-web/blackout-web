> **kind:** `FINDING`

## SPX Slayer's `score` is clamped but `factors[]` isn't — Largo (and a member) can hand-sum a different number than the score — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P3 (Largo product contract — "precision": the same fact must render identically/honestly everywhere) |
| **Area** | SPX Slayer confluence engine (`spx-signals.ts`) → Largo boundary (`spx-confidence-boundary.ts`) |
| **PR** | (pending — `fix/spx-score-capped-note`) |

### Symptom

`computeSpxConfluence` (`src/features/spx/lib/spx-signals.ts`) accumulates a signed `score` from
every scored factor, pushing each contribution onto `factors[]` as it goes, then clamps only the
scalar at the very end:

```
score = clamp(score, -100, 100);
```

`factors[]` is never re-clamped or re-scaled to match. On a strong setup the signed sum of
`factors[].weight` can run well past ±100 while `score` reads a flat 100/-100, with nothing in the
payload saying so. Confirmed on the engine's own golden fixture
(`src/features/spx/lib/spx-signals.test.ts`): the 21 fixture factors sum to exactly **154** while
the engine's own `score` reads **100**. A member — or Largo, which is handed `factors[]` verbatim
alongside `score` in `get_spx_play`/`spx_full_state`/`get_spx_confluence`/`get_signal_log` — summing
the shown factors by hand gets a different number than the score shown, and nothing tells them the
two are not supposed to reconcile past the bound. That is exactly the LARGO-PRODUCT-CONTRACT.md
"precision" violation: the same fact (why the score is what it is) renders inconsistently depending
on which field is read.

Note this is a **different** defect from the existing, already-fixed `rawScore`/`confidence`
uncalibrated-formula issue at the same boundary (`spx-confidence-boundary.ts`'s header doc,
FINDINGS 2026-08-23) — `score` itself is a real, intentional, bounded (-100..100) measurement; only
`factors[]` stops reconciling with it once a setup is strong enough to hit that bound.

### Root cause

`spx-signals.ts` around the `computeSpxConfluence` return: every factor push (`factors.push({...
weight: w ...})`) and the running `score += w` are two independent accumulations over the exact
same values, and only `score` gets a post-hoc `clamp(-100, 100)`. `factors[]` was never designed to
be clamp-consistent because nothing downstream previously depended on the two reconciling — but
Largo (and, per the codebase's own `LegacyPlayDetailPanel.tsx`/`PlayTerminal.tsx` "N factors"
disclosure pattern used elsewhere in the Night Hawk desk) treats a factor breakdown as an honest
audit trail for the headline number.

### Fix

Did **not** touch the engine (`spx-signals.ts`) — clamping `factors[]` too would either lose real
factor weights or invent a rescaling the contract doesn't call for, and the -100..100 `score` bound
is itself intentional/documented, unlike the confidence formula this same file already strips.
Instead extended the existing, purpose-built Largo boundary sanitizer
(`src/lib/largo/spx-confidence-boundary.ts`'s `omitUncalibratedSpxConfidence`, already the single
choke point every SPX-play-carrying Largo tool passes through) with a second, independent check:
when a payload carries a numeric `score` and an array `factors[]` whose signed weight sum does NOT
equal `score`, attach two honest fields:

- `factor_sum_pre_clamp` — the true pre-clamp signed total.
- `score_clamp_note` (`SPX_SCORE_CLAMP_NOTE`) — explains the discrepancy and tells the model not to
  treat a hand-summed factor total as the score.

This mirrors the existing `confidence_omitted`/`measurement_omitted` naming convention in the same
file rather than inventing a new pattern, and is independent of the confidence strip (fires even on
a payload with no `rawScore`/`confidence` present at all).

### Blast radius

One shared function, so every known Largo-facing SPX-play consumer benefits without a second
change: `get_spx_play` and `spx_full_state` (both route through `sanitizeSpxPlayPayloadForLargo`,
which calls `omitUncalibratedSpxConfidence` first), `spx-desk-convergence.ts`'s BIE consumer, and
`get_spx_confluence`/`get_signal_log` (both call `omitUncalibratedSpxConfidence` directly). The
member-facing live desk UI (`SpxPlayVerdictBar.tsx`) does not currently render `factors[]` at all
(only Grade+score), so it is unaffected either way — this is scoped to the Largo/model-facing
surfaces where `factors[]` actually reaches a reader who could sum it.

One existing test (`ecosystem-context.test.ts`'s `spx_full_state` full-fidelity guard) needed its
expectation helper (`withConfidenceOmitted`) updated to derive the clamp note the same way the real
sanitizer does, rather than hand-asserting a byte-for-byte fixture copy — its hand-typed
`SPX_FULL_STATE_FIXTURE` only carries one representative factor (weight 12) against `score: 82`, so
it now legitimately gets the same honest note in the test's own expectation.

### Evidence (RED → GREEN)

New tests in `spx-confidence-boundary.test.ts`: a saturated-score case reproducing the exact
154-vs-100 golden fixture, a no-clamp case (nothing added when factors already reconcile), a case
proving the clamp note fires independent of the confidence fields, the `sanitizeSpxPlayPayloadForLargo`
path, and a live-engine reproduction via `computeSpxConfluence` itself.

`git stash` on `spx-confidence-boundary.ts` alone: **RED** — 3/15 tests fail in that file (the
saturated-score case, the independent-of-confidence case, and the `sanitizeSpxPlayPayloadForLargo`
case all assert fields that don't exist pre-fix). Post-fix: **15/15 GREEN**.

Full targeted run (`spx-confidence-boundary.test.ts` + `ecosystem-context.test.ts` +
`evidence-reads.test.ts` + `largo-store.test.ts` + `product-reads-swing-freshness.test.ts` +
`product-reads.test.ts` + `run-tool.test.ts` + `spx-desk-convergence.test.ts` +
`spx-signals.test.ts`, Node 20, `--experimental-test-module-mocks`): **120/120 pass**.
`npx tsc --noEmit`: clean.
