## Night Hawk Swings (Banger lane): `banger-live-sync` cron persisted the RAW, unguarded options-snapshot `ask` into `banger_positions`, reproducing the dead-bid-plus-backstop-ask nonsensical-spread defect already fixed for the sibling `swing-active-refresh` cron — live on production for Banger-origin committed SWING positions

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production health-check audit, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-26 (external finding report, independently re-verified against `main`) |
| **Scope** | `src/app/api/cron/banger-live-sync/route.ts` (`fetchMarks`'s `updateBangerQuoteFields` call) |

### Root cause

`banger-live-sync/route.ts`'s `fetchMarks` closure guards the resolved MARK via
`reliableMarkFromSnapshot(snap)` (dead-bid backstop-ask divergence guard — see
`options-snapshot.ts`'s own doc comments, CRSR 2026-09-14 / CRI 2026-10-08) but then persisted
quote fields via `updateBangerQuoteFields(positionId, { bid: snap.bid, ask: snap.ask, ... })` — the
RAW, unguarded provider ask, never passed through `reliableAskFromSnapshot`. That raw
`banger_positions.ask` flows unchanged into `horizonPlayFromBangerPosition`
(`src/lib/swing/banger-lane-merge.ts`: `bid: row.bid, ask: row.ask`), which is what
`GET /api/market/nighthawk/horizons?view=swings` serves as `contract.bid`/`contract.ask`, and what
`liquidityFromContract` (`src/features/nighthawk/command-deck/adapters.ts`) turns into
`spreadPct = (ask - bid) / mid` for the Command Deck / play-brief Spread line.

This is the IDENTICAL root cause already found, fixed, and documented in `docs/audit/FINDINGS.md`
under the 2026-10-24 finding "Swing play-brief/horizons Spread line could render a nonsensical
percentage from an unguarded backstop ask" (CAG repro: `bid:0, ask:3.90, mid:0.03` → Spread
13000.0%) — but that fix (adding `reliableAskFromSnapshot` and wiring it into `loadOptionQuote` in
`src/app/api/cron/swing-active-refresh/route.ts`) only touched the organic-swing live-refresh cron.
Its own Blast radius section explicitly discussed and excluded the Banger lane's pre-entry WATCH
rows (`horizonPlayFromBangerWatch`) as a structurally different, unaffected shape, but never
examined the Banger lane's COMMITTED/OPEN-position live-sync cron (`banger-live-sync/route.ts`),
which has the exact same unguarded-ask gap via a separate code path that also calls
`fetchOptionsUnifiedSnapshot`/`reliableMarkFromSnapshot` from the same
`src/lib/providers/options-snapshot.ts` module. Confirmed via repo-wide grep (re-run on `main` at
the time of this fix): `reliableAskFromSnapshot` was imported in `swing-active-refresh/route.ts`
and `src/features/nighthawk/lib/option-chain-prompt.ts`, but NOT in `banger-live-sync/route.ts` —
independently reproducing the external report's own grep.

### Evidence

Live-reproduced by the reporting audit on 2026-10-26, three independent tickers, in BOTH the
horizons board snapshot and a play-brief fetch minutes later (a persistent bad value, not a one-tick
transient): WEN (positionId 2098) `contract {bid:0, ask:5, mid:0.05}` rendered "Spread: 10000.0%
($0.00/$5.00)"; ASO (positionId 2094) `{bid:0, ask:20, mid:0.35}` rendered "Spread: 5714.3%
($0.00/$20.00)"; LMND (positionId 2017) `{bid:0, ask:2.8, mid:0.42}` rendered "Spread: 666.7%
($0.00/$2.80)". A fourth ticker, CRML (positionId 2134), showed the same shape on the horizons
snapshot but had self-healed to a sane `{bid:0.15, ask:0.25}` five minutes later on the next cron
tick — confirming the provider genuinely emits this backstop-ask shape intermittently for cheap,
illiquid, far-OTM Banger weeklies, so whichever tick lands when a member or Ask Largo reads the
board/brief is what gets served. All four were BANGER-signalKind, status COMMIT, serving MANAGING
live positions.

This session independently re-verified the claim against the current `main` (commit `0fc533cda`)
before touching anything: read `banger-live-sync/route.ts` directly and confirmed `ask: snap.ask`
on the `updateBangerQuoteFields` call (no guard), confirmed `reliableAskFromSnapshot` exists in
`options-snapshot.ts` and is wired into `swing-active-refresh/route.ts` but not this file, and
traced the downstream path through `banger-lane-merge.ts` → `adapters.ts`'s `liquidityFromContract`
to confirm the same `(ask - bid) / mid` computation the external report described.

### Fix

Mirrors the already-shipped `swing-active-refresh` fix exactly: imported `reliableAskFromSnapshot`
into `banger-live-sync/route.ts` and changed `ask: snap.ask` to `ask: reliableAskFromSnapshot(snap)`
in the `updateBangerQuoteFields` call. `BangerQuoteFieldsUpdate.ask` already typed as
`number | null`, so this is a zero-schema-change, same-shape fix — no migration, no downstream type
changes needed. `reliableAskFromSnapshot` reuses the mark guard's own divergence math (never
reimplements it), so the ask nulls out here exactly when the mark guard already rejected the
snapshot's mid as an unfillable backstop quote, and a null ask reaches `liquidityFromContract` as
an honest "spread not priceable" case rather than a false precise one.

