## Swing "Ticker track record" cited a LATER trade as "prior" evidence — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/lib/swing/play-brief-ticker-history.ts` (`loadTickerTrackRecord`), called from `src/lib/swing/play-brief-context.ts` |
| **Status** | FIXED |
| **Severity** | P2 — a member-facing Largo citation stated a factually backwards claim ("traded before this play") on real closed positions; no money impact, but directly undermines the Largo product contract's C10 (historical context) and C8 (provenance) guarantees |
| **Found via** | Ask Largo × Night Hawk Swings standing ownership mandate — live play-brief deep-dive on two fresh closed EWZ chains (#26, #29), 2026-09-21 audit cycle |

### Root cause

`tickerTrackRecordSection` renders: *"The desk has traded **EWZ** N time(s) **before this play**: W W / L L."* The underlying data comes from `loadTickerTrackRecord(ticker, excludeRootId)`, which:

1. fetches every `swing_positions` row for the ticker,
2. drops the reviewed play's OWN chain root (`excludeRootId`),
3. counts every OTHER resolved chain as "prior" — with **no check that it actually closed before the reviewed play**.

Self-exclusion only prevents a play from citing itself; it does nothing to stop a chain that closed **after** the reviewed play from being cited as its history.

**Live repro** (both closed, real ledger rows, via `GET /api/market/swing/play-brief`):
- `SWING:EWZ:26` — STOPPED, closed **2026-08-28** (a LOSS, -34.2%), chronologically the FIRST EWZ trade — rendered *"traded EWZ 1 time before this play: **1W / 0L**"*, citing a win that had not happened yet.
- `SWING:EWZ:29` — TARGET, closed **2026-09-03** (a WIN, +438.8%) — rendered *"traded EWZ 1 time before this play: **0W / 1L**"*, correctly citing #26 (which genuinely preceded it).

The two briefs directly contradict each other about the SAME two trades — #26's brief says the desk was 1-0 on EWZ before it; #29's brief says the desk was 0-1. Only one can be true (#29's version is correct: #26 genuinely came first with 0 prior trades, so #26's brief should have shown NO "Ticker track record" section at all).

### Evidence

`selectSwingRecordRootIds` (reused from `record.ts`, `/record`'s own all-time aggregate root-selector — correct there, since that route has no "as of when" concept) returns every resolved root with no ordering. `loadTickerTrackRecord` passed that straight through with only the self-exclusion filter — confirmed by reading the pre-fix source and by a new regression test that reproduces the exact EWZ #26/#29 pair and fails RED (`priorClosedTrades: 1, wins: 1, losses: 0` returned for #26 when it should be `null`) before the fix, GREEN after.

### Fix

Added `asOfMs` (the reviewed play's own resolution instant — `TerminalPlay.exitAt`, parsed; `null` for a still-open reviewed play, which needs no cutoff since every resolved chain already precedes an ongoing one) as a third parameter. Each candidate chain's own resolution time is computed as the latest `closed_at ?? graded_at` across its legs; a chain that resolved at or after `asOfMs` is dropped. A chain with no parseable timestamp is kept (best-effort — never silently drops evidence over a data gap, matching this module's existing Largo C6 "never fabricate absence" posture). Wired the call site in `play-brief-context.ts` to pass `resolved.play.exitAt`.

### Blast radius

Single call site (`play-brief-context.ts` → `loadTickerTrackRecord`); no other consumer of this function exists (confirmed via repo-wide grep). `record.ts`'s `selectSwingRecordRootIds`/`buildSwingRecord` themselves are UNCHANGED — the all-time `/record` aggregate and `closedDeckSourcesFromChains` correctly have no "as of" concept and were never in scope.

### Tests

`src/lib/swing/play-brief-ticker-history.test.ts` — 4 new cases: the live EWZ #26/#29 repro (both directions), a still-open reviewed play (no cutoff — every resolved chain counts), and an undated candidate chain (kept, not dropped). RED confirmed pre-fix via `git stash` (1/11 failing with the exact wrong values above), GREEN post-fix (11/11). Full `npx tsc --noEmit` clean; `src/lib/swing/play-brief-context.test.ts`, `play-brief.test.ts`, `play-brief-resolve.test.ts` (116 tests) all pass unchanged.
