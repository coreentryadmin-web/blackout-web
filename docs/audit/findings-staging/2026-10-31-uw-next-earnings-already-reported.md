> **kind:** FINDING

## UW `fetchUwTickerNextEarnings` returned an already-reported same-day print as "next earnings" — FIXED

| | |
|---|---|
| **Area** | `src/lib/providers/unusual-whales.ts` (shared provider, consumed by Meridian/BIE/Night Hawk Cortex next-earnings reads) |
| **Status** | FIXED (PR, this branch) |
| **Severity** | P2 — correctness defect on a data-arsenal field several lanes read for "is earnings coming up" context |

### Root cause

`fetchUwTickerNextEarnings(ticker)` reads UW's `/api/earnings/{ticker}` feed, which carries BOTH
past prints and the future estimate in one array (confirmed by the sibling
`fetchUwTickerEarningsHistory`'s own comment on the same endpoint). It picked "next" with:

```ts
const today = new Date().toISOString().slice(0, 10);
return rows.find((r) => {
  const d = String(r.earnings_date ?? r.date ?? r.report_date ?? "").slice(0, 10);
  return d >= today;
}) ?? null;
```

A date-only `d >= today` filter is not "upcoming": Benzinga/UW both leave a same-day row's
`report_date`/`earnings_date` unchanged after it reports, so a BMO print that already posted its
`actual_eps` *this morning* still has `date === today`, sorts to the front of the array (array
order, not a date sort), and gets returned as the "next" earnings for the rest of the day — until
the following quarter's row gets calendared months later.

This is the exact same bug shape fixed twice already in the Meridian/Benzinga lane:
- `meridian-ticker-lookup-core.ts`'s `pickUpcomingEarningsRow` (#7100)
- `meridian-benzinga-earnings-core.ts`'s `parseNextEarningsFromBenzinga` (#7101, merged same day
  as this finding)

Both of those fix the Benzinga-sourced path. `fetchUwTickerNextEarnings` is the independent UW
REST **fallback** path (`uw-earnings.ts`'s `fetchNextEarningsDate` calls it when Benzinga has no
future row for the ticker) and carries the identical unguarded predicate, confirmed live via the
`/api/earnings/{ticker}` feed's own documented shape (`uw-earnings-normalize.test.ts`'s verbatim
WMT fixture: `actual_eps: null` pre-print, non-null post-print — the feed's own "has this printed"
signal).

### Evidence (RED → GREEN)

RED — reproduced the real behavior with the pre-fix predicate against a WMT-shaped row pair
(already-reported same-day row + the real future row):

```
OLD buggy pick: { symbol: 'WMT', report_date: '2026-08-20', actual_eps: 2.45 }
CONFIRMED: old logic returns the already-reported same-day row as 'next' (the bug).
```

GREEN — after extracting the pure predicate into `pickUwNextEarningsRow(rows, todayYmd)` and
adding `&& r.actual_eps == null`, 4 new unit tests in
`src/lib/providers/unusual-whales.test.ts` pass (same-day-already-reported skipped, real future
row returned, a genuine `actual_eps: 0` still counted as reported — not falsy-coerced into
"missing" — and the no-qualifying-row-returns-null case). Full existing suite for the file (34
tests) green on Node 20.

### Blast radius

`fetchUwTickerNextEarnings` → `uw-earnings.ts`'s `fetchNextEarningsDate` (UW fallback branch,
used whenever Benzinga has no future row for a ticker) → consumed by `src/lib/bie/ecosystem-context.ts`,
`src/lib/bie/verdict.ts`, and `src/lib/nighthawk/cortex/fetch.ts`. No other call site reads
`fetchUwTickerNextEarnings` directly. The fix is at the shared provider layer, so every consumer
benefits without a separate change in each lane — same shape as the `unavailableSources`
forwarding fix the Largo mandate notes in `CLAUDE.md` describe for `buildRichEnvelope()`.

### Fix rationale

Extracted the selection logic into an exported pure function, `pickUwNextEarningsRow(rows,
todayYmd)`, mirroring `parseNextEarningsFromBenzinga`'s shape exactly (same fix pattern, same file
family) rather than mocking the network call — this repo's own environment notes warn against
`mock.module()` breaking tsx's alias resolution, and a pure function taking the already-fetched
rows needs no mock at all. `== null` (not a falsy/truthy check) is deliberate: a genuine EPS print
of exactly `0` must still read as reported, not be miscounted as "no actual yet" and kept as
upcoming.

Left unchanged: the UTC-vs-ET `today` computation (`new Date().toISOString().slice(0, 10)`) is a
separate, pre-existing quirk (could misattribute "today" near midnight UTC) — out of scope for
this single-issue fix; worth a follow-up if it's ever shown to matter in practice.
