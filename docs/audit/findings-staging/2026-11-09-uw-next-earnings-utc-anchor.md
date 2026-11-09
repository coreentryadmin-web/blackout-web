# 2026-11-09: UW next-earnings fallback anchored "today" to UTC instead of ET — mislabels dates every evening

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`fetchUwTickerNextEarnings` (`src/lib/providers/unusual-whales.ts`) is the UW REST fallback path
`uw-earnings.ts`'s `fetchNextEarningsDate` calls whenever Benzinga's structured calendar has no
future row for a ticker (and, per the already-documented, still-open Polygon/Massive Benzinga
entitlement loss in `CLAUDE.md`, this fallback is now exercised far more than it used to be). It
computed its "today" anchor with `new Date().toISOString().slice(0, 10)` — the **UTC** calendar
date — then passed it into `pickUwNextEarningsRow(rows, todayYmd)` to decide which rows count as
"upcoming" (`d >= todayYmd`).

Every other `today`/`now` anchor in this exact file already goes through `todayEt()` (imported at
the top of the file, used at lines 624, 1200, 1267, 1363, and as the `expiry` default at line
533) — this one call site, added when `fetchUwTickerNextEarnings` was first written, was the
outlier, not a deliberate choice.

## Root cause

UTC is 4-5 hours ahead of `America/New_York`. From roughly 8pm ET (7pm during EST) to midnight ET
— a real, recurring ~4-5 hour window every single day — the UTC calendar date has already rolled
over to tomorrow while it is still today in New York.

A same-day earnings row (e.g. a BMO print whose `report_date` is today's real ET date) is compared
as:

```
d (today's ET date) >= todayYmd (tomorrow's UTC date)   →  false
```

so `pickUwNextEarningsRow` wrongly treated TODAY's own scheduled report as already in the past and
skipped straight to the ticker's next calendared print — reporting the wrong `earnings_date` and
`days_until` (via `uw-earnings.ts`'s `parseNextEarnings`) for the rest of the evening, every
evening, for any ticker this fallback path serves. This is a distinct bug from the one PR #7102
fixed in the same function (`pickUwNextEarningsRow` itself, which correctly excludes an
already-*reported* same-day row via `actual_eps == null`) — #7102 left the `today` computation
itself UTC-anchored, so the two bugs compound: even a genuinely *unreported* same-day row could be
wrongly excluded by the stale UTC boundary alone, hours before the dedup logic PR #7102 added ever
gets a chance to matter.

### Why this was missed

`pickUwNextEarningsRow` itself is pure and already unit-tested — those tests pass a literal
`todayYmd` string directly, so they never exercise how that string gets produced. The bug lived
entirely in the one line that *computes* `today` inside `fetchUwTickerNextEarnings`, which had no
test coverage at all (it's an async function that calls the network).

## Evidence (RED → GREEN)

Extracted the anchor computation into a new pure, directly-testable export,
`uwEarningsAnchorYmd(now: Date = new Date())`, so the fix itself is covered without mocking
network. RED proof via `git stash` on the source file only (test file kept):

```
# src/lib/providers/unusual-whales.test.ts, pre-fix (source stashed, test present)
not ok 47 - uwEarningsAnchorYmd: anchors to the ET calendar date, not UTC's, across the evening boundary
  error: '(0 , import_unusual_whales.uwEarningsAnchorYmd) is not a function'
not ok 48 - uwEarningsAnchorYmd: agrees with the UTC date during the day (no DST/boundary edge)
  error: '(0 , import_unusual_whales.uwEarningsAnchorYmd) is not a function'
# tests 48, pass 46, fail 2
```

GREEN (fix unstashed):

```
# tests 48, pass 48, fail 0
```

`npx tsc --noEmit` (Node 20.20.0): clean.

## Fix

```ts
// before
export async function fetchUwTickerNextEarnings(ticker: string) {
  const data = await uwGetSafe<unknown>(`/api/earnings/${safeTicker(ticker)}`, {});
  const rows = extractRows(data as Record<string, unknown>);
  const today = new Date().toISOString().slice(0, 10);
  return pickUwNextEarningsRow(rows, today);
}

// after
export function uwEarningsAnchorYmd(now: Date = new Date()): string {
  return todayEt(now);
}

export async function fetchUwTickerNextEarnings(ticker: string) {
  const data = await uwGetSafe<unknown>(`/api/earnings/${safeTicker(ticker)}`, {});
  const rows = extractRows(data as Record<string, unknown>);
  const today = uwEarningsAnchorYmd();
  return pickUwNextEarningsRow(rows, today);
}
```

`todayEt` was already imported in this file (`@/lib/et-date`), so this is a one-line behavior
change plus an extraction for testability — no new dependency.

### What was deliberately left unchanged

`pickUwNextEarningsRow`'s own predicate (fixed by #7102) is untouched and correct as-is; this PR
only fixes what gets passed in as `todayYmd`. `uw-earnings.ts`'s `fetchNextEarningsDate` already
computes its own `days_until`/stale-row guard against `todayEtYmd()` correctly (it is a separate,
already-ET-anchored call) — that downstream consumer was not itself wrong, it was just being fed a
wrong *candidate row* by this upstream fallback during the evening window. No gate, score, or
decision logic changed; this is a pure data-correctness fix to a provider-layer date anchor.

## Blast radius

One file (`src/lib/providers/unusual-whales.ts`) plus its test file. Checked repo-wide for other
callers of `fetchUwTickerNextEarnings`: only `uw-earnings.ts`'s `fetchNextEarningsDate`, which is
itself shared by the Meridian earnings panel, swing catalyst reads, and the Largo ecosystem-context
arsenal (`assembleEcosystemArsenal`) — all benefit from the corrected anchor with no call-site
changes needed, since the fix is entirely internal to `fetchUwTickerNextEarnings`.
