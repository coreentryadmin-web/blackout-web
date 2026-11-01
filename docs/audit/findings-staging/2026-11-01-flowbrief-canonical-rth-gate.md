> **kind:** FINDING

## HELIX `FlowBrief` hand-rolled RTH check missed NYSE early-close and holiday sessions — FIXED

**Status:** FIXED (PR pending merge)

### Root cause

`src/features/helix/components/FlowBrief.tsx` hand-rolled its own `isRTH()` check instead of
importing the repo's canonical cash-RTH gate, `isEtCashRth` (`src/lib/et-market-hours.ts`,
explicitly documented there as *"Canonical cash RTH gate — used by UI polling, options WS,
correctness, and cron health"*).

The duplicated logic was a plain weekend check plus a fixed `9:30–16:00 ET` window:

```ts
function isRTH(): boolean {
  // ...weekday from Intl, hour/minute from Intl...
  if (["Sat", "Sun"].includes(weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960; // 9:30–16:00 ET
}
```

It has no awareness of:
- **NYSE early-close half days** (Black Friday, Christmas Eve — cash session ends at 1:00 PM ET,
  not 4:00 PM ET). The canonical `isEtCashRth` already handles this via
  `getEarlyCloseMinutes` (`spx-play-session-guards.ts`).
- **Full-day NYSE holidays that fall on a weekday** (Thanksgiving, July 4th, Christmas, New
  Year's Day, etc.). The canonical helper checks `isTradingDayEt`; the duplicated logic only
  ever excluded Saturday/Sunday.

So between 1:00 PM and 4:00 PM ET on an early-close day, and all day on a full weekday holiday,
`FlowBrief` kept believing the market was open: it continued auto-refreshing
`/api/market/flow-brief` and rendering the "AI brief · Live" banner/brief text instead of
switching to the "After hours"/"Market closed" copy and visual treatment the component itself
ships specifically for exactly this state.

This is the same duplicate-instead-of-import shape that produced the no-store-headers
duplication bug (#7137 in this sweep's history) and the orphaned-lookup-table bug (#7141) — a
second, hand-maintained copy of logic a canonical helper already owns, which silently drifts the
moment a case (here, early close / full holiday) the canonical helper already handles is
actually reached.

### Evidence (RED → GREEN)

New regression test `src/features/helix/components/flow-brief-rth-gate.test.ts` reproduces the
OLD duplicated logic inline (it never lived anywhere else; it is now fully removed from
`FlowBrief.tsx`) and compares it against the canonical `isEtCashRth`:

- **2026-11-27 13:30 ET (Black Friday, early close at 1:00 PM ET):** old logic → `true`
  (wrongly says market open); canonical `isEtCashRth` → `false` (correct).
- **2026-11-26 11:00 ET (Thanksgiving, full NYSE closure, a Thursday):** old logic → `true`
  (wrongly says market open — it only ever excluded Sat/Sun); canonical → `false` (correct).
- **2026-11-23 13:00 ET (an ordinary Monday mid-session):** both agree → `true`, confirming the
  two only diverge on the early-close/holiday cases this fix targets, not on every input.

```
npx tsx --experimental-test-module-mocks --test src/features/helix/components/flow-brief-rth-gate.test.ts
# 3 pass, 0 fail
npx tsx --experimental-test-module-mocks --test src/lib/et-market-hours.test.ts
# 7 pass, 0 fail (canonical helper's own existing coverage, unaffected)
npx tsc --noEmit
# clean
```

### Blast radius

Single call site — `FlowBrief.tsx`'s local `isRTH()` was not imported or reused anywhere else
(confirmed via repo-wide grep for `isRTH\b`), so this is a one-file fix. No other component in
`src/features/helix` or elsewhere hand-rolls the same 9:30–16:00 window (checked for additional
`getHours()`/`getUTCHours()`/manual-weekday-only RTH checks outside the excluded lanes listed in
this sweep's task brief — the other hits found were either display-time formatting, unrelated
X-marketing post-cadence scheduling that already handles DST/holidays correctly on its own terms,
or local-time-only timestamp formatting, none of them a duplicate of the cash-RTH gate).

### Fix rationale

Replaced the three call sites (`refresh()`'s gate, the post-mount resolver, and the 60s re-check
interval) with the canonical `isEtCashRth` import from `@/lib/et-market-hours`, and deleted the
now-dead local `isRTH()` entirely. `isEtCashRth` is pure (`Intl` + the existing
`getEarlyCloseMinutes`/`isTradingDayEt` helpers, no Node-only APIs), so it is safe to call from
this `"use client"` component exactly as `admin-cron-health.ts` already does server-side — no new
runtime dependency, no behavior change to any other consumer, and the canonical helper's own
existing test suite (`et-market-hours.test.ts`) already proves the early-close/holiday cases it
now covers for `FlowBrief` too.

`etHour()` (used only to deterministically pick an after-hours copy line, not to gate RTH) was
left untouched — it is not a duplicate of any gating logic, just a display-rotation index.
