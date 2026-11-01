> **kind:** FINDING

## Exit pnl_pct>peak_pnl_pct clamp (PR #7163) never reached Ask Largo's cortex-read tool or the live board payload — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live audit of blackout-web (standing Ask Largo × Night Hawk Swings ownership
mandate / 5-engine live monitor), following up directly on the 2026-10-31/11-01
`clampManagedPnlToPeak()` work (PR #7163, see the sibling finding
`2026-11-01-zerodte-official-lane-peak-clamp.md`).

**Root cause:** a pre-2026-09-04 bug in `exit-engine.ts`'s `buildExitContext` computed a
non-honored exit's `pnl_pct` from a cent-ROUNDED mark while `peak_pnl_pct` was (and still is)
computed from the raw, unrounded peak premium — rounding up past the row's own genuine
high-water mark on a handful of cheap, sub-few-dollar 0DTE premiums. The result: ~8-9 real,
historical rows (HIMS, KORU, SPCH, RIOT, FIG, CRCL x2, AAPL, NVDA, OCUL) carry a frozen
`entry_context.exit.{pnl_pct,peak_pnl_pct}` pair where `pnl_pct` sits numerically ABOVE
`peak_pnl_pct` — a mathematical impossibility, since a position can never realize better than its
own recorded all-time high.

`src/lib/zerodte/record.ts` added a display-time clamp for this (`clampManagedPnlToPeak()`,
2026-10-31, extended to a second reader in PR #7163) — but that frozen blob has **two other,
fully independent readers** that were never given the same treatment:

1. `src/lib/bie/cortex-read.ts`'s `readExitRecord()`/`buildPinnedCortexEnvelope()` — the backing
   implementation for Ask Largo's wired `cortex_read` intent (`src/lib/largo/product-reads.ts` →
   `composeCortexRead` → `readCortexForPlay`), explicitly designed to answer "why was `<ticker>`
   committed on `<date>`" for PAST sessions. Its "What the exit engine did" section
   (`buildPinnedCortexEnvelope`, ~line 295) interpolated `exit.pnl_pct` and `exit.peak_pnl_pct`
   into one sentence with **zero clamping** — e.g. for a FIG-shaped row:
   `"...(mark X, P&L +18.3%, peak +17.5%, at ...)"`, a self-contradictory sentence asserting the
   realized close was HIGHER than the position's own documented all-time maximum.
2. `src/lib/platform/zerodte-service.ts`'s `mapLedgerRow()` — the single source of truth for the
   live `/api/market/zerodte/board` payload, Largo's `get_zerodte_plays`, and every BIE composer
   that reads through `buildZeroDteBoardPayload`. It served `exit_pnl_pct: exitStamp.pnl_pct` raw
   (unclamped), and fed that same raw value into `mfeCapturePct(exitStamp.pnl_pct, peakPnlPct(...))`
   — which, for an affected row, divides a P&L above its own peak by that peak and renders a
   "captured >100% of the peak move" figure, a second impossible number downstream of the first.

Neither module imported or called `clampManagedPnlToPeak`, and neither had any independent guard
that `pnl_pct <= peak_pnl_pct`.

**Repro (traced against current source, not assumed from the finding brief):** `composeCortexRead`
→ `readCortexForPlay(ticker, sessionDate)` → `db.fetchZeroDteSetupLog(sessionDate)` →
`buildPinnedCortexEnvelope(row)`. For a real historical row carrying the impossible blob (e.g. FIG,
session_date 2026-08-10), asking Largo "why was FIG committed on 2026-08-10" renders the exit
section with the raw `exit.pnl_pct`/`exit.peak_pnl_pct` straight from the frozen blob, with no
clamp anywhere on that code path — confirmed by reading `cortex-read.ts` lines 123-137 (the
structural reader, zero clamping) and 295-302 (the render site, direct string interpolation).
Confirmed the identical gap in `zerodte-service.ts` at `mapLedgerRow`'s `exit_pnl_pct`/
`mfe_capture_pct` assignments (originally lines ~587/~610-611) — both read `exitStamp.pnl_pct`
(from `readExitStampFromEntryContext`, `play-timeline.ts`, the SAME frozen blob record.ts and
cortex-read.ts read) with no clamp, and verified the downstream post-`roundFloats` re-derivation
block (`buildZeroDteBoardPayload`, ~line 977-1001) reads `row.exit_pnl_pct` straight off that
unclamped value for its own `mfe_capture_pct` recompute — so the fix has to land at the
`mapLedgerRow` source, not just in the second pass.

