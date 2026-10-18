> **kind:** FINDING

## Meridian's market-wide Benzinga earnings-window fetch silently truncated a busy window to the first ~2 pages — FIXED

| **Status** | Fixed (`fetchBenzingaStructuredEarnings()`, `src/lib/providers/polygon.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive (5-engine monitor cycle, 2026-10-18), while
auditing the swing play-brief's "Catalysts & news" vs "Meridian catalysts" sections for consistency.

**Live repro.** Two real, currently-committed Swing positions — RBLX (earnings 2026-10-29) and SOFI
(earnings 2026-10-27) — both showed their real earnings date correctly in the brief's main "Catalysts
& news" section (a different, per-ticker Benzinga lookup), but the brief's separate "Meridian catalysts"
section said *"No catalysts in the 14-day Meridian window... calendar is quiet, not missing"* — a direct
contradiction for a ticker with a real, known, near-term print.

**Root cause.** `loadBenzingaEarningsBundle()` (`src/lib/meridian/meridian-benzinga-earnings.ts`) feeds
Meridian's market-wide window scan (Meridian's timeline, Largo's `get_meridian_timeline` tool, and
Swing's "Meridian catalysts" section all read this same `window_rows`) via
`fetchBenzingaStructuredEarnings({ ..., limit: 120, sort: "date.asc", paginate: true })`. The pagination
loop inside `fetchBenzingaStructuredEarnings` was hardcoded to follow at most **2 more** `next_url`
pages after the first (`for (let page = 0; page < 2 && nextPath; page += 1)`) — a fixed 3-page / 360-row
total budget regardless of how dense the requested date window actually is. Results are sorted
`date.asc`, so once a window's early dates alone produce enough rows to exhaust that budget, every later
date — including RBLX's and SOFI's own, already-known earnings dates — is silently dropped before the
fetch ever reaches them. This is the exact same shape as the already-fixed `barLimitForWindow` defect
documented in this file's own "Data-correctness notes" (a fixed cap on a date-sorted fetch silently
drops the far end, presenting as "we don't have that data" rather than as a truncated fetch).

**Evidence of density.** A direct market-wide timeline fetch over the relevant window showed a single
real earnings week (days 2–6 of a 21-day Meridian window) alone producing **~269 rows** at
`limit=120`/page — already past the old 360-row total budget before the date-ascending fetch could ever
reach day 10+ of the window, let alone RBLX (day ~11) or SOFI (day ~9).

**Blast radius.** One call site: `loadBenzingaEarningsBundle()` is the only caller that passes
`paginate: true` to `fetchBenzingaStructuredEarnings`. Confirmed `loadBenzingaBoardEarnings()` (a
separate rescue path limited to today's 0DTE board tickers) does not set `paginate: true` and is
unaffected.

**Fix.** Widened the cap to a named `MAX_EXTRA_PAGES = 20` (chosen off the live-measured peak single-day
density of 99 earnings items — generous headroom without removing the bound entirely, since an
adversarial/malformed `next_url` chain must not hang a request forever). Per this file's "no silent
caps" discipline, if the cap is still hit while a `next_url` remains, a `console.warn` logs it so a
still-truncated result is discoverable rather than silently read as "the calendar is quiet."

**Tests.** New `src/lib/providers/benzinga-earnings-pagination.test.ts` mocks `polygonTrackedFetch` (via
`node:test`'s `--experimental-test-module-mocks` + `mock.module()`, per the established
`ex-dividend-reads.test.ts` pattern) so the real pagination loop runs for real against a fake paginated
upstream: one test confirms more than 2 extra pages are followed when available (the live RBLX/SOFI
repro shape), one confirms the safety cap still bounds the loop and logs a warning when exceeded.
RED→GREEN proven via `git stash` of the source file alone (both subtests fail against the old
hardcoded 2-page cap — 1 and 3 rows respectively instead of 7 and 21 — 0 fail with the fix restored).
Broader regression: `src/lib/meridian/*.test.ts` + `src/lib/providers/*.test.ts` + `src/lib/swing/*.test.ts`
— 2927/2927 pass. `tsc --noEmit`: clean.

**Sandbox note for future runs of this test:** this sandbox's `POLYGON_API_BASE` env var can resolve to
the literal unresolved string `"POLYGON_API_BASE"` (documented elsewhere in this file) rather than a
real URL — `fetchBenzingaStructuredEarnings`'s own `BASE` constant reads straight off that env var, and
its pagination loop's `new URL(nextPath, BASE)` throws on that literal, silently truncating to 1 page
via the loop's own `catch { break; }`. Run the test with `POLYGON_API_BASE` unset
(`env -u POLYGON_API_BASE`) to get a real base URL default.
