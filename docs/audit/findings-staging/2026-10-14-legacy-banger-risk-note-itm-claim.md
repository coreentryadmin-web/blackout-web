> **kind:** FINDING

## Night Hawk Legacy: a banger-lane play whose picked contract is actually in-the-money still gets the unconditional "cheap OTM weeklies" risk_note — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `buildPlay()` (`src/features/nighthawk/lib/deterministic-edition.ts`) attaches the
scale-out `risk_note` to every banger-lane play purely on `bangerTickers.has(ticker)` membership —
i.e. on which SCREENING LANE surfaced the ticker, never on what `pickChainContract()` actually
selected for it:

```ts
if (bangerTickers?.has(scored.ticker.toUpperCase())) {
  base.risk_note = bangerScaleOutNote({ dte });
  ...
}
```

`bangerScaleOutNote()` (`src/lib/zerodte/scale-out.ts`) had already been fixed once for the
identical SHAPE of bug (2026-09-22, DTE): it used to unconditionally claim "cheap OTM weeklies"
regardless of the contract's real DTE. That fix threaded the play's real `dte` through — but left
the OTHER half of the same sentence, "OTM," equally unconditional. `pickChainContract`'s
`preferAffordable` ladder (same file, ~line 376: picks the nearest-to-spot strike within a
PREFERRED subset gated on `premium <= PREFERRED_OPTION_PREMIUM_PER_SHARE` ($8/share) AND
`|delta| >= MIN_PREFERRED_CONTRACT_DELTA` (0.15)) can legitimately land a strike on the WRONG side
of spot when the true-OTM candidates near spot fail one of those gates (high IV pushing their
premium over the preferred cap, or short DTE compressing their delta under the floor) — exactly the
same "lane membership proves nothing about the FINAL pick" gap the DTE fix addressed for DTE, now
confirmed live for moneyness too.

**Evidence.** Live `GET /api/market/nighthawk/edition` (2026-10-14 edition_for 2026-10-15, this
cycle's Legacy coherence check), ticker ETSY, rank 4:

```json
{
  "direction": "LONG",
  "entry_range": "$81.84-$84.02",
  "options_play": "ETSY $78 CALL @ $5.05 — Oct 23, entry prem ~$5.05",
  "risk_note": "Banger exit — scale out, don't hold to expiry: realize 50% at 2×, trail the runner
    at 50% of its peak, hard stop −60%. These cheap OTM weeklies spike then decay — the exit is the
    edge."
}
```

`entry_range`'s midpoint (`$82.93`) is EXACTLY ETSY's real session close that day (confirmed via a
direct Polygon daily-bars pull, 2026-10-14: `o=78.89 h=82.99 l=78.89 c=82.93`) — `resolveLevels()`
(same file) centers `entry_range` on the exact same `spot` value `pickChainContract` receives, so
this is the real spot the contract pick saw. A LONG `$78 CALL` struck 4.93 points BELOW an $82.93
spot is in-the-money (positive intrinsic value, delta well above 0.5) — the opposite of "OTM." The
risk_note's claim is therefore demonstrably false for this specific, real, member-facing play, not
a hypothetical.

Checked the other two consumers of the same `bangerScaleOutNote()` (`src/app/api/market/banger/board/route.ts`,
`src/lib/largo/product-reads.ts`) before scoping the fix: both read an ALREADY-COMMITTED contract
from that lane's own discovery pipeline (not `pickChainContract`'s Legacy-only affordability
ladder), and the function's own header comment already documents that distinction — "genuinely IS
accurate by construction" for the banger board. Left both untouched; this fix is Legacy-specific,
matching where the actual divergence lives.

**Fix.** `bangerScaleOutNote()` gains an optional `otm?: boolean | null` context field (same pattern
as the existing `dte` field): `otm === false` swaps the "cheap OTM weeklies" clause for an honest
"already in-the-money" descriptor; `true`/`null`/omitted (every pre-existing caller, and every case
where moneyness can't be verified) reproduces the original text byte-for-byte. `buildPlay()` now
receives the same `spot` value already computed at each of ITS 3 call sites (the two were already
computing `spot`/`sp` locally for `resolveLevels`/`pickChainContract` — this just threads the
existing value one layer further rather than recomputing it) and derives `otm` from
`contract.strike` vs `spot`, direction-aware (LONG/call: ITM when `strike < spot`; SHORT/put: ITM
when `strike > spot`). An exactly-ATM strike (`strike === spot`) is deliberately left OTM-compatible
— genuinely zero intrinsic value, same "spikes then decays" shape the existing copy already
describes — so the fix changes behavior only for the real ITM case it was built to catch, not the
common ATM pick (caught by a collateral test failure during development: the chain fixture's
default nearest-to-spot pick is exactly ATM, and a naive `strike >= spot` check would have flipped
that common case too).

**Fix rationale.** Considered dropping the risk_note entirely for an ITM pick rather than rewording
it, but rejected: the mechanical scale-out RULE (bank 50% at 2×, trail at 50% of peak, hard stop
−60%) is not moneyness-specific — an ITM contract from a volatile breakout name still benefits from
the same discipline, only the "cheap OTM lotto" framing around it was wrong. Rewording preserves the
actionable rule for every play while fixing only the one false factual claim.

**Blast radius.** `buildPlay()` has exactly 3 call sites in `deterministic-edition.ts` (main loop,
diversity-hedge Phase 1 natural-opposite, Phase 2 forced-contrarian) — all 3 updated to thread
`spot`; none of them change behavior for a non-banger play (the `otm` computation only runs inside
the existing `bangerTickers?.has(...)` branch) or for a far-dated (>10 DTE) banger play (that branch
never mentioned OTM to begin with, so `otm` is accepted but has no effect there).

**Tests.** `src/lib/zerodte/scale-out.test.ts`: 6 new cases for `bangerScaleOutNote`'s `otm` context
(ITM swaps the claim, OTM/null/omitted reproduce the original byte-for-byte, the far-dated branch
and the mechanical rule sentence are unaffected). `src/features/nighthawk/lib/deterministic-edition.test.ts`:
2 new end-to-end cases — a chain with ONLY below-spot strikes (so whatever `pickChainContract`
picks for a LONG is necessarily ITM, no need to replicate the exact affordability/delta economics)
asserts the false "OTM" claim is gone and the honest descriptor appears; a normal ATM/OTM chain
asserts the existing framing is unchanged. RED→GREEN proven via `git stash push -- src/lib/zerodte/scale-out.ts
src/features/nighthawk/lib/deterministic-edition.ts`: pre-fix, 2/117 tests across both files failed
(the two new end-to-end cases); post-fix (stash pop), 117/117 pass. `npx tsc --noEmit` clean on
Node 20.
