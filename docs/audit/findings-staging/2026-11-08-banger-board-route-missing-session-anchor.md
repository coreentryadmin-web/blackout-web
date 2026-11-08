> **kind:** FINDING

## `GET /api/market/banger/board` stamped only a bare UTC `as_of` with no ET session anchor (Largo C1 known gap)

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/app/api/market/banger/board/route.ts` (member-facing Banger board HTTP read, Engine B) |
| **Severity** | P3 (data-completeness / Largo contract gap, not a crash) |
| **Round** | 429 |

### Root cause

`src/app/api/market/banger/board/route.ts` is the member-facing HTTP read behind the "Bangers" tab
(`src/features/nighthawk/components/BangerBoard.tsx`, polled every 30s) and is also referenced by
the swing lane's portfolio-overlap resolution (`src/lib/swing/play-brief-resolve.ts`,
`src/lib/swing/banger-lane-merge.ts`). It stamped its response with a bare UTC instant and nothing
else:

```ts
return NextResponse.json(
  roundFloats({
    available: true,
    enabled: true,
    as_of: new Date().toISOString(),
    exit_rule_note: bangerScaleOutNote(),
    open: open.map(toBoardPlay),
    closed: closed.map(toBoardPlay),
  }),
  ...
);
```

Every row this route returns is itself keyed by an ET `session_date` (`toBoardPlay`'s
`session_date: row.session_date`), so the response was internally inconsistent in the same way
#7598 (this session, `getPlatformSnapshot`) found for `PlatformSnapshot`: the per-row data
disclosed its own ET session honestly while the top-level wrapper stamp around it did not.

This file was already listed in the Largo C1 session-anchor ratchet's `KNOWN_GAPS`
(`src/lib/largo/contract/session-anchor.test.ts`) as an open gap. Per that contract's own
docblock: after ~20:00 ET the UTC *calendar date* is already tomorrow, so any consumer resolving
"today's session" purely from `as_of`'s own date reads a full session ahead for the last ~4 hours
of RTH — the same inversion class fixed in #2418/#2420/#2422 and, this session, in
#7593/#7595/#7596/#7597/#7598.

Notably, `bangerBoardForLargo` (`src/lib/largo/product-reads.ts`) — the *direct* Largo-tool path
(`get_banger_board`) for this same underlying positions data — already stamps `as_of_et` AND
`session_date` correctly. Only this separate, member-facing HTTP route (used by the UI and by the
swing lane's cross-product resolution helpers) was missing the anchor.

### Evidence (RED → GREEN)

Added a regression subtest to the route's existing test file
(`src/app/api/market/banger/board/route.test.ts`) asserting the response carries a
`YYYY-MM-DD`-shaped `session_date` beside `as_of`. Stashing only the code fix (keeping the test)
reproduces RED:

```
not ok 1 - /api/market/banger/board open/closed are independently paged
  error: 'session_date must be a YYYY-MM-DD ET calendar date'
# tests 3 / pass 2 / fail 1
```

Restoring the fix: `# tests 3 / pass 3 / fail 0`.

The Largo C1 ratchet itself (`src/lib/largo/contract/session-anchor.test.ts`) also passes clean
after removing this file's `KNOWN_GAPS` entry (6/6 subtests, including the "list SHRINKS" check
that would fail if the entry were left stale).

`tsc --noEmit` is clean project-wide.

### Blast radius

- `src/app/api/market/banger/board/route.ts` — the only code site changed. `as_of` is unchanged
  byte-for-byte (still `new Date(nowMs).toISOString()`, now derived from a single `nowMs` so
  `as_of` and `session_date` can never describe different instants); `session_date` is new and
  additive.
- `src/features/nighthawk/components/BangerBoard.tsx`, `src/lib/swing/play-brief-resolve.ts`,
  `src/lib/swing/banger-lane-merge.ts` — all read this route's response; none assert an exhaustive
  response shape, so the new field is purely additive to them (confirmed via `tsc --noEmit`
  project-wide and the existing route test's untouched assertions still passing).
- `src/lib/largo/contract/session-anchor.test.ts` — removed the now-closed
  `"src/app/api/market/banger/board/route.ts": "coordinator"` entry.

**Not touched, deliberately:** `bangerBoardForLargo` in `src/lib/largo/product-reads.ts` (the
direct Largo-tool path) already carries this anchor and needed no change. The inline comment in
`route.ts` about `fetchBangerOpenBookRowsSettled`/`fetchBangerClosedBoardRows` (an unrelated,
already-fixed pagination bug from 2026-09-16) and the scoring/selection logic inside
`src/lib/banger/*` were both left untouched — this fix is scoped to the top-level `as_of` stamp
only, per this round's exclusion list for the banger lane.

### Fix rationale

Additive per the Largo product contract's own rule: keep `as_of` as-is, add `session_date` derived
from the exact same instant via the shared `etSessionDate()` helper
(`@/lib/largo/temporal/bar-session-date`) — the identical mechanical pattern used by the five prior
C1 fixes this session (#7593/#7595/#7596/#7597/#7598) and already used by this route's own sibling
Largo-tool path (`bangerBoardForLargo`). No alternative considered.
