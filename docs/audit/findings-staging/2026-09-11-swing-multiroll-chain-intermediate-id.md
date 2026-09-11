> **kind:** FINDING

# Ask Largo swing play-brief could not resolve a chain rolled TWICE via an intermediate leg's id

| Field | Detail |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (member-facing — Ask Largo silently returns an unrelated position or falls to a generic fallback instead of the live continuation of the position asked about) |
| **Component** | `src/lib/swing/play-brief-resolve.ts` (`resolveSwingPlayForBrief`, `loadOpenTerminalPlay`, `loadClosedPlay`) |
| **Found via** | Ask Largo standing ownership mandate — roll-narrative end-to-end trace, the natural follow-up to #4794's OCC-identity fix, which explicitly flagged rolls as the one case reconstruction and ledger values could diverge |

## What was broken

Every id-matching test in `play-brief-resolve.ts` assumes a caller-supplied `positionId` is either
the live/terminal leg itself or the chain's ROOT id:

```js
// loadOpenTerminalPlay
row = matches.find((r) => r.id === hints.positionId || r.root_position_id === hints.positionId);
// loadClosedPlay — identical shape
target = graded.find((r) => r.id === positionId || r.root_position_id === positionId);
```

That holds for a chain rolled exactly once: `roll.ts`'s own header states the design explicitly —
"the chain root is sticky" (`root_position_id = parent.root_position_id ?? parent.id`) — so a
child's `root_position_id` always points at the very FIRST leg, and a caller who bookmarked that
root id before the roll still resolves the live child correctly.

It breaks once a chain rolls a SECOND time. Consider root(id=1) → rolled child(id=2,
`root_position_id=1`) → currently-open grandchild(id=3, `root_position_id=1` — sticky, not 2). A
caller referencing id=2 (e.g. from a brief shown between the two rolls, or a client that cached the
position id at the moment it first became OPEN) got no match anywhere:
- `loadOpenTerminalPlay`'s open rows (status OPEN/HOLD/TRIM only) contain row 3, whose
  `root_position_id` is 1, not 2 — `r.root_position_id === 2` never matches.
- `loadClosedPlay`'s graded rows do contain row 2 itself (`r.id === 2` matches), but its own
  status is `ROLLED`, not `CLOSED`, and `closedDeckSourceFromRow` correctly refuses anything but
  `CLOSED` (`closed-plays.ts` line 64) — so `loadClosedPlay` legitimately returns `null` for it.

The request then silently fell through to the ticker-only lane/WATCH fallback
(`pickLanePlayForBrief`) or an unrelated `closedFallback` for a different chain on the same
ticker — the exact "silently returns the wrong play" failure mode a prior fix (2026-09-11, live
repro SWING:INTC, same file) already closed for the single-roll case, reopened one roll deeper.
Traced by reading `root_position_id`'s assignment in `roll.ts` (its own header comment) against
every id-matching test in this file — no code path resolved an INTERMEDIATE leg's id to its
chain's current state, and the codebase's only chain-walk helper (`fetchSwingPositionChain`,
`db.ts`) requires the ROOT id as input, not an arbitrary leg id, so it could not be reused as-is
either.

## Evidence

Regression test `src/lib/swing/play-brief-resolve.test.ts` ("a chain rolled TWICE still resolves
via an INTERMEDIATE leg's id") constructs exactly this three-leg chain plus an UNRELATED second
open position on the same ticker (to eliminate `loadOpenTerminalPlay`'s own `matches.length === 1`
coincidence, which would otherwise mask the bug when there's only one open row to begin with).
`git stash` proved RED before the fix (falls through, resolves the wrong/unrelated leg) and GREEN
after (resolves the currently-OPEN grandchild leg, id=3, by strike and status).

## Fix

Added `resolveChainRootId(ticker, positionId)`: a single extra `fetchSwingPositionsRange` lookup
(already returns every status, including intermediate ROLLED legs) that finds the referenced leg
wherever it lives in the last 90 days and resolves to `row.root_position_id ?? row.id` — its OWN
chain root, not the parent it happened to roll from. Wired in as an ADDITIVE fallback in
`resolveSwingPlayForBrief`, retrying both the open-ledger and closed lookups against the resolved
root, and ONLY reached when the existing direct id matches already in the function come back
empty — so a chain rolled once or not at all (the overwhelming common case) pays zero extra
lookup and behaves byte-for-byte as before. Chosen over reusing `fetchSwingPositionChain` directly
because that helper requires the ROOT id as input (`id = root OR root_position_id = root`) — it
has no reverse lookup from an arbitrary leg id to its root, which is exactly the missing piece
here.

## Blast radius

Single call site (`resolveSwingPlayForBrief`); the fix does not touch `loadOpenTerminalPlay` or
`loadClosedPlay`'s own matching logic (both stay as they are, correct for their existing single-hop
and terminal-status contracts) — it only adds a wider retry path once those two report nothing.
No other consumer of these functions exists outside this file's test suite and the swing play-brief
API route.
