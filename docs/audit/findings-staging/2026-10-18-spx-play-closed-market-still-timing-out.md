> **kind:** FINDING

## SPX Slayer closed-market `/api/market/spx/play` still reliably times out — the 2026-10-17 fix didn't reach the real bottleneck — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-visible, 100%-reproducing off-hours/weekend, every single poll) |
| **Found by** | 5-engine live monitor cycle, SPX Slayer live health check, 2026-10-18 |

### Root cause

A 2026-10-17 fix (PR #6114, `fix/spx-play-closed-market-cold-cache-timeout`) added an early
market-closed branch to `evaluateSpxPlayState()` (`src/features/spx/lib/spx-service.ts`) so a
closed-market read could skip `buildPlayTechnicals()`/`refreshOrBreakMemory()`/
`resolveGuardedPlaybookMatch()` — real Polygon/DB calls that blow the 800ms
`playMemberReadMaxBlockMs()` budget on a cold per-process cache. That fix's own root-cause
analysis assumed `loadMergedSpxDesk()` (called unconditionally at the top of the same function,
*before* the new closed-market check) was cheap/already warm — but it is itself wrapped in its own
`withServerCache` with a 3,000ms `deskBootstrapMaxBlockMs()` budget, and that cache (`spx-merged:
<date>`) is reliably cold off-hours/weekends (nothing RTH-gated keeps it warm then). Since 3,000ms
already exceeds the *outer* 800ms budget wrapping the whole `evaluateSpxPlayState()` call, the
outer `getSpxPlayState()` (`withServerCache("spx-play-read:<date>", ..., maxBlockMs:
playMemberReadMaxBlockMs())`) threw `ServerCacheTimeoutError` before the 2026-10-17 fix's own
closed-market branch was ever reached — the fix removed the *wasted* expensive calls but left the
*necessary* (and itself slow-on-cold-cache) desk load unconditionally in the hot path.

Live re-confirmation, 2026-10-18 (market closed, Sunday): 4/4 fresh probes plus 15/15 independent
occurrences in CloudWatch over two separate ~15-min windows, 0 successes — every single
`GET /api/market/spx/play` call logged `ServerCacheTimeoutError: [server-cache] spx-play-read:
2026-10-18: cold miss exceeded maxBlockMs` and served the misleading "Play scan still catching up
— retry shortly" placeholder, which (per the 2026-10-17 finding's own correct diagnosis) can never
resolve by retrying while the market stays closed.

### Fix

Added `peekMergedSpxDesk()` to `src/features/spx/lib/spx-desk-loader.ts` — a true non-blocking
peek (Redis/L1 only, mirrors the existing `peekSpxDesk()` pattern for the single-layer desk cache)
that never invokes the real builders. In `evaluateSpxPlayState()`, when
`!isSpxEngineCronWindow()` (i.e. confidently outside real trading hours — not 7am–4:15pm ET on a
trading day), try this peek first; if it returns a bundle with `market_open: false` (and we're not
in the premarket window), build the closed-market snapshot from the *peeked* bundle instead of
paying for a fresh `loadMergedSpxDesk()` call. Only when the peek can't answer (null, market open,
or premarket) does the code fall through to the existing unconditional `loadMergedSpxDesk()` call
and its own fresh-`merged`-based closed-market check — unchanged from before this fix.

The peek is deliberately given a generous staleness ceiling (`maxStaleMs: 24h`) rather than the
generic 10-minute default: once the market is genuinely closed, "stale" and "correct" are the same
thing — a Friday-close snapshot read on a quiet Sunday is accurate, not wrong. The
`!isSpxEngineCronWindow()` guard is what keeps this safe: it is false for the entire 7am–4:15pm ET
trading-day window, so the shortcut categorically never activates during or near real trading
hours — every trading-hours eval (and any off-hours eval where the peek can't answer, e.g. a
genuinely cold replica with no cached snapshot anywhere) takes the exact same fresh-load path as
before this fix, byte-for-byte.

### Blast radius

One function (`evaluateSpxPlayState`), one new exported peek helper. `getSpxDeskSummary()` and
every other `loadMergedSpxDesk()` caller are untouched — this only changes the SPX *play* read's
own internal control flow, not the desk-loading contract itself.

### Fix rationale — why this, not an alternative

- **Why not just raise `playMemberReadMaxBlockMs()`?** Would apply to *every* cold eval, including
  real trading-hours ones where `buildPlayTechnicals` etc. still run unconditionally — exactly the
  trade-off the 2026-10-17 fix's own write-up explicitly rejected (risks blocking a member-facing
  read for longer on every cold eval, not just closed-market ones). The peek-based fix touches
  nothing about the trading-hours path at all.
- **Why not compute "market closed" from a pure clock check instead of peeking the desk?** No
  existing clock-only helper in `spx-play-session-guards.ts` exactly matches cash-market open/close
  (the closest, `isPastForceExitCutoff`, is deliberately 15 minutes earlier than the real close for
  force-flatten purposes) — reimplementing that boundary correctly (early closes, holidays) from
  scratch risked a new, subtly-wrong edge case in a file with a dense history of exactly that
  failure mode. Reusing the desk's own already-correct `market_open` field (just peeked instead of
  freshly loaded) avoids inventing a second, parallel definition of "is the market open."
- **Left unchanged**: `playMemberReadMaxBlockMs()`, `deskBootstrapMaxBlockMs()`, every trading-hours
  code path, `loadMergedSpxDesk()`'s own cache/fallback contract.

### Tests

- `src/features/spx/lib/spx-desk-loader.test.ts`: extended the existing cache-key-sharing test to
  also assert `peekMergedSpxDesk()` returns null before any build, then returns the exact bundle
  `loadMergedSpxDesk()` just cached, without rebuilding any layer (desk/pulse/flow counters stay
  at 1).
- `src/features/spx/lib/spx-service.play.test.ts`: updated the 2026-10-17 regression test for the
  `closedMarketPlaySnapshot` extraction, and added a new test asserting the `!isSpxEngineCronWindow()`-gated
  peek attempt runs *before* the unconditional `loadMergedSpxDesk()` call.

RED→GREEN proven via `git stash` of the two source files (`spx-desk-loader.ts`, `spx-service.ts`)
alone, tests kept: pre-fix, 3 tests fail (missing `peekMergedSpxDesk`/`closedMarketPlaySnapshot`/
`isSpxEngineCronWindow` guard); post-fix, 12/12 pass across both files, plus the full SPX-related
test set (71/71 across 8 files touching `spx-service`/`spx-desk-loader`/`spx-play-session-guards`).
`tsc --noEmit`: clean.