Deliberately left unchanged: the quote-tick log (`persistBangerQuoteTick`) still persists the raw
snapshot's `bid`/`ask` for its own prospective validation purpose (a separate, disclosed,
fire-and-forget ground-truth log, never read by the decision path) — only the LIVE
`banger_positions` row (the one `horizonPlayFromBangerPosition` reads) gets the guarded ask. The
resolved MARK logic (`reliableMarkFromSnapshot`, the scale-out decision path) is untouched.

### Blast radius

Only one call site persists quote fields onto `banger_positions` (`updateBangerQuoteFields` is
called from exactly one place in the repo, inside this route's `fetchMarks`), so this is the
complete fix for the Banger-origin committed-position path. The Banger lane's pre-entry WATCH rows
(`horizonPlayFromBangerWatch`) remain out of scope, as the original 2026-10-24 fix's own Blast
radius section already established — they read from a different, unaffected shape (no live
`banger_positions` row to begin with).

### Regression test

`src/app/api/cron/banger-live-sync/route.test.ts`: *"banger-live-sync's fetchMarks guards the
persisted ask through reliableAskFromSnapshot, not the raw snapshot ask"* — mirrors
`swing-active-refresh/route.test.ts`'s own source-wiring assertion for the identical fix: asserts
the route imports `reliableAskFromSnapshot` alongside `reliableMarkFromSnapshot`, asserts the
`updateBangerQuoteFields` call resolves `ask` through `reliableAskFromSnapshot(snap)`, and asserts
the raw `ask: snap.ask,` pattern never regresses back in. Regex-asserted against raw source
(matching this file's own existing convention for route.ts's DB/provider-heavy wiring, which cannot
be easily unit-tested behaviorally without a Next.js route runtime) — the guard's own divergence
logic is unit-tested directly in `options-snapshot.test.ts`.

### Verification

- `node --import tsx --experimental-test-module-mocks --test src/app/api/cron/banger-live-sync/route.test.ts`
  (Node 20) — RED pre-fix (7 pass / 1 fail, via `git stash` of `route.ts` with the test kept in
  place), GREEN post-fix (8 pass / 0 fail).
- Sibling suites re-run clean: `swing-active-refresh/route.test.ts` +
  `options-snapshot.test.ts` (59 pass), and the full Banger lane + `banger-lane-merge.ts` +
  `adapters.ts` test files (306 pass / 0 fail).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
