# 0DTE trim_scale trend dead-zone floor exits persisted the raw unhonored observed mark, understating P&L — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `src/lib/zerodte/exit-engine.ts` (`resolveExitMark`) |
| **Severity** | P2 — live-trading-path, member-facing P&L accuracy on real committed positions |

### Root cause

`resolveExitMark` decides whether an EXIT's persisted `mark`/`pnl_pct` honors the armed
protective floor (`mark = max(observedMark, floorMark)`) or falls back to the raw observed
print. It gates that decision on a reason-string allowlist:

```ts
decision.reason.startsWith("ratchet") || decision.reason.startsWith("runner_floor")
```

`trimScaleFloorPct`'s trend-regime dead-zone tier (2026-09-12, the fix for the "regime-
conditioned trend dead-zone" — a `trend` peak in `[20%, 40%)` has no tranche armed yet, so it
floors at half the peak instead of flat breakeven) returns the reason
`"trim_scale_dead_zone_floor"` for its EXIT decision. That string starts with neither
`"ratchet"` nor `"runner_floor"`, so it silently fell through to the unhonored branch:
`return { mark: round2(observedMark), honored: false }`. The exit still fires correctly (the
floor-breach detection and `floorPnlPct` value are both right), but the FILL PRICE used for
the persisted `mark`/`pnl_pct`/`mark_honored` never applies the floor's own promise — exactly
the "cannot finish red" (or here, "cannot give back more than the floor") guarantee the same
decision's own `exit_detail` text asserts.

Notably, the SIBLING function `categorizeExitReason` (a few dozen lines below in the same
file) was correctly special-cased for this exact reason string, with a comment explaining it
belongs in the "ratchet" (floor) family for display purposes — the fix was applied to the
function that labels the exit, but not to the function that actually PRICES it.

### Evidence

Live, 2026-09-21, real committed TSLA position (`GET /api/market/zerodte/board`, RTH cycle
14:47-15:07 UTC): entered 10:45:46 ET at 3.27, peaked at 4.08 (+24.62%, `trend` regime, no
tranche armed — inside the dead zone), retraced and closed 5 minutes later. Persisted ledger
row: `exit_detail: "Mark 3.575 (+9.33%) is at/below the +12.31% floor armed by a +24.62%
peak — the protective floor exits so the green trade cannot finish red."`, but
`exit_pnl_pct: 9.33`, `exit_mark_honored: false` — the position was graded ~3 percentage
points BELOW the floor its own exit narrative promised.

Reproduced exactly via a standalone script feeding the same entry/peak/mark shape through the
real `evaluateExitState`/`buildExitContext` functions: decision floor 12.31%, but
`buildExitContext` returned `mark_honored: false`, `pnl_pct: 9.33` pre-fix — byte-identical to
the live TSLA numbers, confirming this isn't a data artifact but the shipped logic gap.

### Fix

Added `decision.reason === "trim_scale_dead_zone_floor"` as an explicit third condition
alongside the two existing prefix checks in `resolveExitMark`. Listed as an exact match rather
than folded into a broadened prefix (e.g. a generic `"trim_scale"` prefix) because it is the
one other specifically-named floor reason, not a family — `trim_scale_first`/
`trim_scale_second`/`trim_scale_runner_target` are profit-TAKING exits (the fill price IS the
tag/tranche price, no separate floor concept to honor) and must not be swept in by a broader
prefix match.

### Fix rationale

Considered widening the prefix check instead (e.g. matching any reason containing `"floor"`),
but an explicit exact-match mirrors the pattern `categorizeExitReason` already uses for this
exact reason string and is the smallest, most auditable change — it cannot accidentally rope
in a future reason that happens to share a substring.

### Blast radius

Single function, single call site inside `buildExitContext` (also in this file), whose own
callers are `exit-sync.ts`'s live sync tick (persists `entry_context.exit` via
`stampZeroDteExitContext`) and any test/audit tool that replays `evaluateExitState` +
`buildExitContext` together. Every OTHER floor family (`ratchet_*`, `runner_floor`) already
matched the old condition and is unaffected — this only changes behavior for the one
previously-uncovered reason. Any position that has ALREADY closed via
`trim_scale_dead_zone_floor` before this fix (TSLA above, and per the historical dead-zone
measurement referenced in `exit-engine.ts`'s own comments, ~9.9% of a 372-play sample hit the
pre-2026-09-12 flat-breakeven version of this dead zone) has a persisted `pnl_pct`
understating the true floor-protected outcome — those historical rows are not retroactively
corrected by this fix (a data-backfill question, out of scope for this PR), but every NEW exit
via this path is now priced correctly going forward.

### Tests

`src/lib/zerodte/exit-engine.test.ts`: added
`"buildExitContext: trim_scale dead-zone floor exit HONORS its own floor"`, reproducing the
exact live TSLA shape (trend regime, peak +24.62%, retrace to +9.33%, no tranche armed) and
asserting `mark_honored: true`, `mark: 4.49` (the floor price, not the raw 4.37 observed
print), `pnl_pct: 12.25` (matching the floor, not the worse raw print). RED→GREEN confirmed
via `git stash` isolating the `exit-engine.ts` fix from the new test (95/96 pass pre-fix, the
new test failing exactly as expected; 96/96 pass post-fix). Full
`exit-engine.test.ts` + `exit-sync.test.ts` + `board.test.ts` suite: 245/245 pass. `npx tsc
--noEmit`: clean. All on Node 20.20.2.

---
_Generated by [Claude Code](https://claude.com/claude-code)_
