## 2026-10-24 — [FINDING, P2 Night Hawk Swings] Swing play-brief/horizons "Spread" line could render a nonsensical percentage from an unguarded backstop ask — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|------------|-------|

### What broke

`GET /api/market/swing/play-brief?playId=SWING:CAG&ticker=CAG&positionId=2082` rendered:

> Spread: **13000.0%** ($0.00/$3.90) — this sub-lane's own entry liquidity bar was **25%**, so
> current execution is now wider than it.

for a $16-strike call on a ~$14.86 underlying at delta 0.15 — a contract that cannot have a real
fillable $3.90 ask. The live quote behind it was `{bid: 0, ask: 3.9, mid: 0.03}`: the `mid` was
already correctly guarded down to the real last trade ($0.03), but `bid`/`ask` were not, so the
Position section's Spread line (`play-brief.ts`, ~line 749-763) computed
`(ask - bid) / mid = (3.90 - 0) / 0.03 = 13000%` from a mismatched pair — a sanitized mid sitting
next to an unsanitized ask.

### Root cause

`reliableMarkFromSnapshot`/`reliableMarkFromQuote` (`src/lib/providers/options-snapshot.ts`) exist
specifically to catch a dead bid (0) paired with a market-maker "backstop" ask nobody could
actually transact at — confirmed live twice before (CRSR 2026-09-14, CRI 2026-10-08) — but they
only ever correct the resolved **mark**. They never touch `snap.ask` itself.

`loadOptionQuote` (`src/app/api/cron/swing-active-refresh/route.ts`) already calls
`reliableMarkFromSnapshot(snap)` to guard `mark`, but built the `SwingLiveQuote` it returns with
`ask: snap.ask` — the raw, unguarded value — right next to that same guarded mark. That quote is
persisted onto the position's append-only manage snapshot (`manage-sync.ts`), read back by
`liveQuoteFromEvent`, and fed into `contractFromRow` (`src/lib/swing/live-plays.ts`), which sets
`ChainContract.mid` from the **guarded** `row.last_mark` but `ChainContract.bid`/`ask` straight off
the **unguarded** quote. `liquidityFromContract` (`src/features/nighthawk/command-deck/adapters.ts`)
then computes `spreadPct = (ask - bid) / mid` from that one `ChainContract` — mixing the sanitized
mid with the unsanitized ask on the same object produces the incoherent percentage.

### Blast radius

- `liquidityFromContract`'s only call site is `terminalPlayFromHorizon` (adapters.ts), which also
  feeds `executableFill(bid, ask, entry)` from the same raw `src.contract.bid/ask` — but
  `executableFill` already requires `bid > 0` to produce a `fill`/`pnl_pct` at all, so a bid=0
  backstop case (this repro) was already null there; unaffected by this bug, confirmed by reading
  the function, no change needed.
- `TerminalPlay.liquidity` has exactly one renderer today: `play-brief.ts`'s Position section
  Spread/Quote line. No `.tsx` component in `command-deck` reads `.liquidity` directly yet (checked
  via repo-wide grep), so the Command Deck board itself has no separate instance of this bug to fix.
- CLOSED swing rows never carry bid/ask at all (`closed-plays.ts`'s `contractBundleFromRow` only
  returns `mid`/`delta`), so closed positions are structurally unaffected.
- The Banger lane's pre-entry WATCH rows (`banger-lane-merge.ts`'s `horizonPlayFromBangerWatch`)
  carry their own `bid`/`ask` straight off the entry-time pick with `mid: entryPremium` — a
  different data shape that never runs through `reliableMarkFromSnapshot` at all, so it is not an
  instance of this same bug and was left untouched (no unrelated refactor).

### Fix

Added `reliableAskFromSnapshot(snap)` next to `reliableMarkFromSnapshot`/`reliableMarkFromQuote`
in `options-snapshot.ts` — it reuses `reliableMarkFromSnapshot` verbatim (never reimplements the
divergence math) to decide whether the mark guard substituted the reference for the naive
doc-priority mark; when it did (the exact bid===0 + magnitude-divergence case, including the
thin-one-lot 3x bar), the ask is the same unfillable backstop number, so it is nulled instead of
passed through. `loadOptionQuote` now sets `ask: reliableAskFromSnapshot(snap)` instead of
`ask: snap.ask`. A nulled ask makes `liquidityFromContract` return `spreadPct: null` for that
contract, and `play-brief.ts`'s existing honest fallback fires instead of asserting a false
precise number:

> Quote: **$0.00** _(one-sided book — spread not priceable)_

**Deliberately left unchanged:** `midOf`/the mark-resolution priority ladder, `executableFill`,
and every other consumer of `ChainContract.bid/ask` outside this one data path — the fix is scoped
to the single choke point (`loadOptionQuote`) that already resolves the mark guard but skipped the
ask, matching the existing `reliableMarkFromSnapshot` guard's own scope (only `bid===0` is ever
second-guessed; a real two-sided market is never touched).

### Verify

- `src/lib/providers/options-snapshot.test.ts` — 7 new `reliableAskFromSnapshot` cases, including
  the exact CAG repro numbers (bid:0, ask:3.90, last:0.03 → nulled) and the existing
  `reliableMarkFromSnapshot` boundary cases (bid>0 passthrough, legitimate deep-OTM kept, no
  reference, thin one-lot 3x bar). RED confirmed pre-fix (function did not exist, 7/50 fail);
  GREEN post-fix (50/50 pass).
- `src/app/api/cron/swing-active-refresh/route.test.ts` — new source-wiring assertion (matching
  this file's own existing convention for route.ts's provider-heavy wiring) that `loadOptionQuote`
  resolves `ask` through `reliableAskFromSnapshot`, not raw `snap.ask`. RED confirmed pre-fix
  (1/9 fail); GREEN post-fix (9/9 pass).
- Full affected-file regression run post-fix: `options-snapshot.test.ts` +
  `route.test.ts` + `live-plays.test.ts` + `adapters.test.ts` + `play-brief.test.ts` — 436/436 pass.
- `npx tsc --noEmit` (Node 20) — clean.
