## 2026-09-16 — [FINDING, FIXED] Legacy option-mark WS-freshness gate used 0DTE's 5s bar, not Legacy's own 30s bar

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — real positions can silently skip peak/trough tracking + trim/close evaluation for a full live-sync cron cycle; member-facing marks flicker stale on liquid names |
| **Lane** | Night Hawk Legacy |
| **PR** | fix/legacy-marks-ws-stale-threshold |

### Root cause

Earlier the same day, PR #5073 fixed `legacy-option-mark-row.ts`'s own `stale` computation, which
had been calling `isZeroDteMarkStale(asofMs, nowMs)` with no third argument — silently defaulting
to `ZERODTE_MARK_STALE_MS` (5s, calibrated for 0DTE's sub-second-relevant intraday scalping)
instead of `LEGACY_QUOTE_STALE_MS` (30s, the bar the client (`CommandDeck.tsx`/`PlayTerminal.tsx`)
already correctly applies for Legacy's next-day-digest, overnight-held positions).

That fix was correct but incomplete: it fixed the *final* staleness check, not an *earlier* gate
in the same pipeline that decides whether a cached WS tick is even considered "live" input in the
first place. Both real callers of `buildLegacyOptionMarkRow` —

- `src/app/api/market/nighthawk/legacy-marks/route.ts` (the member-facing marks API, read by
  `useLegacyOptionMarks`)
- `src/features/nighthawk/lib/legacy-option-marks-server.ts` (`fetchLegacyOptionMarksServer`, the
  function the **legacy-live-sync cron** calls directly to mark-and-manage real Chief Trade Alert
  Bot positions)

— call `getLiveOptionMarkSync(occ, ZERODTE_MARK_STALE_MS)` to fetch the cached WS tick. That
function (`src/lib/ws/options-socket.ts`) returns `null` — as if there were no WS tick at all —
whenever the cached tick is older than the `maxAgeMs` argument. Passing `ZERODTE_MARK_STALE_MS`
(5s) here meant any WS tick 5–30s old was silently discarded and the row fell through to the REST
snapshot fallback (`fetchOptionsUnifiedSnapshot`) — even when that REST snapshot's own quote clock
(`quoteUpdatedMs`) reflected an **equally or more stale** market quote than the WS tick that was
just thrown away. `buildLegacyOptionMarkRow`'s own (already-fixed, `LEGACY_QUOTE_STALE_MS`-based)
staleness check then correctly judged the row against the *older* of the two possible timestamps,
because the fresher one had already been discarded one layer up.

### Evidence

Live audit, 2026-09-16 ~18:36–18:38 UTC (mid-RTH, well within market hours): `GET
/api/market/nighthawk/legacy-marks?occs=CRWD260918C00242500,RIG260918C00006000,SWKS260918C00090000`
repeatedly returned `stale:true` for **CRWD** — a normal, liquid underlying, not a thin-liquidity
name like RIG — with `asof` lagging real time by 70–90 seconds across three consecutive polls
~1 minute apart (`18:36:10.475Z`, `18:37:32.965Z`, still climbing at the next poll), while SWKS in
the same response read fresh (`stale:false`, `asof` 1–4s old). The one-sided pattern — a liquid
name intermittently reading stale while a genuinely thin name (SWKS, sometimes RIG) reads fresh in
the same call — is the signature of a WS tick being discarded upstream of the staleness check,
not of the underlying quote genuinely going quiet.

### Blast radius

Two real call sites share the exact same defect (the duplicated `getLiveOptionMarkSync(occ,
ZERODTE_MARK_STALE_MS) ?? getLiveOptionMarkSync(legacyOccForSnapshot(occ), ZERODTE_MARK_STALE_MS)`
pattern), both fixed in this PR:

1. `legacy-marks/route.ts` — member-facing display; a falsely-stale mark flickers the live P&L
   panel and excursion graphic even when a fresh quote was actually available.
2. `legacy-option-marks-server.ts` — the **live-sync cron's own read path**. A falsely-stale row
   here is dropped entirely by `fetchLegacyOptionMarksServer`'s stale filter (unless the caller
   passes `includeStale`), and `runLegacyLiveSync` calls it *without* that flag — so a falsely-stale
   row causes `if (mark == null) { noQuote += 1; continue; }`, skipping peak/trough latching and
   trim/close evaluation for that real position for that entire ~5-minute cron cycle. This is the
   more serious half of the blast radius: it can under-report a position's true excursion and delay
   a mechanical exit decision, not just flicker a display.

Confirmed no other callers of `getLiveOptionMarkSync` are in scope: `vector/contract-picks/live/route.ts`
and `vector-pick-sweep.ts` are correctly 0DTE/Vector-scoped and correctly keep `ZERODTE_MARK_STALE_MS`.

### Fix

Both call sites now pass `LEGACY_QUOTE_STALE_MS` (30s) instead of `ZERODTE_MARK_STALE_MS` (5s) to
`getLiveOptionMarkSync`, consistent with the bar `buildLegacyOptionMarkRow`'s own staleness check
already uses. Both modules are Legacy-only (no horizon branching needed — same reasoning PR #5073
used for `legacy-option-mark-row.ts` itself).

### Fix rationale

The alternative — leaving the WS gate at 5s and only trusting `buildLegacyOptionMarkRow`'s final
check — silently prefers REST over WS whenever WS is 5–30s old, discarding the freshest available
signal for no reason grounded in this product's actual staleness tolerance. Matching the gate to
`LEGACY_QUOTE_STALE_MS` everywhere in the Legacy mark-assembly pipeline removes that asymmetry.

### Tests

`legacy-marks/route.test.ts` extended (source-level regression, matching the file's existing
`roundFloats` assertion convention — a Next.js route handler isn't easily invoked in this harness
without mocking auth/WS internals) + a new `legacy-option-marks-server.test.ts` (this module had no
prior dedicated test file). Both assert the `LEGACY_QUOTE_STALE_MS` import and call sites, and the
absence of a `ZERODTE_MARK_STALE_MS` import/call site. RED confirmed pre-fix (both new tests fail
against the original source via `git stash`), GREEN confirmed post-fix.
