# 2026-09-04 — FlowFeed.tsx: two date/time-handling bugs (earnings-badge TZ off-by-one + replay NaN sort) — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Component** | `src/features/helix/components/FlowFeed.tsx` (HELIX `/flows` live tape) |
| **Status** | FIXED |

## Bug 1 (P2) — "days until earnings" badge used browser-local midnight instead of US/Eastern trading day

### Root cause

`earningsMap` (populated by `fetchEarningsCalendar()`) holds ticker → `"YYYY-MM-DD"` REPORT DATES
that are ET trading-calendar dates — the same convention Meridian's `report_date` uses elsewhere
in this codebase. But the `earningsDays` `useMemo` built its two comparison endpoints via:

```ts
const today = new Date();
today.setHours(0, 0, 0, 0);
...
const d = new Date(dateStr + "T00:00:00");
const diff = Math.floor((d.getTime() - today.getTime()) / 86_400_000);
```

Per ECMA-262, a date-time string with no offset (`"YYYY-MM-DDT00:00:00"`) parses in the runtime's
**local** timezone, and `.setHours(0,0,0,0)` mutates in local time too — neither endpoint was ever
anchored to `America/New_York`. Every other date-boundary computation in this codebase resolves
ET explicitly (`daysToExpiry` in `helix-flow-format.ts`, `todayEt`/`execAtEtYmd` in `et-date.ts`,
`isTradingDayEt`) — this one alone did not.

This value feeds `ctx.earnIn` in `flowSignals()` (`helix-flow-format.ts`), which renders the
trading-relevant EARN/E{n}D badge (tone "bear") flagging a print as tied to near-term earnings
risk — the one signal on the tape a member reads as "how many trading days until this print's
name reports."

### Evidence — verified failure case (reproduced before writing the fix)

A West Coast member (America/Los_Angeles, UTC-7) at `2026-09-04T22:00:00-07:00` = `2026-09-05
01:00 ET` — i.e. the ET trading day has **already rolled** to 2026-09-05, the ticker's actual
report date:

```
$ TZ=America/Los_Angeles node -e '
  const now = new Date("2026-09-04T22:00:00-07:00");
  const today = new Date(now); today.setHours(0,0,0,0);
  const d = new Date("2026-09-05" + "T00:00:00");
  console.log(Math.floor((d.getTime() - today.getTime()) / 86400000));
'
1
```

Local PT midnight (`today`) was still `2026-09-04 00:00`; target local midnight (`d`, for
`"2026-09-05"`) was `2026-09-05 00:00` → `diff = 1`. The badge would show **"E1D"** even though in
ET terms the print is happening **today**. The reverse misclassification happens for zones
*ahead* of ET (e.g. Europe) during the hours their local calendar date has rolled but ET's hasn't
— a naive local-Date computation would read that case as `diff = 0` ("today") when ET still says
tomorrow.

### Fix

Extracted a small pure, exported helper, `earningsDayDiffEt(dateStr, now)`, using the same
DST-safe technique `daysToExpiry` (`helix-flow-format.ts`) already uses: format `now` to its ET
calendar date via `Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })`, then
`Date.parse` **both** endpoints as literal UTC midnight of their respective `YYYY-MM-DD` strings.
Because both timestamps are parsed as explicit `...T00:00:00Z` calendar strings, their difference
is always an exact multiple of `86_400_000` — no real DST offset is ever applied — so this needs
no DST special-casing despite being pure arithmetic, unlike a hand-appended `-04:00`/`-05:00`
offset (which is what the task that produced this fix explicitly warned against).

Deliberately does **not** clamp to `Math.max(0, …)` the way `daysToExpiry` does: `earningsDays`'
caller filters on `diff >= 0 && diff <= 30`, so a report date that has already passed must still
come back negative (and get filtered out), not clamped to a false "today."

```ts
export function earningsDayDiffEt(dateStr: string, now: Date = new Date()): number {
  const todayEt  = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const todayMs  = Date.parse(`${todayEt}T00:00:00Z`);
  const targetMs = Date.parse(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(targetMs)) return NaN;
  return Math.round((targetMs - todayMs) / 86_400_000);
}
```

## Bug 2 (P3) — `startReplay()`'s sort produced NaN for undated rows

### Root cause

`startReplay()` sorted the tape with:

```ts
const sorted = [...alerts].sort((a, b) => new Date(a.alerted_at).getTime() - new Date(b.alerted_at).getTime());
```

