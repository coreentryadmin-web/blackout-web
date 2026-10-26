## Night Hawk 0DTE: `GET /api/market/zerodte/board` rounded `setups[].plan.greeks` and `ledger[].greeks` (delta/gamma/theta/vega/iv) to a flat 2dp, risking silent 0.00 for real small gamma/vega — `/record` audited and found NOT actually affected (correcting the originating report)

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production health-check audit, Ask Largo × Night Hawk Swings standing ownership mandate (this finding is 0DTE/Night Hawk Command, swept under the same mandate's "complete Night Hawk product ... 0dte, Swings, Legacy" hourly item), 2026-10-26 |
| **Scope** | `src/app/api/market/zerodte/board/route.ts` (the `roundFloats()` call). `src/app/api/market/zerodte/record/route.ts` audited and found **not** to serve a `greeks` field at all — see "Correction vs. the originating report" below. |

### Root cause

`GET /api/market/zerodte/board` wraps its whole payload in a bare `roundFloats(await
getZeroDteBoardPayload())` — default `dp=2`, no `keyDp` override. Two real, unrounded greek
sources feed into that payload:

- `setups[].plan.greeks` — `plan.ts`'s `buildContractPlan` does `greeks: input.greeks` with no
  rounding (plan.ts:574), fed by `scan.ts`'s `{ greeks: { delta: snap.delta ?? null, gamma: ...,
  theta: ..., vega: ... } }` straight off the live `OptionSnapshot` (scan.ts:1576).
- `ledger[].greeks` — `zerodte-service.ts`'s ledger-row builder does `greeks: liveMark?.greeks ??
  null` (zerodte-service.ts:646), sourced from the 1s live-mark store's `ZeroDteGreeks` (delta,
  gamma, theta, vega, **and iv** — live-marks.ts:104-110), never rounded upstream.

Both are the same instrument/field shape the sibling `GET /api/market/zerodte/marks` route already
protects: `live-marks.ts`'s `buildZeroDteLiveMarksPayloadFrom` rounds with an explicit `keyDp`
(`ZERODTE_MARKS_WIRE_DP`: gamma/vega 6dp, delta/theta/iv 4dp) specifically because "Live SPY 0DTE
gamma is routinely 0.0008-0.05 ... the 2dp default would quantize it to 0.00 and DESTROY the
number" (round-floats.ts's own header; live-marks.ts's doc comment gives the same rationale with
the exact SPY 0.000800 example). The board route never got the matching override — this exact bug
class was already found and fixed twice elsewhere in this codebase (Vector's
`vector-response-rounding.ts`, 2026-08-07; `GET /api/market/nighthawk/horizons`, which fixed the
identical delta/gamma/theta/vega/iv field names for its own spliced SWING-lane contracts) but
board/route.ts was never given the same treatment.

### Correction vs. the originating report

The report that triggered this audit also named `GET /api/market/zerodte/record` as carrying the
same defect ("This flat 2dp pass also rounds ... `ledger[].greeks`" for both routes). **That claim
does not hold up under inspection and I did not change `record/route.ts`.** Traced the full path:
`record.ts`'s `ZeroDteRecordPlay` type has no `greeks`/`ledger`/`setups` field at all — its only
per-play passthrough is `entry_context: Record<string, unknown> | null`. At commit time
(`scan.ts`'s entry-context builder, ~line 2037-2099), the ONLY greeks-shaped thing ever written
into `entry_context` is `shadow_signals.contract_greeks` — the `ContractGreeksQuality` SHADOW
diagnostic (`low_delta`/`high_theta_decay`/`theta_decay_pct`/`note`, a set of derived
booleans/labels, not the raw delta/gamma/theta/vega numbers) — never a raw `greeks` key. A
repo-wide grep of `record.ts` for `greeks` returns zero hits, and `ZeroDteSetupLogRow`'s other
candidate field (`plan_json`, the printed plan at first flag, which if read WOULD carry
`plan.greeks`) is never read by `record.ts` at all. So the record route genuinely does not serve a
`greeks` field today, under any key, and there is nothing for a 2dp default to destroy there. This
is exactly the kind of "verify against the current source, don't trust the report at face value"
discipline the repo's own audit culture calls for — the bug is real, but only for `/board`.

### Evidence

Confirmed by reading the live `main` source directly (not reproducing in production): `board/
route.ts:62` called `roundFloats(await getZeroDteBoardPayload())` with no second/third argument,
while the identical-shaped field set is explicitly protected at `live-marks.ts:849-864`
(`ZERODTE_MARKS_WIRE_DP`) for the sibling `/marks` route and at `nighthawk/horizons/route.ts:156`
for the SWING-origin splice. Reproduced the destructive-rounding failure mode directly with a new
regression test (see below): a fixture `setups[].plan.greeks.gamma = 0.0021` and
`ledger[].greeks.vega = 0.0046` (both realistic SPY 0DTE magnitudes, per live-marks.ts's own
documented range) served through the UNFIXED route rounded to `0` — confirmed RED via `git stash`
of the route fix with the test kept in place, then GREEN after applying the fix.

### Fix

Added a local `ZERODTE_BOARD_GREEKS_WIRE_DP` keyDp map to `board/route.ts`
(`{ delta: 4, theta: 4, iv: 4, gamma: 6, vega: 6 }`) and passed it as the third argument to the
route's `roundFloats()` call. Values are copied verbatim from `live-marks.ts`'s
`ZERODTE_MARKS_WIRE_DP` (not imported — `live-marks.ts` pulls in the WS/Redis mark-poller import
graph that `zerodte-service.ts`'s own lazy dynamic `import("../zerodte/live-marks")` deliberately
keeps out of this route's import graph, same discipline that comment documents) so the SAME
contract reads identically whether a member/Largo-tool reads it via `/board` or `/marks`. `delta`
is included even though it rarely needs more than 2dp (well above 2dp resolution in practice) for
parity with the sibling constant and because a future low-delta far-OTM 0DTE contract could still
benefit from it; this mirrors the horizons route's own stated rationale for including `delta`
alongside gamma/theta/vega.

`reconcileTrancheFractions` composition (the existing `ledger[].timeline_tranches` fixup
immediately following the `roundFloats()` call) is unaffected — it runs on the post-round payload
exactly as before, on a field this fix does not touch.

### Regression test

`src/app/api/market/zerodte/board/route.test.ts` (new file — no prior test existed for this
route): mocks every route dependency (auth, db, market-api-auth, tool-access-server,
ws/init-data-sockets, the sim-board branch) and keeps `roundFloats`/`NextResponse` real, then
asserts a fixture `setups[].plan.greeks`/`ledger[].greeks` (gamma 0.0021, theta -0.0183, vega
0.0046, iv 0.2714 — realistic SPY 0DTE magnitudes) survive at full precision on both the setup and
ledger paths, while an unrelated money-math float (`7499.360000000001`) still rounds to 2dp —
proving the fix is scoped to the greek fields and doesn't disable rounding generally.

One pre-existing test needed updating for the same reason: `zerodte-sim-board.test.ts`'s
"board route rounds member-visible floats at the API boundary" test asserted an exact source-text
regex (`roundFloats\(await getZeroDteBoardPayload\(\)\)`, no trailing args) — updated to tolerate
an optional `dp`/`keyDp` tail, the same "named-import drift guard... tolerate... rather than an
exact match" philosophy its own existing comment already states for the adjacent import-list
assertion.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/app/api/market/zerodte/board/route.test.ts`
  — RED pre-fix (gamma/vega destroyed to 0.00, confirmed via `git stash` of the route fix with the
  test kept in place), GREEN post-fix.
- `npx tsx --experimental-test-module-mocks --test` over all 132 zerodte-scoped `*.test.ts` files
  (Node 20) — 1910 pass / 0 fail / 1 unrelated pre-existing skip, both before this change (for the
  132-file baseline) and after.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
