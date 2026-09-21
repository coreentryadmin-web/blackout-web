## 2026-09-21 — [FINDING, P1 Night Hawk Swings / Ask Largo] Play-brief positionId resolution silently ignores banger-origin positions — a specific requested leg always resolved to the highest-live-P&L leg on the same ticker — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `src/lib/swing/play-brief-resolve-pure.ts` (`pickLanePlayForBrief`), `src/lib/swing/play-brief-resolve.ts` (`resolveSwingPlayForBrief`) |
| **Severity** | P1 — member-facing / Largo-facing data-integrity defect: `GET /api/market/swing/play-brief` can return a DIFFERENT position's entry/mark/P&L/management-plan than the one explicitly requested, with no error, no degraded flag, no signal anything is wrong |

### Root cause

A banger-origin swing play's `positionId` is `banger_positions.id` — a namespace completely
separate from `swing_positions.id` (see `banger-lane-merge.ts`'s own doc comment, added
2026-09-20 to fix an analogous React-key collision on the Command Deck). `play-brief-resolve.ts`'s
`loadOpenTerminalPlay`/`loadClosedPlay` only ever query the `swing_positions` table
(`fetchOpenSwingPositions()`/`fetchSwingPositionsRange()`), so a `positionId` hint pointing at a
banger-origin leg can **never** match a row there — `matches.find((r) => r.id === hints.positionId
|| r.root_position_id === hints.positionId)` always comes back empty for that leg, regardless of
which specific id was requested.

Resolution then falls through `resolveSwingPlayForBrief`'s chain (closed-by-id, open-by-id, the
multi-roll chain-root retry — all `swing_positions`-only, all empty for the same reason) to
`pickLanePlayForBrief`, the ticker-only lane fallback. That function's hints type
(`{ status, strike, right }`) never carried `positionId` at all, so when the caller supplied
neither `strike` nor `right` (the play-brief route's/Largo's own documented common case —
`?playId=SWING:<ticker>:<positionId>`, no contract hint), the fallback silently ignored the
requested id and picked among all live legs for that ticker by **highest `livePnlPct`** —
deterministically the same answer no matter which of the ticker's concurrent positions was asked
about.

### Evidence

Live-reproduced 2026-09-21 (RTH) against production, on ABTC's two real concurrent banger-origin
swing positions:

- Position `1185` (9.5C, entry $0.35, `liveStatus: "TRIM"`, `livePnlPct: 200`)
- Position `1220` (10.5C, entry $0.40, `liveStatus: "OPEN"`, `livePnlPct: 25`)

```
GET /api/market/swing/play-brief?playId=SWING:ABTC:1220   → headline "TRIM — ABTC 9.5C 4DTE", Entry $0.35  (WRONG — this is position 1185's data)
GET /api/market/swing/play-brief?playId=SWING:ABTC:1185   → headline "TRIM — ABTC 9.5C 4DTE", Entry $0.35  (same response, byte-identical)
GET /api/market/swing/play-brief?playId=SWING:ABTC&positionId=1220  → same wrong 9.5C response
GET /api/market/swing/play-brief?playId=SWING:ABTC&strike=10.5&right=C → headline "HOLD — ABTC 10.5C 4DTE", Entry $0.40  (CORRECT — proves the strike-hint path works and only positionId was blind)
```

Both `1185` and `1220` requests returned an **identical** brief — the fallback's
highest-`livePnlPct` tiebreak, not the requested id. A member or Largo asking specifically about
the lagging 10.5C leg (P&L +25%, still `OPEN`, no management action fired) was silently shown the
already-`TRIM`ming 9.5C leg's numbers (P&L +200%, partial already banked) instead — a real,
actionable-decision-grade data mismatch with no error surfaced anywhere in the response.

### Fix rationale

Every `HorizonPlay` the lane fallback sees already carries its own correct `positionId` (the
banger row's real `id` for a banger-origin play, or a real `swing_positions.id` for a non-banger
lane row — `terminalPlayFromHorizon`/`horizonRowToDeckSource` already round-trip it). So the
minimal, correct fix is to check for an **exact `positionId` match** in `pickLanePlayForBrief`
first, before any of the strike/right/status/P&L heuristics — it can never be wrong when present
(it's the caller's own explicit request), and every existing heuristic stays exactly as it was for
the case that motivated it (a genuine ticker-only ambiguity with no id in hand). `positionId` is
threaded through the one call site in `resolveSwingPlayForBrief` that reaches this fallback.

Deliberately NOT touched: `loadOpenTerminalPlay`/`loadClosedPlay`'s `swing_positions`-only
queries. A "query `banger_positions` too" fix at that layer would be a larger, riskier change
(new IO dependency, new merge/precedence logic between two ledgers) for the same outcome this
smaller fix already achieves — the banger-origin play is always present in the lane rows
(`getSwingServingLane` already merges it in via `mergeBangerPositionsIntoSwingPlays`), so fixing
the *fallback* that already sees it is sufficient and lower blast-radius.

### Regression test

`src/lib/swing/play-brief-resolve.test.ts` — "pickLanePlayForBrief: exact positionId hint resolves
the SPECIFIC banger-origin leg, not the highest-P&L one". Reproduces the exact live ABTC shape
(two concurrent legs, no strike/right hint) and asserts each `positionId` resolves to its own
distinct leg. Verified RED against the pre-fix `pickLanePlayForBrief` (git-stash), GREEN after.
Full `src/lib/swing/*.test.ts` (1445 tests) and `tsc --noEmit` both clean post-fix.

### Blast radius

Any ticker with 2+ concurrent banger-origin swing positions and no strike/right disambiguation on
the play-brief request. Non-banger-origin swing plays are unaffected (their `positionId` already
matched via `swing_positions` at the earlier, unmodified resolution steps). Largo's tool-call
convention for this route (`?playId=SWING:<ticker>:<positionId>`) is exactly the shape this bug
hit hardest — no strike/right ever accompanies it.
