## 2026-10-18 — [FINDING, swing] `closedDeckSourcesFromChains` serves a rolled chain's correctly-identified worst-leg contract with the TERMINAL leg's own mid/delta — two different real option contracts merged into one card

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 |
| **Surface** | `src/lib/swing/closed-plays.ts` — `closedDeckSourcesFromChains()` / `contractBundleFromRow()` (Night Hawk Swings CLOSED tab + Ask Largo closed play-briefs) |

### Symptom (live repro, 2 real rows)

- **AAPL positionId 40** (root 37 -> terminal 40): served contract identity correctly names the
  worst leg — `{strike:330, right:C, expiry:'2026-09-21', occ:'AAPL260921C00330000'}` — but its
  `mid`/`delta` were `{mid:7.7, delta:0.48}`. Leg 37 (the reported worst leg, `realizedPnlPct
  -22.3`, matching the served `exitPnlPct`) had its OWN `exit_mark` of **5.23** at roll time — 7.70
  is leg 40's (the terminal leg) own `exit_mark`, a completely different contract's price.
- **AMZN positionId 48** (root 44 -> terminal 48): same pattern. Served `mid=10.00, delta=0.6`, but
  leg 44 (the reported worst leg, `realizedPnlPct -27.67`, matching the served `exitPnlPct`) had its
  own `exit_mark=3.73` — 10.00 is leg 48's (terminal) own `exit_mark`.

In both cases the card named one real contract's identity (correctly, via the 2026-10-11 fix below)
while displaying a *different* real contract's own quote fields next to it — a member or Largo
reading the row sees one coherent-looking option (strike/expiry/mid/delta) that never existed; the
mid/delta belong to a contract the chain had already rolled away from (or into).

### Root cause

This REOPENS, one layer deeper, the exact bug class a 2026-10-11 fix in this same file already
addressed for strike/right/expiry/occ (see that fix's own in-code comment, `closed-plays.ts`
~lines 288-312 before this change). That fix correctly re-points the contract's **identity** to the
worst leg when the worst leg isn't the terminal leg, but never touched the contract's **price**
fields.

`closedDeckSourcesFromChains()` builds the served `contract` object as:

```ts
contract: {
  ...src.contract,
  strike: worstLegBundle.strike,
  right: worstLegBundle.right,
  expiry: worstLegBundle.expiry,
  dte: worstLegBundle.dte,
},
```

`src` is `closedDeckSourceFromRow(terminal)` — so `src.contract.mid`/`src.contract.delta` are the
**terminal leg's own** `last_mark`/`contract_delta` (see `closedDeckSourceFromRow`, which builds
`contract.mid: row.last_mark, contract.delta: row.contract_delta` for whichever row it's given).
The spread `...src.contract` carries those terminal-leg quote fields forward unchanged, and only
the four identity fields above were ever overridden — `mid`/`delta` silently kept pointing at a
different real contract whenever the worst leg wasn't the terminal leg.

`worstLegBundle` itself came from `contractBundleFromRow(worstLegRow)`, which (before this fix)
only returned `{strike, right, expiry, dte, occ}` — it never read any quote field off its own row,
so there was no way for the call site to source `mid`/`delta` from the worst leg even if it had
tried to override them too.

### Fix

Extended `contractBundleFromRow()` to also carry its own row's quote fields (`mid: row.last_mark`,
`delta: row.contract_delta`) alongside the identity fields it already returned — one function, one
row, one consistent contract. `closedDeckSourceFromRow()` now destructures `mid`/`delta` off the
same bundle instead of reading `row.last_mark`/`row.contract_delta` a second time (no behavior
change there — same row either way). `closedDeckSourcesFromChains()` now also overrides
`mid`/`delta` from `worstLegBundle` when the worst leg isn't the terminal leg, alongside the
identity fields it already overrides — so the served contract's identity AND price now always come
from the same leg.

`gamma`/`theta`/`vega`/`iv` have no equivalent column on `SwingPositionRow` at all (both
`closedDeckSourceFromRow` and the chain path always hardcode them `null`) — unaffected by this fix,
same honest absence as before.

### Evidence

Regression test added to `src/lib/swing/closed-plays.test.ts` reproducing both live examples
verbatim (AMZN positionId 48/44 and AAPL positionId 40/37), asserting the served `contract.mid`/
`contract.delta` equal the WORST leg's own `last_mark`/`contract_delta`, not the terminal leg's.
Proved RED before the fix (reverted just `closed-plays.ts` via a tagged `git stash`, reapplied
after) and GREEN after, on Node 20:

```
# tests 29
# suites 3
# pass 29
# fail 0
```

`npx tsc --noEmit` clean on Node 20.

### Blast radius

Only `closedDeckSourcesFromChains()` (the chain-composite CLOSED-tab/Ask-Largo path) was affected —
`closedDeckSourceFromRow()` used alone (single-leg, non-rolled positions) was never wrong, since
there identity and quote always come from the same row by construction. No other call site builds
a `contract` object from a different leg's bundle.

### Fix rationale

Extending `contractBundleFromRow()` (rather than adding a second, parallel "quote bundle" helper)
keeps one function returning everything the call site needs about a given row's contract, so a
future field added to one path can't again be added to only one of two now-separate lookups — the
exact shape of bug this is fixing.
