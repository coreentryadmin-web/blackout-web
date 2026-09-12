> **kind:** FINDING

# Night Hawk Legacy thesis never named WHICH smart-money signal drove a "smart-money" scoring tag — FIXED

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Legacy |
| **Severity** | P3 — product enhancement (genuine signal gap, not a correctness defect) |
| **Files** | `src/features/nighthawk/lib/deterministic-edition.ts` — `buildDeterministicThesis`, new `smartMoneyDriverNote` |
| **PR** | (opened same session as this finding) |

## Root cause / gap

`scoreSmartMoney` (`scorer.ts`) blends three real, distinct data sources into `smart_money_score`:
congressional trading disclosures (`congress_unusual`/`congress_trades`, recency- and
side-weighted), institutional net flow (`institutional_activity`), and prediction-market consensus
(`predictions_signal`, which even carries its own human-readable `headline` field). When smart-money
is a strong enough signal, `smart_money_score` can be one of the top-2 drivers rendered in the
published `key_signal` line — e.g. `"BULLISH — smart-money + flow · score 78 (A)"`.

But `buildDeterministicThesis`'s prose never named which of the three sub-signals actually fired —
unlike flow, positioning, or short-interest, which each get their own explanatory sentence. A member
could see "smart-money" named as a driver of their pick and have no way to tell whether that meant a
senator disclosed a trade, an institution accumulated, or a prediction market moved. This is the
identical gap class already fixed for "news" in this same function
(`docs/audit/findings-staging/2026-09-12-legacy-thesis-catalyst-headline.md`, PR #4821, merged) —
found while sweeping the rest of `topDrivers`' labels for the same defect shape.

## Fix

Added `smartMoneyDriverNote(dossier, isLong)`: when `smart-money` is present in
`buildDeterministicThesis`'s already-computed `topDrivers`, check for direction-aligned evidence in
the same priority order `scoreSmartMoney` sums them:
1. Congressional trades (`congress_unusual`/`congress_trades`) whose disclosed side matches the
   play's direction (buy for long, sell for short) — mirrors `scoreSmartMoney`'s own
   `congressSideWeight` field conventions (`txn_type`/`transaction_type`/etc.) without re-deriving
   its recency-decay weighting, since this is prose naming a real signal, not a second scorer.
2. Institutional net flow (`institutional_activity`) aligned with direction — mirrors
   `institutionalNetSignal`'s field conventions (`change`/`action`/etc.).
3. Prediction-market consensus (`predictions_signal`) aligned with direction — surfaces the
   signal's own `headline` field directly (already real, human-readable text) when present, else a
   generic fallback line.

Returns `null` (renders nothing) when no aligned evidence exists in any of the three sources —
additive only, never fabricates a signal. Scoped strictly to when smart-money is an actual top-2
driver.

## Blast radius

- `buildDeterministicThesis` is Legacy-exclusive (confirmed via grep, no other desk imports it).
- Purely additive to the `parts` array — no existing sentence, ordering, or field changed.

## Fix rationale

Sequenced after PR #4821 (the news-catalyst fix) merged rather than opening a third simultaneous PR
touching the same function's `parts` array, to avoid a self-inflicted merge conflict between two of
this lane's own unmerged branches (CLAUDE.md's cross-PR ordering guidance) — queued in the journal
one cycle earlier, implemented this cycle once the dependency cleared.

## Regression tests

`src/features/nighthawk/lib/deterministic-edition.test.ts` — 5 new tests: names congressional
buying when it's the aligned evidence; falls back to institutional flow when no congressional data
exists; falls back to the prediction-market's own real headline when neither exists; renders
nothing (never fabricates) when smart-money is a top driver but no aligned evidence exists in any
source; stays silent when smart-money is NOT a top driver even with real congressional data present.
Verified RED (3 of the 5 failing) via `git stash` of the `.ts` fix alone, then GREEN after restoring
it (54/54 in the file). `tsc --noEmit` clean; full local suite run alongside this fix.
