## 2026-09-16 — [FINDING, FIXED] Legacy dev-preview fixture: SHORT play's stockMovePct sign contradicted its own narrative and P&L

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P4 |
| **Lane** | Night Hawk Legacy |
| **File** | `src/features/nighthawk/lib/legacy-board-dev-fixture.ts` |
| **PR** | (this branch) |

### Root cause

`LEGACY_BOARD_DEV_PLAYS` (the static fixture rendered live on `/nighthawk-boards-preview` via
`NightHawkBoardsPreviewClient.tsx`) includes a TSLA row: `direction: "SHORT"`,
`thesisBreak: { level: "break", note: "Opened above stop — setup broken" }`, `pnlPct: -45`,
`morningStatus: "INVALIDATED"`, `pulled: true` — every field describing a losing play that broke
on an adverse (upward) pre-market gap. Its `stockMovePct` field read `2.1` (positive).

Per `overlayLegacyQuotes`'s own SHORT formula (`use-legacy-quotes.ts`):
`stockMovePct = ((entryMid - price) / entryMid) * 100` for a SHORT play — a **positive** value
means the stock **fell** (favorable for a short/put thesis), and negative means it **rose**
(adverse). "Opened above stop" describes the stock gapping *up*, past even the stop level — an
unambiguously adverse move for this thesis, which by the shared formula's own sign convention
must read as a **negative** `stockMovePct`, not positive.

### Evidence

RED→GREEN proven in a new `legacy-board-dev-fixture.test.ts`: asserts the TSLA row's `pnlPct < 0`
implies `stockMovePct <= 0`. Reverting the fixture value alone reproduces the failure
(`pnlPct=-45 stockMovePct=2.1`); the fix (`stockMovePct: -2.1`) passes.

### Blast radius

Single fixture row, single consumer (`NightHawkBoardsPreviewClient.tsx` → the real
`/nighthawk-boards-preview` route). No production data path — this fixture explicitly has "no
adapters / DB imports" per its own header comment — but it IS rendered on a real app route, so a
developer (or agent) previewing the Legacy board locally would see a green "+2.1%" stock chip next
to a play flagged INVALIDATED with a losing P&L: the exact sign-confusion class this audit lane's
"marks correctness — no sign errors" mission pillar exists to catch, even though this instance is
fixture data rather than a live computation.

### Fix rationale

Flip the sign to `-2.1`, matching the row's own narrative/P&L, with an inline comment citing the
exact formula (`overlayLegacyQuotes`) and sign convention so a future fixture edit doesn't
reintroduce the same mismatch. No other fixture row in this file carries the same inconsistency
(checked all 5 rows: NVDA/INTC/AMD are LONG with positive stockMovePct+pnlPct both favorable;
AAPL is LONG, small positive both; TSLA was the only mismatch).

### Regression test

`src/features/nighthawk/lib/legacy-board-dev-fixture.test.ts` (new file) — asserts the TSLA row's
`pnlPct`/`stockMovePct` signs agree. RED→GREEN proven via git-stash: fails pre-fix (exact
`pnlPct=-45 stockMovePct=2.1` message), passes post-fix.
