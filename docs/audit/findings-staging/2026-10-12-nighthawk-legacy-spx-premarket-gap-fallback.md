## 2026-10-12 — [FINDING, P2 Night Hawk Legacy/correctness] Morning-confirm SPX premarket gap silently fell back to previous_close, fabricating a flat "0.00%" gap — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Night Hawk Legacy morning-confirm cron (`nighthawk-morning-confirm/route.ts`) | P2 — fabricated market-context signal feeding both the member-facing macro badge and the per-play morning-confirm verdict | FIXED |

**What's wrong.** Spotted live on the production Legacy board (`/nighthawk?view=legacy`, 2026-10-12
mid-RTH via `proxy-browser.cjs`): the macro strip read `SPX gap +0.00 (0.00%)` while the SAME
edition's recap text, rendered a few lines above it, read `Gap up 0.27% to 7786.36` — a visible
contradiction on one page, and SPX's own live price at the time (7811.54, +0.59% per
`GET /api/market/zerodte/board`) made an exact flat gap implausible on its face.

Root cause: `fetchSpxPremarket()` (the route's own helper, WS-first then REST-snapshot) falls back
to `fetchIndexSnapshots(["I:SPX"])` (`src/lib/providers/polygon.ts`) when the live WS candle isn't
fresh yet — true for the entire window the morning-confirm cron runs in (~9:15 ET, before the first
SPX index print of the session). `fetchIndexSnapshots`'s own price resolution is a fallback chain:
```
const price = Number(row.value ?? row.session?.close ?? row.session?.previous_close ?? 0);
```
Pre-market, both `row.value` (today's live print) and `row.session?.close` (today's session close)
are genuinely absent, so this silently resolves to `row.session?.previous_close` — **yesterday's
close** — and returns it as `quote.price` with no signal to the caller that it isn't a live figure.

The route then computes `gapPts = spxPremarket - priorClose`, where `priorClose` is an
*independently* fetched prior-session close (Polygon daily bars). When `spxPremarket` is secretly
also the prior close, `gapPts` collapses to exactly `previous_close - previous_close = 0` — a
fabricated "flat market" reading, not an honest "no live premarket print yet" state. This value
then:
1. Renders directly to members as `SPX gap +0.00 (0.00%)` in `LegacyMacroStrip.tsx`.
2. Feeds `computePlayVerdict()` (`morning-confirm-verdict.ts`), which treats `gapPts` as a *real,
   evaluated* gap check (`checksEvaluated++`, `Math.abs(gapPts) > GAP_PTS_THRESHOLD`) rather than
   correctly abstaining — so a play could be recorded as having *passed* a gap-context check that
   never actually ran.

**Fix.** Added `resolveLiveIndexPrice()` (`src/features/nighthawk/lib/morning-gap-source.ts`), a
pure helper that compares the returned `price` to the same quote's own `prev_close` field (which
`fetchIndexSnapshots` already returns alongside `price`) — if they're identical, the "live" price is
really just yesterday's close reflected back, so it returns `null` instead. Wired into
`fetchSpxPremarket()`'s REST-fallback branch in place of the bare `spx?.price ?? null`. The WS-first
branch (`getStockLiveCandle("SPX")`) is untouched — it already carries its own freshness guard and
isn't the fallback path that produces this collision.

With the fix, a genuine pre-market data gap now correctly produces `gapPts: null`, which
`computePlayVerdict()` already handled everywhere it's used (`gapPts !== null` guards every
read site — confirmed by code inspection, all 26 existing tests in
`morning-confirm-verdict.test.ts` still pass unchanged) — so this converts a false "gap check
passed" into a correct "gap check withheld," with zero blast radius outside this one call site.
`fetchIndexSnapshots` itself (9 other call sites across Vector/SPX/Largo/0DTE) is untouched;
confining the fix to Legacy's own `fetchSpxPremarket()` avoids any cross-product risk.

**Regression guard.** New `src/features/nighthawk/lib/morning-gap-source.test.ts` (4 cases): returns
the price when it genuinely differs from `prev_close`; returns `null` on the exact collision this
bug produces; returns the price as-is when `prev_close` is unknown (can't detect the collision, so
don't guess); returns `null` for a null/undefined quote. `npx tsx --experimental-test-module-mocks
--test src/features/nighthawk/lib/morning-gap-source.test.ts` — 4/4 pass. Full `tsc --noEmit`
clean (0 errors). Existing `morning-confirm-verdict.test.ts` — 26/26 pass unchanged.

**Evidence captured.** Live screenshot of the contradiction (`/tmp/legacy-board-correct.png`, not
committed — local-only audit artifact) via `proxy-browser.cjs 'https://blackouttrades.com/nighthawk?view=legacy'
... --desktop`, cross-checked against `GET /api/market/nighthawk/edition`'s `recap_summary` text and
`GET /api/market/zerodte/board`'s live SPX price, both fetched the same cycle.
