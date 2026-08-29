# Trim-scale regime conditioning never wired — starts the calibration ledger, live behavior unchanged

> **kind:** FINDING

## Symptom

Task-list item flagged the regime-conditioned trim-scale schedule (`TRIM_SCALE_RULES.tranches_by_regime`
in `exit-engine.ts` — trend/neutral/range each with their own tranche thresholds) as "fully unwired dead
code in production."

## Root cause

`decideTrimScale()` (`exit-engine.ts`) has supported per-regime tranche thresholds since it shipped —
`const regime: ZeroDteRegime = input.regime ?? "neutral";` — but no caller of `evaluateExitState` /
`evaluateLedgerRowExit` (`exit-sync.ts`) ever passed a `regime`. `evaluateLedgerRowExit`'s only production
call site (`scan.ts:1944`) passes `{ syncMark, status }` with no `regime` field. Every trim_scale-managed
row in production — and `trim_scale` is `DEFAULT_EXIT_MODE`, so this is the majority of 0DTE plays, not an
edge case — has run the `neutral` (+20%/+50%) tranche thresholds regardless of the session's actual
structure (trend/range/inside), even on days a `classifyRegime()` read was computed and available
elsewhere in the pipeline for scoring.

The deeper reason it stayed unwired: the rich regime read (`classifyRegime()` → `MarketRegime`, a 4-way
`structure` classification) is computed per-session for the feature store/scoring layer
(`ZeroDteSessionContext.regime`), but was **never persisted** onto the ledger row's `entry_context` blob
— only `gamma_regime` (a different, per-name dealer-gamma concept) is. So even wiring the read side today
would only pass `null` (→ `neutral` fallback) for every already-committed row; there was no live-ledger
signal for the trim schedule's own comment to calibrate `trend`/`range` against
(`"v1 heuristics... calibrated on the live ledger before they size real risk"` — only `neutral` is
E5-measured).

## Fix

Two-part, calibration-first (matches this repo's existing pattern — `condor-wr.mjs`,
`calibration-rail-graduation.ts` — measure before a knob sizes real risk):

1. **`entry-context.ts`**: added `session_regime?: ZeroDteRegime | null` to the persisted
   `ZeroDteEntryContext`, stamped at commit via a new pure `zeroDteRegimeFromStructure()` mapping
   (`classifyRegime()`'s `TREND_UP`/`TREND_DOWN` → `trend`, `RANGE` → `range`, `INSIDE` → `neutral` — an
   inside day hasn't earned the tighter chop-banking thresholds yet). This is additive and **always on**
   — it starts building the calibration ledger the trend/range thresholds need, with zero behavior change
   (nothing reads this field into a live decision yet).
2. **`exit-sync.ts`**: added `resolveTrimRegimeLive()` (mirrors the existing `resolveExitMode()` operator
   switch) — `ZERODTE_TRIM_REGIME_LIVE=1` (exact match, default **off**) gates whether the live engine
   actually reads the row's stamped `session_regime` into `evaluateExitState`'s `regime` input. Off by
   default means **today's `neutral`-only behavior is unchanged** — this PR does not touch live trim
   thresholds for any real trade. `deps.regime` (the existing test/AB override) keeps top precedence.

## Blast radius

`entry-context.ts` (persisted schema, additive field only — old rows read `session_regime: undefined`,
never a fabricated value) and `exit-sync.ts` (the gate + read-through). No change to `exit-engine.ts`'s
pure decision logic — `TRIM_SCALE_RULES` and `decideTrimScale()` are untouched; they already supported
this input, it just never arrived.

## Evidence

`npx tsc --noEmit` clean. `node --import tsx --experimental-test-module-mocks --test src/lib/zerodte/*.test.ts`
→ 1199/1200 pass (1 pre-existing `.skip`), 0 failures. New coverage: `zeroDteRegimeFromStructure`'s 4-way
mapping (both trend directions agree, RANGE→range, INSIDE→neutral) and `resolveTrimRegimeLive`'s
default-off env parsing (mirrors `resolveExitMode`'s existing test).

## What was deliberately left undone

The live-consumption flag (`ZERODTE_TRIM_REGIME_LIVE`) stays off. Flipping it is a SEPARATE decision that
needs its own evidence run once enough `session_regime`-stamped rows have graded outcomes — exactly the
"measure before touching" backtest this repo's audit toolkit already does for every other exit-mechanics
change (see `docs/audit/INTENTIONAL-DESIGN.md`). A follow-up A/B harness (same shape as
`merge-precedence-ab.mjs`) once there's a real population to measure is the natural next step, not part
of this PR.

| **Status** | FIXED (calibration-ledger stamping wired; live trim-schedule behavior deliberately unchanged pending graduation evidence) |
