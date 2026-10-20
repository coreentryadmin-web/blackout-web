## Every `/api/market/swing/play-brief` request 503'd with "Invalid time value" — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | Fixed (`src/lib/swing/play-brief-adapter.ts`) |
| **Severity** | P0 — total outage of a live product surface (Ask Largo swing play-brief), not a cosmetic defect |
| **Found via** | Live Ask Largo standing audit mandate (Night Hawk Swings lane), first requests after PR #6302's deploy-deadlock fix finally let a backlog of queued commits reach production |

### Live repro

`GET /api/market/swing/play-brief?ticker=SLV&...` (and NVDA, EWY — every ticker and status tried)
returned, 100% reproducible, 4/4 attempts on SLV alone:

```json
{ "available": false, "error": "swing brief unavailable", "unavailable": { "reason": "Invalid time value", ... } }
```

with HTTP 503. The horizons board endpoint (`/api/market/swing/board`) returned normal 200s in the
same window, ruling out a general outage — this was specific to the play-brief/Largo-adapter path.

### Root cause

Two files disagreed about what shape `asOf` is:

- `src/lib/swing/play-brief-context.ts`:
  ```ts
  const asOf = etStamp(nowMs) ?? new Date(nowMs).toISOString();
  ```
  `etStamp()` (`src/lib/largo/temporal/bar-session-date.ts`) already returns the Largo C1 display
  format **`"YYYY-MM-DD HH:mm ET"`** — not an ISO-8601 string. Since `nowMs = Date.now()` is always
  a finite positive number, `etStamp()` never returns null for it, so the `?? new
  Date(nowMs).toISOString()` fallback is dead code in practice: `ctx.asOf` is *always* the ET-stamp
  string, never ISO.

- `src/lib/swing/play-brief-adapter.ts`'s `formatAsOfET(isoString)` assumed the opposite — that its
  input is a raw ISO-8601 instant — and called `new Date(isoString)` on it directly, then
  `Intl.DateTimeFormat.formatToParts(date)`. Fed `"2026-10-20 00:47 ET"`, `new Date(...)` produces
  an Invalid Date, and `formatToParts()` throws `RangeError: Invalid time value` on an Invalid
  Date — on *every* call, unconditionally, because the mismatched input shape is unconditional.

This went undetected until now because:
1. The adapter's own unit tests (`play-brief-adapter.test.ts`) hand-supply a real ISO literal for
   `asOf` in their fixtures (`"2026-09-07T02:59:00.000Z"`) — a shape the real production context
   never actually produces — so the mismatch never exercised in CI.
2. The adapter shipped in `4349848f5` ("implement Largo product contract adapter for play-brief
   envelope") and was never route-level smoke-tested against a running server before this session's
   ECS deploy-deadlock (6 consecutive failed deploys, fixed by PR #6302) blocked it — and every
   other commit queued behind it — from ever reaching production until today.

### Fix

Replaced the broken local `formatAsOfET` with the already-correct, already-shared
`etStampFromIso()` helper (`src/lib/largo/temporal/bar-session-date.ts`), which handles both shapes
`asOf` can actually carry:
- An already-ET-stamped string: `Date.parse("YYYY-MM-DD HH:mm ET")` fails (`NaN`), so it falls back
  to returning the input unchanged — which is already the correct output.
- A genuine ISO string (the context's dead-but-real fallback branch): parses and reformats into
  the same ET-stamp shape via `etStamp()`.

No behavior changes for the already-passing ticker_class tests; the `as_of` field now actually
matches `src/lib/largo/contract/product-read.ts`'s own `ET_STAMP` validation regex instead of
throwing before a response is ever built.

### Blast radius

Checked for a second, independent `new Date(<ET-stamp-string>)` call site with the same mismatch:
none found — `formatAsOfET` in `play-brief-adapter.ts` was the only consumer of
`SwingPlayBriefResult.asOf` that tried to re-parse it as ISO. No other product (0DTE, Legacy,
Helix, Vector, Meridian) uses this same context/adapter pair.

### Regression test

Added two tests to `src/lib/swing/play-brief-adapter.test.ts`:
- `"must not throw when asOf is the ET-stamp format the real context actually produces"` — RED
  before the fix (`RangeError: Invalid time value`, reproducing the live 503 exactly), GREEN after.
- `"still formats a genuine ISO asOf correctly (the context's own fallback shape)"` — proves the
  ISO-input path still works post-fix.

Verified RED→GREEN via `git stash`, full suite 16382 pass / 0 fail on Node 20
(`npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-adapter.test.ts` and
`npm test`), plus a clean `tsc --noEmit`.
