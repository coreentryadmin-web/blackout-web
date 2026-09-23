## `GET /api/market/swing/record`'s `summary.opens` (and the member-facing "Open" tile) was structurally blind to every Engine B (Banger) open position — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings — Ask Largo (5-engine live monitor sweep) |
| **Severity** | P2 (member-facing UI tile + Largo-readable field undercounts the real open book by ~96%) |
| **File** | `src/app/api/market/swing/record/route.ts`, `src/lib/swing/record.ts` |

### Root cause

`buildSwingRecordSummary`'s `opens` field is computed purely from `swing_positions` chains
(`records.length - resolved.length`), fed by `fetchSwingPositionsRange`/`fetchSwingPositionChain`
(`src/lib/db.ts`) — both of which query `swing_positions` exclusively, confirmed by direct SQL
inspection:

```sql
-- fetchSwingPositionsRange
SELECT * FROM swing_positions WHERE session_date >= $1::date ORDER BY session_date DESC, id DESC LIMIT $2
-- fetchSwingPositionChain
SELECT * FROM swing_positions WHERE id = $1 OR root_position_id = $1 ORDER BY roll_seq ASC, id ASC
```

Engine B (Banger) open positions live in a **completely separate table**, `banger_positions`, and
are merged into the Swing lane's board **display only** by `banger-lane-merge.ts`
(`mergeBangerPositionsIntoSwingPlays`) — never into anything `record.ts`/`record/route.ts` reads.
So `summary.opens` (and the `SwingAnalyticsPanel.tsx` "Open" tile that renders it directly to
members) could never count a banger-origin open position, no matter how many were live.

This is the exact same banger/swing table split already fixed once before in this lane, for a
different consumer: `docs/audit/FINDINGS.md`'s "Ask Largo swing 'Book context' concentration check
was blind to 94% of the live open book" (`play-brief-context.ts`'s `loadOpenBook()`, fixed by
adding a `fetchBangerOpenBookRows()` read). That fix's own "Blast radius" section explicitly notes
it was a single call site — it never touched `record.ts`/`record/route.ts`, so this route carried
the identical gap forward, undiscovered until now.

**Live evidence, 2026-09-23:** `GET /api/market/swing/record?days=7` reported `summary.opens: 3`
while `GET /api/market/nighthawk/horizons?view=swings` showed 82 real committed SWING-lane
positions (81 banger-origin, 3 native swing) — an 82/3 = ~27x undercount, i.e. the field/tile
reported ~4% of the true open book.

### Fix

Route layer only (mirrors the earlier `loadOpenBook()` fix's shape): after building the native
`summary` from `buildSwingRecordSummary` (left byte-identical, pure, unit-tested — no logic
change), the route additionally calls `fetchBangerOpenCount()` (`@/lib/banger/positions-db`, the
same TRUE-count accessor `bookContextSection`'s fix and `banger/board`'s route already use — not
the page-limited `fetchBangerBoardRows` tally that was a separately-fixed bug), gated by the same
`isBangerEngineEnabled()` kill-switch every other banger consumer respects, and folds it into the
response:

```ts
const nativeSummary = buildSwingRecordSummary(records, { since, through, days });
const bangerOpens = isBangerEngineEnabled() ? await fetchBangerOpenCount().catch(() => 0) : 0;
const summary = {
  ...nativeSummary,
  opens: nativeSummary.opens + bangerOpens,
  nativeOpens: nativeSummary.opens,
  bangerOpens,
};
```

Per the Largo Product Contract's ADDITIVE principle (wrap, don't flatten), `SwingRecordSummary`
gained two new fields — `nativeOpens` (the pure swing-only count, unchanged from before) and
`bangerOpens` — so `opens` becomes the honest combined total without destroying the native number
consumers/tests already rely on. `buildSwingRecordSummary` populates both new fields with
`nativeOpens = opens, bangerOpens: 0` by default (its native, single-caller contract is
unaffected); only the route layer, which has access to the banger DB accessor, overrides them.

The banger fetch is wrapped in its own `.catch(() => 0)` — a banger-side DB hiccup falls back to
0 rather than failing the whole `/record` response, matching the existing per-source fail-soft
discipline `loadOpenBook()` already established for this identical split.

### Evidence

Two RED→GREEN tests (`git stash` proven — failed against the pre-fix route, passed once the
banger fold-in was added), `src/app/api/market/swing/record/route.test.ts`:
- `summary.opens is native swing opens PLUS banger opens, both disclosed separately`
- `banger fetch is skipped and contributes 0 when the Engine B kill-switch is off`

`src/lib/swing/record.test.ts`: 14/14 pass unmodified (the two new `SwingRecordSummary` fields are
additive; the existing `opens` assertion at `record.test.ts:150` is untouched since
`buildSwingRecordSummary`'s own arithmetic did not change). `tsc --noEmit`: clean. Full `npm test`
(Node 20): run in progress at PR time, will be confirmed green before merge.

### Blast radius

`SwingRecordSummary`'s only producer (`buildSwingRecordSummary`) and only consumer
(`route.ts`) are both in this repo (grep-confirmed); no other caller exists. The
`SwingAnalyticsPanel.tsx` "Open" tile (`{summary.opens}`) needed no code change — it already reads
`summary.opens`, which now carries the correct combined total automatically. `nativeOpens`/
`bangerOpens` are new, additive fields; nothing downstream reads them yet (a natural small
follow-up would be disclosing the split in the UI tile itself, left out of this PR to keep it
single-issue per the standing PR write-up policy).

### Fix rationale

This is the same "contained wiring gap" shape as the earlier `bookContextSection` fix:
`fetchBangerOpenCount()` already exists, is already used elsewhere for the identical open-count
question, and banger positions carry no ambiguity this fold-in needs to resolve (a plain count,
not a chain/grade to merge). No new shared abstraction, no attempt to build banger "chains" into
the swing record's grading methodology — `docs/audit/OUTCOME-GRADING-SPEC.md` deliberately keeps
Banger's and Swing's CLOSED-position grading separate (different graders, different tables), and
this fix does not touch that boundary at all; it only fixes an OPEN-position COUNT, which is a
plain aggregate, not a graded outcome.
