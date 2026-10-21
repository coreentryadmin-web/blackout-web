> **kind:** FINDING

# Night Hawk 0DTE Command Deck — "Why we picked it" showed a different contract than the one actually traded

| **Status** | FIXED |
|---|---|

## Root cause

`src/lib/zerodte/thesis/contract-engine.ts`'s `pickBestExpression` is a generic, cross-product
"best way to express this thesis" layer: it deliberately ranks candidate contracts across a DTE
range (0–7+), and when 0DTE IV rank is rich it intentionally prefers a 2–5 DTE contract over the
front (0DTE) expiry (`vol_rationale`, line ~104–107). Its `horizon` field is labeled `"ZERO_DTE"`
for ANY best-ranked contract with `dte <= 4` (line 110) — not strictly same-day — so a 2-DTE pick
still reads as `"ZERO_DTE"` horizon.

Night Hawk 0DTE's own entry logic always commits the same-day (0DTE) contract regardless of what
this expression layer recommends — the two are independent pipelines. `scan-shadow.ts`'s
`thesisFirstEntryContext` freezes the expression's `strike`/`expiry`/`dte`/`rationale` into
`entry_context.thesis_first` at commit time without ever reconciling it against the contract that
was actually committed.

`ZeroDteCommandPanel.tsx`'s "Why we picked it" section then rendered that frozen `expression`
verbatim for EVERY row, committed or not — including committed (OPEN/HOLD/TRIM/CLOSED) rows,
where it can describe a contract that was never traded.

**Live repro, 2026-10-21 (NVDA):** the real committed position was `217.5C` expiring same-day
(2026-10-21, 0DTE), confirmed via the ledger's `occ`/`top_strike`/`expiry` fields and visible in
the board row header ("NVDA 217.5C · 0DTE"). The same row's `entry_context.thesis_first` carried
`expression_strike: 222.5`, `expression_expiry: "2026-10-23"` (2 DTE), `expression_horizon:
"ZERO_DTE"` — a contract that was never traded, rendered directly under the real position in the
Command Deck detail panel ("Why we picked it" → "222.5C · 2DTE — 2026-10-23 222.5C · score 100").
A member reading their open position's rationale would see the wrong strike and expiry presented
as the reason for a trade they're actually in under different terms.

This is a display/narrative-honesty bug, not a trading-decision bug: 0DTE's actual entry/exit/risk
logic never reads this `expression` field, so no trade, fill, stop, or gate decision was ever
affected by this mismatch — confirmed by tracing `pickBestExpression`'s only consumers
(`scan-shadow.ts`'s entry_context stamping and the two read-only UI render sites,
`ThesisRankCard.tsx` and `ZeroDteCommandPanel.tsx`).

## Fix

`src/features/nighthawk/command-deck/adapters.ts`'s `terminalPlayFromZeroDte` now runs the
resolved `thesisFirst` through a new `stripMismatchedExpression` helper: for a COMMITTED row
(status `OPEN`/`HOLD`/`TRIM`/`CLOSED`) whose `expression.contract.strike`/`.dte` don't match the
row's own real `strike`/`dte` (the same values already used to build the real `contract` label),
the `expression` field is nulled out before reaching the UI. Everything else on `thesisFirst`
(archetype, tier, rail scores, desk evidence) is untouched and still renders — only the
contract-specific line is suppressed, degrading gracefully (`ZeroDteCommandPanel.tsx`'s existing
`{play.thesisFirst.expression?.contract && (...)}` guard already handles a null `expression`).

A pre-commit `WATCH`/`SKIP` row is explicitly exempted — no trade has happened yet, so a
cross-DTE "here's a sharper way to express this" recommendation is a legitimate forward-looking
idea, not a mismatch to hide.

## Evidence

RED→GREEN: `src/features/nighthawk/command-deck/adapters.test.ts` — added 3 tests:
1. a committed (`OPEN`) row with a mismatched `expression` (217.5C/0DTE real vs 222.5C/2DTE
   frozen) now has `thesisFirst.expression === null`, while `thesisFirst.rank_tier` and the real
   `contract` label are untouched — **failed pre-fix** (asserted equal to `null`, got the full
   mismatched expression object), **passes post-fix**.
2. a pre-commit `WATCH` row with the same shape keeps its `expression.contract` intact (no
   stripping before a trade exists).
3. a committed row whose `expression` genuinely matches the real contract is left untouched.

Full suite: `npx tsx --experimental-test-module-mocks --test
src/features/nighthawk/command-deck/adapters.test.ts` — 157/157 pass. Also ran
`src/lib/zerodte/thesis/*.test.ts` + `src/features/nighthawk/components/ZeroDteBoard.test.ts` —
87/87 pass, no regressions. `tsc --noEmit` clean.

## Blast radius

Only one call site renders `expression.contract` for a committed row today
(`ZeroDteCommandPanel.tsx`'s "Why we picked it" panel) — `ThesisRankCard.tsx` is used for
pre-commit WATCH-stage candidates, which this fix deliberately leaves untouched. No other
consumer of `entry_context.thesis_first.expression_*` exists in the 0DTE pipeline.

## What was deliberately left unchanged

- `contract-engine.ts`'s cross-DTE expression logic itself — it's a legitimate, intentional
  design (a generic "optimal expression across horizons" recommendation, useful pre-commit and
  potentially for other horizons/products) and is not being removed or restricted.
- `expression_horizon`'s overloaded `"ZERO_DTE"` label (meaning "DTE ≤ 4", not strictly
  same-day) — renaming it would be a larger, separate cross-product change (the label is also
  read by Swings/Banger consumers of the same shared types) and isn't needed to fix the member-
  visible symptom.
- No gate, exit rule, entry logic, or risk control touched — this is purely a post-commit display
  fix.
