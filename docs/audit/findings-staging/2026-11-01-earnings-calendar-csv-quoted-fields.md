> **kind:** FINDING

## `/api/market/earnings-calendar` naive `split(",")` drops rows whose company name contains a comma — FIXED

| | |
|---|---|
| **Area** | `src/app/api/market/earnings-calendar/route.ts` |
| **Status** | FIXED (PR open) |
| **Bug shape** | measured-zero-conflated-with-absence (CSV parse corruption, silently swallowed by a downstream shape check) |

### Root cause
`loadEarningsCalendar()` parsed the Alpha Vantage `EARNINGS_CALENDAR` CSV response
(`symbol,name,reportDate,fiscalDateEnding,estimate,currency`) with a plain
`lines[i].split(",")`, then read `reportDate` by the fixed index `cols[2]`.

That is correct only as long as no field contains the delimiter. RFC 4180 CSV quotes any
field that does — and plenty of real tickers have a comma in their legal company name
(`"Brown & Brown, Inc."`, `"AMC Entertainment Holdings, Inc."`, etc.), which a
spec-compliant CSV generator renders as `BRO,"Brown & Brown, Inc.",2024-07-24,...`. A plain
`split(",")` has no notion of quoting: it splits that one quoted field into two extra
columns and shifts every column after it to the right, so `cols[2]` no longer holds
`reportDate` — it holds part of the company name.

Why this never threw or logged: the corrupted value almost never happens to match
`/^\d{4}-\d{2}-\d{2}$/`, so the existing date-shape guard does exactly what it's supposed to
do against garbage input — it rejects the row and the loop moves on. The ticker's real,
present earnings date is silently absent from the output `Record<string, string>` map,
which every caller reads as "no upcoming report for this ticker" rather than "we failed to
parse this ticker's row." That is the measured-zero-conflated-with-absence shape: a row the
feed genuinely has gets presented as a row that doesn't exist.

### Evidence (RED → GREEN)
Added `src/app/api/market/earnings-calendar/csv-parse.ts` (`parseEarningsCalendarCsvLine`,
a small RFC 4180 quoted-field line parser) plus
`src/app/api/market/earnings-calendar/csv-parse.test.ts`. The second test
(`"keeps column count correct when the name field is RFC4180-quoted with an embedded
comma"`) asserts directly against the shipped line shape:

```
BRO,"Brown & Brown, Inc.",2024-07-24,2024-06-30,0.98,USD
```

- Old code's exact call, `line.split(",")`, run inline in the test for comparison:
  `naiveSplit[2]` is `'"Brown & Brown'` (part of the name), not `2024-07-24` — the test
  asserts `naiveSplit[2]?.trim() !== "2024-07-24"` to pin this down as a real, reproducible
  defect in the old code path, not a hypothetical.
- New `parseEarningsCalendarCsvLine(line)[2]` is `"2024-07-24"` — correct.

5/5 tests pass post-fix (`npx tsx --experimental-test-module-mocks --test
src/app/api/market/earnings-calendar/csv-parse.test.ts`); `npx tsc --noEmit` clean; the
existing `src/lib/largo/earnings-calendar-for-largo.test.ts` (the consumer-side envelope
test covering this same route) still passes 10/10 unchanged.

### Blast radius
- `GET /api/market/earnings-calendar` itself — every member/desk reader of this route's
  `earnings` map was silently missing any ticker whose company name has a comma.
- `src/lib/largo/earnings-calendar-for-largo.ts` / `run-tool.ts` — Largo's
  `get_earnings_calendar` tool reads this exact route via `callInternalApiRead`, so any
  comma-containing-name ticker it was asked about would have answered "no upcoming report"
  incorrectly.
- **Known, intentionally NOT fixed here**: `src/lib/zerodte/earnings.ts`'s
  `loadAvEarningsCalendar()` is a byte-for-byte duplicate of this same parsing logic
  (its own comment calls it "same 3-month feed as `/api/market/earnings-calendar`"), with
  the identical `split(",")` + fixed-index-2 bug. `src/lib/zerodte/` is out of scope for
  this lane (hard exclusion list) — flagging here so the owning lane can apply the same
  `parseEarningsCalendarCsvLine`-shaped fix (or import this module directly) to
  `loadAvEarningsCalendar()`.

### Fix rationale
Replaced the fixed-index `split(",")` with a minimal, dependency-free RFC 4180 line parser
(quoted fields, embedded commas, `""`-escaped quotes) rather than pulling in a CSV library
for one small internal use, or special-casing "commas inside quotes" with a regex (fragile
and harder to verify than a straightforward state-machine parser). Left the surrounding
cache/auth/response logic in `route.ts` untouched — this is purely a parsing-correctness
fix at the one call site that builds the `cols` array.
