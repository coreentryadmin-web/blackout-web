## SPX Slayer cold-replica pulse fallback hardcoded `market_status: "open"` regardless of `market_open` — FIXED

> **kind:** `FINDING`

**Status.** FIXED (PR pending).

### Area

SPX Slayer desk (`GET /api/market/spx/desk`) — `src/features/spx/lib/spx-desk.ts`'s
`buildSpxDeskPulseMinimal()`, the cold-replica/bootstrap fallback for `loadSpxDeskPulse()`
(`spx-desk-loader.ts`). Feeds `deskShellFromPulse()` -> `mergePulseIntoDesk()` ->
`buildBootstrapFastLane()`'s `desk` layer, which is what `GET /api/market/spx/desk` and the admin
SPX dashboard (`src/lib/admin-spx-dashboard.ts`'s `buildDeskIntel`) serve whenever the full
`buildSpxDesk()` build is cold/slow. Not owned-lane.

### Found by

Live SPX Slayer `/desk` + `/play` correctness check (score-vs-factors arithmetic, direction-vs-
score coherence, gates.blocks coherence, staleness), 2026-10-26, three consecutive live polls of
`GET /api/market/spx/desk` ~09:00-09:09 UTC Monday (pre-RTH, before the 9:30 AM ET cash open).

### Symptom

Live capture at `2026-10-26T09:09:19.276Z` (desk `as_of`), `GET /api/market/spx/desk`:

```json
{
  "available": true,
  "source": "none",
  "market_open": false,
  "market_status": "open",
  "market_label": "PRE-MARKET",
  ...
}
```

`market_open: false` and `market_status: "open"` directly contradict each other in the SAME
payload. `source: "none"` is the documented degraded-shell marker (`deskShellFromPulse`'s
fallback), confirming this was served off the cold-replica bootstrap path, not the normal merged
build. The same contradiction reaches the admin SPX dashboard verbatim:
`buildDeskIntel`'s `market: { open: desk.market_open, status: desk.market_status, ... }` would
render `open: false` next to `status: "open"` with no caveat.

### Root cause

`buildSpxDeskPulseMinimal()`'s live-price return branch computed a real `rthOpenNow` boolean
(`isSpxRthActive(new Date(), null)`) and correctly assigned it to `market_open`, but hardcoded the
sibling `market_status` field to the bare literal `"open"`:

```ts
market_open: rthOpenNow,
market_status: "open",
market_label: marketStatusLabel(new Date(), null),
```

So any time this cold-replica path served a response while `rthOpenNow` was `false` — the 4:00-
7:00 AM ET pre-market dead zone (before the SPX Slayer's own 7:00-9:30 AM "premarket planning
window" even starts), after-hours, or overnight — `market_open` and `market_status` disagreed.
`mergePulseIntoDesk()` (`spx-desk-merge.ts`) carries `pulse.market_status` straight through
unchanged (`market_status: pulse.market_status ?? base.market_status`), so the bug reached the
final `SpxDeskPayload` with nothing downstream correcting it.

Every OTHER `market_status` fallback in the same file keeps it consistent with the companion
`market_open`/`rthOpen` boolean when the live Polygon market-status provider (`marketNow`) is
unavailable:

- The three fully-"closed" pulse builders: `market_open: false, market_status: marketNow?.market
  ?? "closed"` (three call sites) / `market_status: "closed"` (two hardcoded-closed call sites).
- `buildSpxDesk`'s success branch and `deskShellFromPulse`'s own ternary:
  `premarketPlanNow && !rthOpenNow ? "premarket" : marketNow?.market ?? "open"` — this one's
  `?? "open"` default is only reached when `rthOpenNow` is *true* or the narrower premarket window
  is active, so it isn't self-contradictory the way the bare literal is.

`buildSpxDeskPulseMinimal` was the one outlier that never consulted `rthOpenNow` for
`market_status` at all.

### Fix

```ts
market_status: rthOpenNow ? "open" : "closed",
```

Mirrors the "closed" fallback already used by this file's other not-currently-open pulse builders
when the live provider is unavailable — minimal, scoped to the one outlier, and makes
`market_status` agree with `market_open` by construction instead of by coincidence of timing.

### Fix rationale

Considered mirroring the fuller `premarketPlanNow && !rthOpenNow ? "premarket" : ... ?? "open"`
ternary used at the other two call sites instead, but `buildSpxDeskPulseMinimal` never computes
`premarketPlanNow` or threads a real `marketNow` (it calls `isSpxRthActive(new Date(), null)` with
no market-status object at all) — importing that extra state just to reproduce a label this
function's own `market_label` field (`marketStatusLabel(new Date(), null)`, unchanged) already
derives correctly would be scope creep for a one-line self-consistency bug. The binary
`rthOpenNow ? "open" : "closed"` guarantees the field this fix targets — agreement with
`market_open` — without touching `market_label` or adding new inputs.

### Regression test

`src/features/spx/lib/spx-pulse-change-basis.test.ts` — new source-regex test (same style already
used by every other test in this file for `buildSpxDeskPulseMinimal`, which has Redis/provider
dependencies too heavy to mock for a behavioral test) asserts the live-price branch's
`market_status` line is `rthOpenNow ? "open" : "closed"` and never the bare `"open"` literal.
Confirmed RED against the pre-fix source (assertion failed), GREEN after the fix.

### Blast radius

Single call site (`buildSpxDeskPulseMinimal`). Checked every other `market_status` assignment in
`spx-desk.ts` (8 total) — all seven others already keep `market_status` consistent with
`market_open`/`rthOpen`; none needed the same fix. `mergePulseIntoDesk` (the carry-through layer)
and `admin-spx-dashboard.ts` (the consumer that surfaces the raw field) were read but not
changed — the bug was upstream of both.
