## 2026-10-09 — [FINDING, spx-slayer] `gates.blocks_by_category` reuses the stale, pre-humanization raw blocks list — double-counts a gate reason the flat `blocks` array already collapsed into one — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (every individual gate reason is real; the defect is `gates.blocks_by_category` presenting two reasons as independent when the flat `blocks` list the same payload carries already shows them collapsed into one) |
| **Component** | `src/features/spx/lib/spx-play-payload.ts` (`intelGates()`) |
| **PR** | fix/spx-play-blocks-by-category-stale |
| **Found via** | 5-engine live monitor, :20 cycle — live `GET /api/market/spx/play` health check (task item 1: "Are `gates.blocks` reasons coherent?") |

### Root cause

`evaluatePlayGates()` in `spx-play-gates.ts` computes `blocks_by_category: categorizeGateBlocks(blocks)`
and `first_block_category: firstGateBlockCategory(blocks)` from the **raw**, pre-humanization gate
blocks list (the literal strings pushed as each gate fails, e.g. `"Grade D below minimum (need B or
better)"` and `"Score N too low — quality setups only"`).

Separately, `intelGates()` in `spx-play-payload.ts` builds the **user/Largo-facing** `blocks` field by
running `humanizeGateBlocks()` (`spx-play-intel.ts`) over that same raw list and deduping the result.
`humanizeGateBlocks()` was itself fixed on 2026-09-28 to collapse two structurally different raw
reasons into one line when they both resolve to the same `buildPlayIdeaIntel()` idea — a weak setup
commonly fails the grade gate AND the score gate simultaneously, and both humanize to the same "Tape's
mixed, but X lean..." idea line, differing only by a trailing suffix.

`intelGates()` built the new, deduped `blocks` field correctly, but then returned `gates.blocks_by_category`
and `gates.first_block_category` **verbatim**, untouched — the exact raw, non-deduped categorization
computed before humanization ran. So the flat list and the categorized breakdown of the *same payload*
diverge: `blocks` shows one collapsed idea line, `blocks_by_category.quality` still lists both raw
strings as if they were two separate reasons. This is the identical double-counting defect the
2026-09-28 fix addressed — just in a parallel field nobody re-derived.

### Evidence

Live `GET /api/market/spx/play` (2026-10-09, ~08:20 ET, pre-market, score 23/grade D/3 conflicts):

`gates.blocks` (11 entries) contained, as one collapsed entry:
```
"Tape's mixed, but Calls lean — 7765 Call on watch · At 0DTE support node 7765 (+0 pts) · waiting for grade confirmation"
```

`gates.blocks_by_category.quality` (9 entries) separately still listed, verbatim:
```
"Grade D below minimum (need B or better)"
"Score 23 too low — quality setups only"
```
— neither of which appears anywhere in the flat `blocks` array at all (they were humanized away), and
the flat list's own collapsed idea-line entry does not appear in **any** category bucket either (it
classifies as "quality" by `classifyGateBlock`'s default, but the stale categorization never re-ran
classification on it). Total categorized-bucket count (12, across operational+quality) did not equal
the flat `blocks` count (11) — the two fields are not a consistent view of the same gate evaluation.

This field is not cosmetic-only: `fitSpxPlayForModel()` (`src/lib/largo/spx-play-fit.ts`) passes
`gates.blocks_by_category` through to Largo's `get_spx_play` tool response uncapped, so a model reading
the categorized breakdown would see two "reasons" for exactly the one situation the flat `blocks` list
(correctly) already shows as one.

Reproduced as a deterministic unit test with a minimal desk/confluence fixture mirroring the live
score/grade/conflicts combination (`spx-play-payload.test.ts`), independent of any live network call.

### Fix rationale

Re-derive `blocks_by_category` and `first_block_category` in `intelGates()` from the **final**
humanized+deduped `blocks` list (the same one returned to the caller), instead of passing through
`gates.blocks_by_category`/`gates.first_block_category` from the pre-humanization `PlayGateResult`.
`categorizeGateBlocks`/`firstGateBlockCategory` (`playbook-gate-categories.ts`) classify by regex
pattern on the message text; humanized idea lines that don't match any operational/risk/playbook_validity
pattern correctly fall to the "quality" default, which is where they belong. No change to the pass/fail
decision itself (still computed from the raw blocks in `evaluatePlayGates()`, as the existing comment
already states) — only to the two derived display fields that must agree with `blocks`.

Considered and rejected: fixing this inside `evaluatePlayGates()` instead (computing on humanized
blocks there). Rejected because `evaluatePlayGates()` doesn't have `humanizeGateBlocks`'s dedup
semantics threaded through it, and the raw blocks list is also used for the pass/fail boolean and other
internal gate logic elsewhere in that file — changing what it categorizes risked touching more than
this one display-field bug. Keeping the raw list for gate evaluation and only re-deriving the two
*display* fields in `intelGates()` (which is itself the one place that already re-shapes `blocks` for
display) keeps the fix scoped to the actual defect.

**Blast radius:** `intelGates()` is the single construction site for `SpxPlayPayload["gates"]`, called
from every code path that builds the `/api/market/spx/play` response (live, scanning, degraded-fallback
paths all set their own `blocks_by_category` separately via `emptyCategorizedGateBlocks()` or inline
`categorizeGateBlocks()` calls already — only the live-gates path through `intelGates()` had the stale
reuse). No other call site needed changes.

### Evidence the fix is real (RED → GREEN)

Added `src/features/spx/lib/spx-play-payload.test.ts`: `intelGates()` fed a `PlayGateResult` fixture
with the live raw-blocks shape (grade-below-minimum + score-too-low both present, as evaluatePlayGates
would produce them) asserts `blocks_by_category` flattens back to exactly the same set as `blocks`, and
contains no leftover raw "Grade D below minimum"/"too low — quality setups only" strings. `git stash`
on the implementation change alone (kept the new test): failed with the exact live-observed divergence
(categorized set included the two stale raw strings, missing the collapsed idea line) before the fix;
after restoring the fix, the test — and all 31 tests across `spx-play-payload.test.ts`,
`spx-play-intel.test.ts`, `spx-play-claude.test.ts`, `spx-play-gates-playbook-allowlist.test.ts`,
`spx-play-hysteresis.test.ts` — pass. `npx tsc --noEmit` clean. Full `npm test` (Node 20): 15890 pass /
0 fail / 3 skipped (pre-existing, unrelated).
