> **kind:** FINDING

## `loadMeridianTickerLookup` can report an ALREADY-REPORTED earnings print as "upcoming" — FIXED

**Status:** Fixed in this PR (`fix/meridian-earnings-reported-as-upcoming`).

### Root cause

`src/lib/meridian/meridian-ticker-lookup.ts`'s `loadMeridianTickerLookupUncached` picked the
"next upcoming earnings" row like this:

```ts
const upcoming = rows.find((r) => r.date >= today && r.actual_eps == null) ?? rows[0] ?? null;
```

`rows` comes from `fetchBenzingaStructuredEarnings({ ticker, dateGte: today, limit: 5 })` — up to
5 structured earnings rows for this ticker, sorted `date.asc`, every one dated today or later.
`actual_eps == null` is the field's own signal for "hasn't reported yet" (a real EPS of `0` parses
to the number `0`, not `null` — see `shapeBenzingaStructuredEarnings`'s `num()` helper — so this
check is not fooled by a genuine zero print).

The `.find(...)` correctly skips a row that has already reported, even though its date is today
or later (same-day BMO reports have `date === today` and a populated `actual_eps` within minutes
of the print). The bug is the fallback: when **every** row Benzinga currently has on file for this
ticker has already reported — the ordinary state right after a same-day BMO print, before the
*next* quarter's date has been calendared yet, which can easily be the only row `dateGte=today`
returns — `.find(...)` returns `undefined` and the code fell through to `rows[0]`, the oldest of
those already-reported rows, and returned it as the "upcoming" earnings. Concretely: ticker reports
pre-market on 2026-10-31, actual EPS posts by ~7am ET, and a member/caller asks for this ticker's
next earnings at 9am ET the same day, before Benzinga has added the 2027 Q1 date — the function
returns `found: true`, `earnings.date: "2026-10-31"`, `earnings.days_until: 0`,
`message: "AAPL reports 2026-10-31 — outside the current lane window."`, describing a print that
already happened as if it were still ahead.

This is not a rare theoretical edge: it is the *normal* state of the data for the first several
hours after every single-digit-DTE BMO report, for any ticker whose next date isn't calendared yet.

### Blast radius

Two real call sites consume this function's output, both affected identically because both read
`earnings`/`found`/`message` verbatim with no independent sanity check of their own:

1. `src/app/api/market/meridian/lookup/route.ts` — the Meridian ticker-search lookup a member
   hits by typing a ticker into the Meridian search box.
2. `src/features/vector/lib/vector-pick-enrichment.ts`'s `loadVectorPickEnrichment` — called for
   **every Vector desk contract pick**, feeding an "earnings" catalyst card
   (`VectorPickCatalyst`, `kind: "earnings"`, `daysUntil: e.days_until`) that is shown on the pick
   itself. A trader opening a position shortly after a ticker's own BMO print could be shown a
   stale "earnings today" catalyst for a risk that had already resolved hours earlier, with
   nothing distinguishing it from a genuine upcoming print.

### Evidence

RED→GREEN on the extracted pure selector, `pickUpcomingEarningsRow` (new
`src/lib/meridian/meridian-ticker-lookup-core.ts`, unit-tested in the sibling `.test.ts`):

- Reverted to the old `?? rows[0] ?? null` fallback and ran
  `npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-ticker-lookup-core.test.ts`:
  **4 pass / 1 fail** — the new regression test (`"returns null, NOT the stale already-reported
  row, when every candidate row has already reported"`) fails, asserting `null` but getting the
  already-reported row (`actual_eps: 1.64`) back.
- Restored the fix (plain `.find(...) ?? null`, no `rows[0]` fallback): **5/5 pass.**
- `npx tsc --noEmit` clean on the whole project.
- Full `npm test` run clean (see PR CI) — no other suite references this selection logic, since
  `meridian-ticker-lookup.ts` itself (which imports `"server-only"`) had no prior test file at all.

### Fix rationale

Extracted the selection rule into a small pure function, `pickUpcomingEarningsRow(rows, today)`,
in a new sibling module **without** `"server-only"` (`meridian-ticker-lookup-core.ts`) — the same
split this codebase already uses throughout `lib/meridian/` (e.g. `meridian-reaction.ts` vs
`meridian-reaction-core.ts`) specifically so the server-only wrapper's import doesn't block a
plain `tsx --test` run from loading the logic. `meridian-ticker-lookup.ts` had no test file before
this change; it now delegates to the tested core function instead of carrying the bug inline.

The fix itself is to drop the `?? rows[0]` fallback and return `null` when no not-yet-reported row
exists — the caller's existing `!upcoming` branch already handles "not found" honestly
(`found: false`, `"No upcoming earnings found for {ticker} in the next few months."`), so no new
branch was needed, only removing the one line that bypassed it. This matches the module's own
existing honest-absence convention (same principle as the Largo product contract's
confidence-omission rule elsewhere in this repo): reporting nothing is correct when nothing
genuinely upcoming is known; guessing a past date back out as current is not. Deliberately left
unchanged: the `dateGte: today` + `actual_eps == null` logic itself (already correct), the
`!upcoming` "not found" branch, and the caching/TTL layer in `meridian-ticker-lookup.ts`.
