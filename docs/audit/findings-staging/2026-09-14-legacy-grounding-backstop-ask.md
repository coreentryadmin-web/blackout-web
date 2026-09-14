> **kind:** FINDING

## Legacy's numeric-grounding premium check could overwrite a play's entry premium with a fabricated backstop-quote ask — FIXED

| **Status** | FIXED (PR fix/legacy-grounding-backstop-ask) |
|---|---|

**Root cause.** `augmentChainsWithExactContracts` (`src/features/nighthawk/lib/option-chain-prompt.ts`)
fetches an exact per-contract snapshot (`fetchOptionsUnifiedSnapshot`) for the specific option
contract each play selected, so `groundPlay`'s premium-reconciliation check (`grounding.ts` CHECK 2)
has a real quote to ground the published `entry_premium` against. The mapper that turns that snapshot
into a `ChainStrikeRow` (`rowFromOptionSnapshot`) stored the RAW `snap.bid`/`snap.ask` verbatim — with
no cross-check against the contract's real last-traded price.

The swing/banger lane found and fixed (PR #4969, same day) the exact failure mode this raw ask is
exposed to: a `bid:0` snapshot can carry a market-maker "backstop" `ask` an order of magnitude above
the contract's real last-traded/session-close price. Live-reproduced there: CRSR 260918C00015000
showed `bid:0, ask:15` while `last_trade.price` and `session.close` were BOTH $0.07 — a 107x-vs-mid,
214x-vs-ask divergence. That fix (`reliableMarkFromSnapshot` in `options-snapshot.ts`) guarded
`snap.mark`, a display/exit-management value. It did NOT guard the raw `ask` this Legacy-side mapper
stores — and that raw ask is exactly what `grounding.ts`'s `sideAsk` reads to compute `chainAsk`,
which then **overwrites the play's `entry_premium`** (`groundPlay`, CHECK 2, lines ~301-316:
`mutated = {...mutated, entry_premium: livePremium, ...}`). So the same backstop artifact that
corrupted a *displayed* mark in the sibling lane would, here, corrupt the actual entry premium
**published to members** for the exact contract Claude selected — a 214x overstatement in the
reproduced case ($15/share vs a real $0.07/share, i.e. $1,500/contract published for a contract that
actually costs ~$7/contract).

**Evidence.** `augmentChainsWithExactContracts`'s own doc comment states its purpose: "user-visible
option premiums must be grounded against the exact contract that will be shown" — confirming this is
exactly the live-picks path, not a side channel. `sideAsk` (`grounding.ts`) computes `(ask+bid)/2`
when `bid>0`, else falls back to the raw `ask` alone when `bid` is 0/missing — with zero check against
`last`/`dayClose`, unlike `reliableMarkFromSnapshot`. New regression tests reproduce the exact
CRSR-shaped snapshot (`bid:0, ask:15, last:0.07, dayClose:0.07`) through `rowFromOptionSnapshot` and
confirm the guarded value now matches the honest reference.

**Blast radius.** Contained to `rowFromOptionSnapshot`, the SOLE place an `OptionSnapshot` (from
`fetchOptionsUnifiedSnapshot`) is converted into a `ChainStrikeRow` in this file. `pivotPolygonContracts`
(the primary/narrow-window chain-table path, feeding the pre-synthesis prompt Claude reads) already
has its own after-hours fallback for `ask<=0`, but that fallback does NOT cover this shape (ask itself
is a positive, just fabricated, number) — noted here but left unchanged in this fix: that path builds
the prompt TABLE Claude reads pre-synthesis, not the post-synthesis grounding/overwrite path this
finding is about, and widening scope to a second call site without its own live-reproduced evidence
would be exactly the "shipping something without solid evidence" this session's standing discipline
declines. Flagged as a follow-up worth a dedicated look, not bundled into this fix. `pivotUwRows` (the
UW-sourced fallback) has no `last`/`dayClose` fields in its input shape at all, so it was never able to
carry this class of guard and is unaffected either way.

**Fix rationale.** Added `reliableAskFromSnapshot`, mirroring `reliableMarkFromSnapshot`'s exact logic
and threshold (`ZERO_BID_MID_DIVERGENCE_MULTIPLE = 10`, imported from `options-snapshot.ts` rather than
duplicated) but applied to the raw `ask` field this mapper actually stores: when `bid` is EXACTLY 0 and
`ask` exceeds `last ?? dayClose` by more than 10x, store the honest reference instead of the fabricated
ask. A real two-sided market (`bid>0`) is never second-guessed, and a snapshot with no `last`/`dayClose`
reference at all passes the raw ask through unchanged (never fabricates a value that isn't there).
`rowFromOptionSnapshot` exported (previously module-private) so this could be unit-tested directly
against a realistic `OptionSnapshot` fixture, matching this file's existing convention of exporting
internal helpers for direct test coverage (e.g. `resolveSpot`, `augmentChainsWithExactContracts`).

**Severity/impact.** High — this is Legacy's own premium-grounding step overwriting a member-facing
published `entry_premium` with a divergence that can run into the hundreds-of-percent range, discovered
live on the same trading day by the sibling lane. Unlike the sibling lane's fix (a live mark/exit-
management display value), this one affects what number gets **published as the trade's entry cost**
at synthesis time.

**Test evidence.** 4 new tests in `option-chain-prompt.test.ts`: the CRSR-shaped repro (bid:0/ask:15/
last:0.07/dayClose:0.07 → guarded to 0.07), a real two-sided market left untouched even with a large
last-divergence, a bid:0 ask within the 10x band left untouched (not every zero-bid quote is a
backstop), and put-side parity. RED confirmed two ways: (1) pre-fix, the function wasn't exported at
all (`rowFromOptionSnapshot is not a function`); (2) with export added but the guard call removed,
the value-level assertions failed exactly as expected (`20 !== 0.1`, `15 !== 0.07`). GREEN post-fix:
12/12 in this file. Full suite + `npx tsc --noEmit` run separately; see PR for the exact pass count.
