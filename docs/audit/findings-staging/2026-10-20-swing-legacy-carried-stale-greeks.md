## Legacy-carried swing candidates served stale option greeks with full confidence right next to a quote the same code path honestly nulled for staleness — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, 5-engine live monitor cycle, Night Hawk Swings live correctness check
(production, read-only) — all 3 Legacy-morning-confirm candidates in the live snapshot
(EWY/COMMIT_NOW, SHOP/WATCH, UNH/RESEARCH) showed the identical pattern: `contract.bid/ask/mid`
all `null`, while `contract.delta/gamma/theta/vega/iv` were fully populated numeric values.

**Root cause:** `refreshCarriedLegacyPlay` (`src/lib/swing/legacy-confirm-promote.ts:483-493`)
recomputes calendar DTE for a carried contract and, when `staleDte` is true (no fresh same-contract
match from today's organic scan), nulled `mid/bid/ask` with its own comment stating *"a carried
blob with a stale DTE label almost certainly has a stale quote too — drop it honestly"* — but left
`gamma/theta/vega/iv` untouched from the original frozen read (the `...play.contract` spread), and
even re-asserted `delta` from the same stale source (`delta: play.contract.delta ?? null`, a no-op
that kept the stale value). All of these fields come from the SAME options-chain read at the SAME
instant as the quote this code already judges untrustworthy — the comment's own reasoning applies
identically to them, but only the quote got the honest treatment.

**Live impact:** doesn't currently reach a member through either downstream UI consumer checked —
the Command Deck (`PlayTerminal.tsx`'s `greeksOff = !live || …`) and Ask Largo's play-brief
(`watchEntrySection`) both independently skip rendering greeks for a row with no live mark. It is
nonetheless a real inconsistency in the raw `GET /api/market/nighthawk/horizons?view=swings` API
contract — any other consumer (a future client, a different Largo tool reading the board directly)
would see confidently-formatted, days-stale greeks with zero staleness indication, right next to a
sibling field the system itself flagged as too stale to show. No prior test exercised this branch
at all (confirmed: zero existing tests on the `staleDte`-with-no-fresh-match path before this fix).

**Fix:** Extended the exact same honesty treatment already applied to `mid/bid/ask` to
`delta/gamma/theta/vega/iv` — all nulled together when `staleDte` is true and no fresher
same-contract quote exists. Removed the pointless `delta: play.contract.delta ?? null` no-op in
favor of `delta: null`, grouped with the other four greek fields.

**Fix rationale:** Treats the whole options-chain read (price + greeks) as one atomic unit that
either survives intact (a fresh same-contract match exists — `sameContract` branch, untouched) or
gets dropped honestly together (no fresh match — every field from that stale read is suspect, not
just price). Chose nulling over adding a new staleness-marker field (`markAsOf`/`quoteUpdatedMs`
already exist on `ChainContract` but have no consumer for a non-committed WATCH-bucket candidate,
unlike the live-ledger `markAsOf` path) — nulling matches the already-established, already-working
pattern for the sibling price fields exactly, rather than inventing a second mechanism nothing
downstream reads yet.

**Blast radius:** Single function, single call site (`carryLegacyPromotedIntoSnapshot`, same file).
No other caller of `refreshCarriedLegacyPlay` exists (repo-wide grep).

**Tests:** 2 new regression tests in `legacy-confirm-promote.test.ts` — the no-fresh-match path
now nulls mid/bid/ask AND all five greek fields; a sibling test confirms the `sameContract` (fresh
match found) path still correctly carries the FRESH contract's own live greeks through untouched,
so the fix doesn't accidentally null a good read. RED→GREEN proven via `git stash` (new test fails
against the pre-fix source — `delta` surviving as `0.59` instead of `null` — passes post-fix).
`tsc --noEmit` clean. Full `legacy-confirm-promote.test.ts` (27 tests) green.
