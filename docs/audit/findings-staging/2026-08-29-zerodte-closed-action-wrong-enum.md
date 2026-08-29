# 0DTE CLOSED-row ACTION label checked the wrong enum — winning/flat/thesis/ratchet closes fell back to generic CLOSED

> **kind:** FINDING

## Symptom

Live-screenshot validation of PR #3101 (2026-08-29, `blackouttrades.com/nighthawk`, desktop 1440)
showed several production CLOSED rows with positive or flat P&L (e.g. QQQ +64%, APP +53%, MUU +16%,
AMD 0%, NVDA 0%) still rendering the generic coarse "CLOSED" pill instead of the new ACTION
vocabulary (TARGET/STOPPED/EOD EXIT/etc.) that PR #3101 shipped. Only the stopped-out rows (MSFT
-52%, SNDK -43%, META -12%) correctly showed "STOPPED".

## Root cause

`zeroDteActionDisplay()` (`play-card-lifecycle.ts`, shipped in #3101) checked
`play.closedReason === "doubled"` to render `TARGET`. **`"doubled"` never appears on the live
board.** It's a literal from `plan.ts`'s POST-HOC backtest grading enum (`gradePlanFromBars`'s
`exit_reason: "trim_scale_first" | "trim_scale_second" | "doubled" | "stopped" | "time_stop"`) — a
completely separate system from what the live board actually serves.

The LIVE board's `TerminalPlay.closedReason` is wired (via `adapters.ts` → `zerodte-sources.ts`)
from `zerodte-service.ts`'s `boardClosedReason`, which is derived as:
```
closedReason === "stopped" ? "stopped" : status === "CLOSED" ? (engineExitCategory ?? "time_stop") : null
```
where `engineExitCategory = categorizeExitReason(pinnedExit.reason)` (`exit-engine.ts`) returns one
of `"ratchet" | "thesis" | "flat" | "target" | "stop"` (or `null`). **`"doubled"` is not in this
enum at all** — the real profit-taking category is the lowercase `"target"`.

So on the live board, every real close that wasn't a literal stop fell through
`zeroDteActionDisplay`'s `if` chain to the `null` fallback (the coarse CLOSED pill) — which is
every `target`/`thesis`/`flat`/`ratchet` close. Only `"stopped"` and `"time_stop"` ever matched.

An earlier grep-based "correction" already staged in `docs/audit/NIGHTHAWK-3RAIL-REDESIGN.md`
(2026-08-29, before this finding) made the same class of mistake in the opposite direction: it
grepped only `plan.ts` for the vocabulary's real values and concluded `THESIS BROKE`/`TRAIL
EXIT`/`SCRATCH` had no backing data and would be fabrication if built — because it never checked
`zerodte-service.ts`, the file that actually derives what reaches the wire. Two unrelated systems
(the live board vs. the post-hoc backtest grader) share overlapping field names
(`exit_reason`/`closed_reason`) with disjoint value sets; grepping `src/lib/zerodte/*.ts` broadly
without tracing which system actually reaches the serving path silently picked the wrong one twice.

## Fix

`zeroDteActionDisplay()`'s CLOSED branch now checks the real live-board values:
- `"target"` → `TARGET`
- `"stopped"` / `"stop"` → `STOPPED` (both, since `"stop"` is `categorizeExitReason`'s own token for
  the same family, even though `closedStopReason`'s literal `"stopped"` wins precedence in practice)
- `"time_stop"` → `EOD EXIT`
- `"thesis"` → `THESIS BROKE`
- `"flat"` → `SCRATCH`
- `"ratchet"` → `TRAIL EXIT`
- anything else / null → still falls back to `null` (coarse pill), never fabricated

All 6 of the original product brief's CLOSED-row labels (§1 of `NIGHTHAWK-3RAIL-REDESIGN.md`) turn
out to be real and are now wired — none needed dropping, contrary to the earlier staged correction.

## Blast radius

Only `play-card-lifecycle.ts`'s `zeroDteActionDisplay()` — the single consumer of `closedReason` for
this display purpose. `closedCapturePct()` (also in this file) already read `closedRealizedPct`
independently and is unaffected.

## Evidence

`npx tsc --noEmit` clean. `node --import tsx --experimental-test-module-mocks --test
src/features/nighthawk/command-deck/*.test.ts` → 348/348 pass, 0 failures. Updated the existing
"real exit_reason values map to real labels" test (was asserting the wrong `"doubled"` mapping) and
added coverage for all 6 real values plus confirmation that `"doubled"`/`"trim_scale_first"`
(real in the OTHER system, never real here) still correctly fall back to `null`.

| **Status** | FIXED |
