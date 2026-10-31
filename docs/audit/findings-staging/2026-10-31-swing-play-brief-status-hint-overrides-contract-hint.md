> **kind:** `FINDING`

## Ask Largo swing play-brief resolved the WRONG position when a `status` hint accompanied a failed positionId/strike/right hint for a Banger-origin play — FIXED

| | |
|---|---|
| **Severity** | HIGH (Ask Largo standing "own this feature" mandate — live member-facing misidentification: a position review/brief silently answers for an unrelated open trade) |
| **Surface** | `src/lib/swing/play-brief-resolve.ts` (`loadOpenTerminalPlay`), consumed by `GET /api/market/swing/play-brief` and `useSwingPlayBrief` |
| **Status** | FIXED |

### Root cause

`loadOpenTerminalPlay(ticker, hints)` builds `matches` solely from `fetchOpenSwingPositions()` — the
**native** `swing_positions` table only, never `banger_positions`. For a ticker that carries both a
native row and one or more Banger-origin open positions (a real, common shape — Banger-origin
positions are tracked in a separate table and only sometimes win the board's single native-merge
display slot), `matches` can be a single, completely unrelated native row while the caller is
actually asking about a different, banger-origin position by `positionId`/`strike`/`right`.

The function already has two correctly-fail-closed checks for this: the `positionId` match (`r.id
=== hints.positionId || r.root_position_id === hints.positionId`) and the strike/right contract
match (`rowContractMatches`) both correctly return no match when the hint names a contract/position
`matches` doesn't contain. The bug was in the **status-only fallback** a few lines later:

```ts
if (!row && hints.status && WORKING.has(hints.status.toUpperCase())) {
  const working = matches.filter((r) => WORKING.has(String(r.status ?? "").toUpperCase()));
  if (working.length === 1) row = working[0];
  ...
}
```

This block ran unconditionally whenever `row` was still unset, with **no check on *why* it was
unset** — including the case where the caller supplied a specific `positionId`/`strike`/`right`
hint that had *already, explicitly, failed to match* every row in `matches` moments earlier. If the
ticker's one native row happened to be in a WORKING status (`OPEN`/`HOLD`/`TRIM`), `working.length
=== 1` and the block took that row directly, **without ever re-validating it against the
positionId/strike/right hint that had just failed to match it** — silently substituting an
unrelated position instead of falling through to `loadOpenBangerTerminalPlay` (the existing
banger-lookup fallback, shipped for the earlier, analogous PANW incident, reached by the same
function a few lines further down whenever `row` is still unset after every check).

The existing regression test for that PANW fix
(`play-brief-resolve.test.ts`, `loadOpenTerminalPlay("PANW", { positionId: 2103 })`) never passes a
`status` hint, so it never exercised this exact path — a gap *in* that earlier fix, not a
duplicate of it.

### Evidence

Live reproduction (2026-10-31, production, read-only): MRNA carried 3 concurrent open swing
positions per `GET /api/market/nighthawk/horizons?view=swings` — native `swing_positions` row #68
(195C, entry $14.80, +99.2% P&L, `manageAction: TAKE_PARTIAL`) and two Banger-origin
`banger_positions` rows, #2240 (225C, entry $8.85, +18.4% P&L) and #2167 (217.5C, entry $9.80,
+44.1% P&L).

Calling the exact request shape the live UI's `useSwingPlayBrief` hook builds
(`src/hooks/useSwingPlayBrief.ts`'s `briefUrl()`: playId + ticker + positionId + status + strike +
right) for the 225C position —

```
GET /api/market/swing/play-brief?playId=SWING:MRNA:2240&ticker=MRNA&positionId=2240&status=HOLD&strike=225&right=C
```

— returned `{playId: "SWING:MRNA:68", envelope.thesis: "LONG MRNA 195C 6DTE — TRIM 100% ..."}` — the
**wrong, unrelated** position, with a "TRIM 100%" recommendation that applies to #68, not #2240.
The identical shape for `positionId=2167`/`strike=217.5` also wrongly resolved to `SWING:MRNA:68`.
Removing only `status` from the request (keeping positionId/strike/right) correctly resolved
`SWING:MRNA:2240`/`SWING:MRNA:2167` respectively — isolating `status` as the trigger.

Unit-level RED→GREEN (`src/lib/swing/play-brief-resolve.test.ts`), confirmed via `git stash` of
just the source fix (`play-brief-resolve.ts`), keeping the new test in place:

- **Before the fix**: `loadOpenTerminalPlay("MRNA", { positionId: 2240, strike: 225, right: "C",
  status: "HOLD" })` against a mocked native row #68 (195C, HOLD) returns that **native row's own
  play** (the wrong substitution) instead of falling through to the banger lookup.
- **After the fix**: the same call returns `null` (the banger-lookup fallback correctly finds
  nothing in this unit test, since `banger_positions` isn't mocked here — the point is it no longer
  silently substitutes row #68).

Full suite for the file: 41/41 pass post-fix. `npx tsc --noEmit` clean repo-wide on Node 20.

### Blast radius

Single function, single file (`loadOpenTerminalPlay` in `play-brief-resolve.ts`), reached by both
of its callers in this file: directly, and via `resolveSwingPlayForBrief`'s `Promise.all` call —
i.e. every `GET /api/market/swing/play-brief` request that carries a `status` hint alongside a
positionId/strike/right hint that doesn't match the ticker's native-table row(s). This is exactly
the shape `useSwingPlayBrief`'s `briefUrl()` sends for **every** open-position brief request (it
always includes `status` when `play.status` is set), so any ticker with a native row in a WORKING
status plus one or more Banger-origin siblings was exposed. No DB write path is touched — this is a
pure read-resolution bug.

### Fix rationale

Gate the status-only fallback on the absence of any specific identifying hint at all:

```ts
const hasSpecificContractHint = hints.positionId != null || hints.strike != null || hints.right != null;
if (!row && !hasSpecificContractHint && hints.status && WORKING.has(hints.status.toUpperCase())) {
```

This preserves the block's legitimate purpose — a caller sending *only* a status hint (no
positionId/strike/right at all) against a genuinely ambiguous native-only ticker still gets
disambiguated by status, exactly as before — while closing the gap where a *specific, already-failed*
positionId/strike/right hint got silently overridden by a same-ticker row's status alone. An
alternative considered was threading a "did this hint actually match anything" flag through the
earlier checks instead of a coarser "was any hint supplied" gate; rejected because by construction,
whenever `hints.strike`/`hints.right` is non-null and the block is reached, the earlier `byContract`
filter (which uses the identical `rowContractMatches` predicate over the *same* `matches` array)
has already proven zero matches exist — so the inner `strike`/`right` disambiguation lines inside
the status block were already dead code in that case, and the simpler "any specific hint present"
gate is both correct and easier to reason about than re-deriving the same fact twice.

### Tests

`src/lib/swing/play-brief-resolve.test.ts` — 2 new tests:
1. `"BUG FIX: a status hint must not override a positionId/strike/right hint that already failed to
   match (live MRNA repro)"` — reproduces the exact live scenario, proving the wrong-row
   substitution no longer happens.
2. `"a status-only hint (no positionId/strike/right) still disambiguates an otherwise-ambiguous
   native-only ticker"` — preserves the legitimate status-fallback use case (a PENDING row plus a
   HOLD row, status-only hint correctly resolves the HOLD one), proving the fix narrows the gate
   rather than removing the block.

All 41 tests in the file pass (including every pre-existing PANW/ABTC/SG/MSTR/HUT/INTC/NRG
regression test for this same resolver). `npx tsc --noEmit` clean repo-wide on Node 20.
