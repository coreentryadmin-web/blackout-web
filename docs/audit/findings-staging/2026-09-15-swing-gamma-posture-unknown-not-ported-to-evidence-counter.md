> **kind:** FINDING

## Two more call sites treated Vector's literal `"unknown"` gamma posture as resolved, contradicting other sections of the same brief and silently dropping counter-thesis evidence — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `resolveGammaPosture` (`src/lib/swing/play-brief-absence.ts:151`) was fixed on
2026-09-12 to treat Vector's own `regime.posture` literal string `"unknown"` (a real, four-value
enum — `"long"`/`"short"`/`"transition"`/`"unknown"`, not the two-value `"long"|"short"|null` the
GEX-matrix's own `gamma_posture` field uses) the same as a null/absent read, falling through to a
fresh, non-stale GEX-matrix posture instead of treating "Vector couldn't resolve a regime" as an
equally-valid answer to "long"/"short". That fix was applied to the narrative's own
`dealerPostureLine` at the time, but two sibling call sites computing the identical fact by hand
never got it:

1. `src/lib/swing/play-brief.ts:549-552` (`evidenceFromContext`, builds `envelope.evidence`):
   `const postureFromVec = vec?.regime?.posture != null && !vectorStale ? vec.regime.posture : null;`
   — `!= null` alone lets the literal string `"unknown"` win outright over a perfectly good
   GEX-matrix fallback, so `gammaPosture = postureFromVec ?? postureFromGex` never even evaluates
   the fallback.
2. `src/lib/swing/play-brief-narrative.ts:662-665` (`counterThesisLine`):
   `const vecPosture = !vectorStale ? vec?.regime?.posture ?? null : null; const posture = vecPosture ?? gex?.gamma_posture ?? null;`
   — same shape, same bug: a resolved, fresh GEX-matrix dealer-posture counter-thesis reason
   ("dealer long-gamma pins rallies" / "dealer short-gamma can squeeze shorts") is silently dropped
   whenever Vector's own regime read happens to be `"unknown"`, understating the "corroborated
   across N independent reads" evidence-weight count `counterThesisLine` computes just below.

**Evidence (live reproduction, 2026-09-15, TSM real swing-discovery WATCH brief,
`GET /api/market/swing/play-brief?playId=SWING:TSM&ticker=TSM`, asOf 2026-09-14 21:07 ET):**
- `envelope.evidence`: `{"kind":"calc","text":"Dealer posture: γ unknown · net GEX -58.5M · nearest wall 430.00 (10.5 pts)", ...}`
- The SAME brief's "Trade manager read" narrative, same moment (already using the fixed
  `resolveGammaPosture` via `dealerPostureLine`): `**Right now** — spot **419.48** · dealers
  **short gamma** — moves can accelerate through walls`
- The SAME brief's "Chart technicals" section (`play-brief-intel.ts:318`, already correctly
  excludes `"unknown"`/`"transition"`) omits any "Dealer gamma regime" line at all rather than
  print a wrong value.

Three call sites reading one underlying fact (Vector's own `vec.regime.posture === "unknown"` for
TSM), three different behaviors — the envelope evidence line flatly contradicted the narrative
section of its own brief.

**Blast radius:** any committed or watch position whose Vector regime read is `"unknown"` while a
fresh GEX-matrix posture is available — `envelope.evidence`'s "Dealer posture" line (every consumer
of the structured Largo answer envelope, not just the prose narrative) and `counterThesisLine`'s
evidence-weight count.

**Fix:** both call sites now delegate to the already-exported `resolveGammaPosture(ctx, vec[, readMs])`
helper instead of hand-rolling the same `??` short-circuit. In `play-brief.ts`, `postureFromVec`
(used for `provenance.source`/`asOf`/`freshness` attribution) is now derived from the same
"Vector posture is non-null, non-`unknown`, non-stale" condition `resolveGammaPosture` itself gates
on, so source attribution still correctly reads "Vector" vs "GEX" depending on which branch actually
resolved the value. In `play-brief-narrative.ts`, the by-hand `skipGexPosture` staleness re-check is
removed entirely — `resolveGammaPosture` already encodes the identical `gexMatrixStale` gate.

**Fix rationale:** reused the existing shared helper (already exported, already used by this exact
file's own `dealerPostureLine`) rather than re-deriving a third parallel implementation — the
2026-09-12 fix's own lesson (one canonical posture-resolution function, not N hand-rolled copies)
directly applies here; this closes the two remaining copies.

**Test:** RED→GREEN proven (git-stashed both source fixes, confirmed the 2 new regression tests —
one per call site, built directly off the live TSM repro shape — fail with the exact production
symptom `"γ unknown"` / a dropped counter-thesis line against the pre-fix code; restored and
confirmed both pass green). Full `src/lib/swing/*.test.ts` suite (1141 tests, up from 1139 with the
2 new tests) green, `tsc --noEmit` and `eslint` clean on all 4 changed files.
