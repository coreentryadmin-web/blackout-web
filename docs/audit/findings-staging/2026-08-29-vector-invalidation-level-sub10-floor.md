## Vector's invalidation-level parser silently dropped any real level under $10 — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in `fix/vector-invalidation-level-sub10-floor` |
| **Severity** | P1 — real trade decision surface, Vector live contract-pick status |
| **Surface** | `src/features/vector/lib/vector-pick-live-status.ts` `parseInvalidationLevel` (feeds `isSetupInvalidated` / `evaluateVectorPickLiveStatus`) |

### Root cause

`parseInvalidationLevel` walks every numeric substring in a play's invalidation string (e.g.
`"5m close > 7,600 (wall breaks)"`), skipping the ones immediately followed by a timeframe suffix
(`m`/`M`/`H`, matching `tfLabel`'s own output format in `vector-play-engine.ts`: `"5m"`, `"15m"`,
`"1H"`), and returns the first remaining number as the invalidation price level. It also required
`n >= 10` before accepting a match — a floor with no comment explaining it and no relationship to
the timeframe-token skip logic, which is already handled correctly by the tail-character check.

Vector is explicitly **not** restricted to a preset ticker universe —
`isVectorTickerAllowed` (`src/features/vector/lib/vector-ticker.ts:37`) accepts any well-formed,
optionable symbol by design ("any optionable symbol works... this gate exists purely to reject
junk/injection"). Plenty of real, actively-traded optionable tickers sit under $10. For any such
ticker, a legitimate invalidation string like `"5m close < 8.50 (wall breaks → support lost)"`
parsed to `null` (the `8.5 < 10` check rejected the only real number in the string), which meant
`isSetupInvalidated`'s `level`-gated branches (`"close >"`, `"close <"`, `"back through"`) could
never fire — the pick's setup-invalidation status was silently stuck at "not invalidated"
regardless of what spot actually did, for the entire class of sub-$10 tickers.

### Evidence

Two new regression tests in `vector-pick-live-status.test.ts`:
- `parseInvalidationLevel("5m close < 8.50 ...")` returned `null` before the fix (now returns
  `8.5`); `parseInvalidationLevel("15m close > 3.25")` likewise.
- `isSetupInvalidated(8.6, "5m close > 8.50 (wall breaks → fade void)", "short", null, null, null)`
  returned `{ invalidated: false, level: null }` before the fix (spot at 8.6 is above the 8.50
  ceiling, which should invalidate a short fade) — now correctly returns
  `{ invalidated: true, level: 8.5 }`.

16/16 tests pass in the affected file, `npx tsc --noEmit` clean.

### Blast radius

Single function, single call site chain: `parseInvalidationLevel` is only called from
`isSetupInvalidated` (same file), which is only called from `evaluateVectorPickLiveStatus` (same
file) and directly by its own test suite. No other consumer duplicates this parsing logic.

### Fix rationale

Removed the `n >= 10` condition, keeping only `Number.isFinite(n)`. The timeframe-token exclusion
this floor was seemingly guarding against is already fully handled by the tail-character check
(`tail === "m" || tail === "M" || tail === "H"`) a few lines above — every timeframe string
`tfLabel` can produce (`"5m"`, `"15m"`, `"1H"`, `"1.5H"`, etc.) is caught by that check on its own,
so the extra numeric floor served no purpose except rejecting genuine low-priced levels. No
alternative considered: there is no legitimate reason to reject a finite parsed number here once
the timeframe-token case is excluded.
