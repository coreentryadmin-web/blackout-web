# get_swing_horizon: Largo's SWING lane tool carried no freshness/time field at all — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/largo/product-reads.ts` — `swingHorizonForLargo()` (the `get_swing_horizon` Largo tool) |
| **Severity** | P3 — Largo-facing correctness/contract gap, no member-facing UI or trading-logic impact |
| **Found by** | DISCOVERY 24/7 audit sweep, 2026-09-04 |

## Root cause

`docs/audit/LARGO-PRODUCT-CONTRACT.md` names **time** and **freshness** as two of the ten points
every Largo product read must carry — the whole point being that a model reading a desk's data can
tell whether it is looking at something live or something stale. Every sibling tool in
`product-reads.ts` follows this: `bangerBoardForLargo` stamps `as_of` / `as_of_et` / `session_date`;
`nighthawkHorizonsForLargo` does the same at its own top level; `zerodteRecordForLargo` carries
`since`/`through`.

`swingHorizonForLargo()` — the direct implementation behind the `get_swing_horizon` tool — did not.
It calls:

```ts
const snap = await readSwingServingSnapshot().catch(() => null);
const lane = await getSwingServingLane({ ..., spotsByTicker: snap?.spotsByTicker });
return roundFloats({ available: true, ...(openPositionsRead ? {} : {...}), ...compactSwingLane(lane) });
```

`snap` is a `SwingServingSnapshot` (`src/lib/swing/serving-lane.ts`) which already carries its own
`asOf: string` ("ISO timestamp the scan was taken (for freshness/debug)") and `sessionDay: string`
("ET session day the scan is anchored to") — fields that exist *specifically* to answer the freshness
question. The function fetches `snap` anyway (to pull `spotsByTicker`), reads two of its fields, and
never reads the other two — `compactSwingLane()` doesn't touch them either. The result: every call to
`get_swing_horizon` returned `section_counts`/`sample_plays`/`score_floor` etc. with **zero
indication of when the underlying discovery scan ran**, even though the persisted snapshot's TTL is
26 hours (`SWING_SERVING_TTL_SEC`) — meaning the data behind a response could legitimately be nearly
a full day old with nothing in the payload to say so. A model asked "how fresh is the swing board
right now?" had no field to read; one asked to compare SWING freshness against another product's
`as_of` (a cross-product question the whole contract exists to make answerable) could not.

This is a genuinely different bug from a *stale* timestamp — it is a **missing** one. The two other
readers of `readSwingServingSnapshot()` in the codebase do surface it: the admin debug route
(`src/app/api/admin/swing/discovery-debug/route.ts:45-46`) returns `asOf`/`sessionDay` directly, and
`src/app/api/market/nighthawk/horizons/route.ts` (the real member route) fetches the same `snap` for
the identical `spotsByTicker`-only reason — that route's own top-level `board.asOf` comes from the
*0DTE* payload (`horizonBoardFromZeroDtePayload(payload, payload.as_of)`), not the SWING scan, so
the swing lane's own freshness is likewise unsurfaced there. Only the Largo tool is fixed here — the
member route's `HorizonBoard.asOf` is a different data shape (`assembleHorizonBoard`/`withLane`)
whose per-lane freshness would need a wider, separately-scoped change; noting it here as blast radius,
not fixing it in this PR to keep the diff single-issue.

## Evidence

- `git stash` on `src/lib/largo/product-reads.ts` alone (keeping the new test file) reproduces the
  pre-fix state: `node --experimental-test-module-mocks --import tsx --test
  src/lib/largo/product-reads-swing-freshness.test.ts` → 2/2 tests FAIL (`r.scan_as_of` /
  `r.scan_session_day` both `undefined`, expected `"2026-09-03T14:22:00.000Z"` /
  `"2026-09-03"` and `null` respectively — the field didn't exist at all).
- Restoring the fix → 2/2 PASS.
- `src/lib/largo/product-reads.test.ts` (the full existing suite, including
  `nighthawkHorizonsForLargo()`'s own session-anchor assertions, which transitively call
  `swingHorizonForLargo()`) still 33/33 green post-fix — the new fields are additive and don't
  disturb any existing consumer.
- `npx tsc --noEmit` clean.

## Fix

Added `as_of` / `as_of_et` / `session_date` (this read's own clock, matching every sibling tool's
convention) and — separately, deliberately not conflated with the above — `scan_as_of` /
`scan_session_day` (the persisted discovery snapshot's own `asOf`/`sessionDay`, already fetched into
`snap` for `spotsByTicker` and now also threaded into the response). `scan_as_of`/`scan_session_day`
are `null`, never fabricated, when no scan has ever been persisted (`snap` is `null` — an honest
discovery-gated empty lane, the same failure mode `openPositionsRead` already handles for the open
book).

## Blast radius

One function, `swingHorizonForLargo()`. `nighthawkHorizonsForLargo()` calls it and passes the result
through under its own `swing` key unchanged, so it also gains the new fields automatically — no
separate change needed there. No other caller of `swingHorizonForLargo` exists.
