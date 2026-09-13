> **kind:** FINDING

# Night Hawk Legacy: morning Cortex re-veto conflated two very different "skipped" reasons into one bucket

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `applyCortexMorningReveto` (`src/features/nighthawk/lib/morning-cortex-reveto.ts`, PR-N6's morning fresh-veto pass) and its one caller, `nighthawk-morning-confirm`'s cron route |
| **Severity** | P3 — no grading/win-loss impact (this is a diagnostic-only field, never read by any statuses-affecting logic), but a real, provable loss of signal: two operationally very different situations were indistinguishable in both the returned result and the cron's own logged/persisted meta. |

## Root cause

`applyCortexMorningReveto` pushed a ticker into the same `result.skipped: string[]` array in two structurally different situations:
1. `ps.status === "INVALIDATED"` — the play was already invalidated by the earlier mechanical check (gapped through stop, etc.). This is **expected and normal** — the re-veto correctly has nothing to add.
2. `!verdict` — Cortex returned no verdict for this ticker at all (an error during `fetchCortexInputs`, or the ticker was simply absent from the caller's verdict map). This means **the re-veto never actually ran** for that play — a potential coverage gap worth watching if it grows, not a benign "nothing to do here" case.

Both landed in the identical `skipped` bucket with no way to tell them apart, so the cron's own logged/persisted `cortex_reveto.skipped` count (`nighthawk-morning-confirm/route.ts`) could not distinguish "N plays were already invalidated (fine)" from "N plays never got a fresh Cortex read at all (worth investigating)" — a real signal that existed in the code path but was never surfaced.

## Blast radius

Confirmed via repo-wide grep: `applyCortexMorningReveto`/`CortexRevetoResult` has exactly one caller (`nighthawk-morning-confirm/route.ts`), which only reads the aggregate `.length` of the skip bucket into its own `cortexRevetoMeta.skipped` count (cron logging/meta only) — no member-facing UI or grading path reads this.

## Fix

Split `skipped: string[]` into `skipped_already_invalidated: string[]` (mechanical INVALIDATED) and `skipped_no_verdict: string[]` (no Cortex verdict at all). Updated the cron route's `cortexRevetoMeta` to carry both new counts alongside the still-present total `skipped` (kept for backward-compat with anything reading that field), so a future spike in `skipped_no_verdict` specifically is now a visible, distinguishable signal in cron logs/meta.

## Why this fix, not an alternative

Considered leaving the single `skipped` array and just adding a `reason` tag per entry instead of two arrays — rejected as more churn for no real benefit: every existing consumer only ever needed a count, and two flat arrays are simpler to test/read than one array of `{ticker, reason}` objects for the same information.

## Evidence

- New test: mixed batch (one already-INVALIDATED ticker, one with no verdict in the map at all) asserts `skipped_already_invalidated` and `skipped_no_verdict` are exactly the right, disjoint tickers.
- All 5 pre-existing tests referencing the old `result.skipped` updated to the new fields, with explicit disjointness assertions added where relevant.
- Full suite (Node 20): 14089/14092 pass, 0 fail, 3 skipped.
- `npx tsc --noEmit`: clean.

## What was deliberately left unchanged

`applyCortexMorningReveto`'s actual veto-merging logic (INVALIDATED upgrade, reason-string composition, ticker case-insensitivity) is completely untouched — this fix only splits the diagnostic skip-tracking into two distinguishable buckets and threads the new counts through the one caller's logging meta.