`flow-persist.ts` documents that a freshly-streamed SSE row can carry `alerted_at: ""` when the
real UW print time is unknown (`event.alerted_at = realCreatedAt ?? ""`), and the merge path
(`helix-flow-tape-merge.ts`) deliberately keeps such rows in `alerts` rather than dropping them.
`new Date("").getTime()` is `NaN`, so any comparison involving that row returned `NaN` — an
`Array.prototype.sort` comparator-contract violation (the spec leaves the resulting placement of
such an element unspecified/engine-dependent) — unlike the null-safe `flowTimeMs`-based sort this
**exact same file** already uses a few lines below (`displayAlerts`'s sort, which explicitly
places a null time via `am == null ? 1 : ...`).

### Evidence

```
$ node -e '
  console.log(new Date("").getTime());     // NaN
  const arr = [{alerted_at:"2026-08-21T14:00:00Z"},{alerted_at:""},{alerted_at:"2026-08-21T10:00:00Z"}];
  const sorted = [...arr].sort((a,b)=> new Date(a.alerted_at).getTime() - new Date(b.alerted_at).getTime());
  console.log(JSON.stringify(sorted));
'
NaN
[{"alerted_at":"2026-08-21T14:00:00Z"},{"alerted_at":""},{"alerted_at":"2026-08-21T10:00:00Z"}]
```

The 10:00 row never moved ahead of the 14:00 row — the comparator's NaN return left the pair
"equal" to V8's stable sort, so a chronologically later row could sit before an earlier one on the
replayed tape whenever an undated row was anywhere in the array.

### Fix

Extracted the sort into a small pure, exported helper — `compareFlowAlertsByTimeAsc(a, b)` — built
on the same null-safe `flowTimeMs` helper `displayAlerts` already imports, with the identical
"undated sorts last, regardless of which side of the comparison it lands on" convention
`displayAlerts` established, just for the opposite (ascending, oldest-first replay) direction
instead of `displayAlerts`' descending (newest-first) one:

```ts
export function compareFlowAlertsByTimeAsc(a: FlowAlert, b: FlowAlert): number {
  const am = flowTimeMs(a);
  const bm = flowTimeMs(b);
  if (am == null && bm == null) return 0;
  if (am == null) return 1;
  if (bm == null) return -1;
  return am - bm;
}
```

`startReplay()` now does `[...alerts].sort(compareFlowAlertsByTimeAsc)`.

## RED → GREEN proof

New regression tests: `src/features/helix/components/FlowFeed.test.ts` (12 cases — 7 for
`earningsDayDiffEt`, 5 for `compareFlowAlertsByTimeAsc`, imported directly from `FlowFeed.tsx`).

```
$ git stash push -- src/features/helix/components/FlowFeed.tsx   # revert ONLY the source fix
$ node --import tsx --experimental-test-module-mocks --test src/features/helix/components/FlowFeed.test.ts
...
# pass 1
# fail 11        <- RED: `earningsDayDiffEt is not a function` (7x) + wrong ordering
                      with the undated row (3x) + the unparseable-timestamp case (1x)

$ git stash pop                                                   # restore the fix
$ node --import tsx --experimental-test-module-mocks --test src/features/helix/components/FlowFeed.test.ts
...
# pass 12
# fail 0         <- GREEN
```

The TZ-boundary test (`earningsDayDiffEt: THE BUG — West Coast member past ET midnight...`)
directly reproduces the verified failure case above; a companion test checks the reverse case
(a zone ahead of ET) and a third checks TZ-invariance of the same real instant across
`America/Los_Angeles` / `America/New_York` / `Europe/Berlin` / `UTC`.

## Full verification

- `npx tsc --noEmit` — clean.
- Full Helix test suite (`src/features/helix/**/*.test.ts`, 45 files): **328 tests / 16 suites,
  0 failures** (Node 20.20.2).

## Blast radius

Both bugs were local to `FlowFeed.tsx`'s own inline computations — no other file computed the
earnings day-diff or replay-sort this way. `daysToExpiry` (helix-flow-format.ts, the DTE column)
and `displayAlerts`'s own sort (a few lines below the fixed `startReplay`, in this same file) were
already correct and are what both fixes now match in technique/convention; they were not touched.

## Deliberately left unchanged

- `daysToExpiry`'s `Math.max(0, …)` clamp — correct for its own caller (a DTE can't be negative in
  the UI), and deliberately NOT reused for `earningsDayDiffEt`, which needs the unclamped sign to
  let its own `diff >= 0` filter correctly exclude a report date that has already passed.
- `flowFreshnessAtMs`/`newestAt`'s existing future-timestamp guard (`signalWindowAgeMs`, fixed
  2026-09-03) — a different bug, in a different computation, already covered by
  `FlowFeed-freshness-badge.test.ts`.

## Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` for the next-session RTH checklist entry for this fix
(EARN/E{n}D badge day-count spot-check across a non-ET-local session; replay ordering with a
live SSE-streamed undated row in the tape).