**Blast radius:**
- **Primary:** `src/lib/bie/cortex-read.ts` — reachable TODAY via the wired Largo `cortex_read`
  intent for any past session date, which is exactly the surface this tool exists to answer
  questions about.
- **Secondary:** `src/lib/platform/zerodte-service.ts`'s `mapLedgerRow()` — `exit_pnl_pct` and
  `mfe_capture_pct` on the live `/nighthawk` board payload, and every other consumer of
  `buildZeroDteBoardPayload` (Largo `get_zerodte_plays`, BIE composers), for as long as an
  affected CLOSED row stays inside the board's query window.

**Fix:** moved `clampManagedPnlToPeak()`'s implementation into `src/lib/zerodte/marks-math.ts`
(the existing dependency-free pure-math leaf already shared by `zerodte-service.ts` and other
0DTE consumers) as a newly-exported `clampPnlToPeak(pnl, peak)` — null-safe, identical semantics,
no behavior change. `record.ts`'s `clampManagedPnlToPeak` is now a one-line wrapper around the
shared function (kept so every existing call site/comment in that module is untouched).
`cortex-read.ts` and `zerodte-service.ts` both now import and apply `clampPnlToPeak` at the exact
point they read the frozen `{pnl_pct, peak_pnl_pct}` pair, before it is ever rendered or divided
through:
- `cortex-read.ts`: `buildPinnedCortexEnvelope`'s exit section now computes
  `clampPnlToPeak(exit.pnl_pct, exit.peak_pnl_pct)` and renders that instead of the raw
  `exit.pnl_pct` — `exit.peak_pnl_pct` itself is reported unchanged (only the impossible `pnl_pct`
  is capped).
- `zerodte-service.ts`: `mapLedgerRow` now computes `exitPnlPct = clampPnlToPeak(exitStamp.pnl_pct,
  exitStamp.peak_pnl_pct)` once and uses it for both the `exit_pnl_pct` field and the
  `mfeCapturePct` input — the downstream post-`roundFloats` re-derivation already reads
  `row.exit_pnl_pct`, so it inherits the clamp automatically with no second change needed there.

**Fix rationale:** sharing one function (rather than copy-pasting the clamp a third time) is the
whole point — a second independent implementation is exactly how this gap opened in the first
place (the 2026-10-31 clamp was added to `record.ts` only, and nobody re-checked whether the other
two readers of the same frozen data needed the identical treatment). Deliberately left unchanged:
`record.ts`'s own behavior and its existing tests (the wrapper is provably identical); the shape
of `exit.peak_pnl_pct` itself (never clamped — it is the one number in the frozen blob the
original rounding bug never touched, so it stays the honest "true peak" reference both clamps cap
against).

**Evidence (RED → GREEN):**
- Added `clampPnlToPeak` unit tests to `src/lib/zerodte/marks-math.test.ts` (impossible-pair
  clamp, no-op when already valid, null-safety).
- Added a regression test to `src/lib/bie/cortex-read.test.ts`
  (`buildPinnedCortexEnvelope: an impossible frozen pnl_pct > peak_pnl_pct ... is clamped to the
  peak, never rendered raw`) asserting the rendered exit section shows `P&L +17.5%` (the clamped
  peak), never the raw `+18.3%`.
- Added a regression test to `src/lib/platform/zerodte-service.test.ts`
  (`exit visibility: a frozen exit.pnl_pct > exit.peak_pnl_pct ... is clamped to the peak on
  exit_pnl_pct AND mfe_capture_pct`) asserting `board.ledger[0].exit_pnl_pct === 17.5` (not the raw
  `18.3`) and `board.ledger[0].mfe_capture_pct === 100` (not the nonsensical `105` the unclamped
  division would have produced).
- **RED:** temporarily reverted the clamp call at both new call sites (kept the shared helper
  itself and both tests intact) and re-ran
  `node --import tsx --experimental-test-module-mocks --test cortex-read.test.ts
  zerodte-service.test.ts` → exactly the 2 new assertions failed (`not ok 4`, `not ok 50`), every
  other test in both files still passed.
- **GREEN:** restored the fix and re-ran the same two files plus `record.test.ts` and
  `marks-math.test.ts` together → 183/183 pass, 0 fail.
- `npx tsc --noEmit`: clean.
