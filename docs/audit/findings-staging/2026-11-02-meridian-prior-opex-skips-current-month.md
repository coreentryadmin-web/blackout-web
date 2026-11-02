> **kind:** FINDING

## Meridian `priorOpexDates` unconditionally skipped the current month's own OpEx — FIXED

**Status:** FIXED

### Root cause

`priorOpexDates(beforeYmd, limit)` in `src/features/meridian/lib/meridian-timeline.ts` walks
backward month-by-month from `beforeYmd` looking for monthly-OpEx dates strictly before it:

```ts
for (let i = 0; i < 36 && out.length < limit; i++) {
  m -= 1;                       // <-- decremented BEFORE the first check
  if (m < 1) { m = 12; y -= 1; }
  const opex = monthlyExpiryYmd(y, m);
  if (opex && opex < beforeYmd) out.push(opex);
}
```

The month is decremented *before* the very first check on every call, so the function never
evaluates `beforeYmd`'s own calendar month at all — it jumps straight to the month before. If
that month's OpEx (the third Friday, holiday-rolled via `monthlyExpiryYmd`) has already passed
and is therefore genuinely `< beforeYmd`, it is simply never considered, even though it is by
definition the single most recent qualifying OpEx date.

This holds for roughly half of every month — any day from the OpEx date itself (exclusive)
through the end of the month.

### Evidence

August 2026's OpEx (third Friday) is `2026-08-21` (`thirdFridayYmd(2026, 8)`). For any date in
the back half of August:

```
priorOpexDates("2026-08-25", 6)
// before fix: ['2026-07-17','2026-06-18','2026-05-15','2026-04-17','2026-03-20','2026-02-20']
// after fix:  ['2026-08-21','2026-07-17','2026-06-18','2026-05-15','2026-04-17','2026-03-20']
```

`2026-08-21` — the OpEx that just happened — never appeared pre-fix. A new regression test
(`priorOpexDates: INCLUDES the current month's own OpEx once it has already passed`) fails RED
on the pre-fix code (`dates[0]` comes back `'2026-07-17'` instead of `'2026-08-21'`) and passes
GREEN post-fix — verified both ways via `git stash`/`git stash pop` in this session.

The one pre-existing test for this function (`priorOpexDates: walks back monthly third
Fridays`) happened to never catch this because it calls `priorOpexDates` with `beforeYmd` set
to the exact OpEx date itself (`"2026-08-21"`) — at that boundary `opex < beforeYmd` is already
false whether or not the current month is checked, so the bug was invisible to it.

### Blast radius

Both real production call sites of `priorOpexDates`:
- `loadMeridianOpexHistory` / `loadMeridianOpexHistoryWithHeatmap` (`src/lib/meridian/meridian-opex-history.ts`)
  — the Meridian "prior OpEx sessions" history panel (SPX reaction, max pain, pin-held verdict
  per row).
- `loadMeridianOpexCrossMarket` (`src/lib/meridian/meridian-opex-cross-market.ts`) — the OpEx
  cross-market panel (SPX/SPY/QQQ/IWM/Mag7 reactions + top movers across prior OpEx sessions).

Both were silently missing the single most-recent OpEx row — effectively one month stale —
for the back half of nearly every calendar month, with no error anywhere (the function returns
a shorter-but-plausible-looking list, not an obviously wrong or empty one).

### Fix rationale

Move the month decrement to the END of the loop body so the current month is checked first
(iteration 0 uses `beforeYmd`'s own `(y, m)`), then walks backward exactly as before. The
`opex < beforeYmd` guard still correctly excludes the current month's OpEx when it has not
happened yet (or equals `beforeYmd` itself), so every existing caller/test that relied on
"only strictly-past dates" behavior is unaffected — the only change is that a past-but-currently-
skipped month is no longer skipped. The loop bound stays at 36 iterations; coverage is shifted
by one (current + 35 prior months instead of 36 strictly-prior months), which is immaterial
against the `limit` (6) every caller actually uses.

No other call site, and no other function in this file, shared this bug — `upcomingOpexDates`
walks FORWARD from the current month correctly (checks `(y, m)` before incrementing).
