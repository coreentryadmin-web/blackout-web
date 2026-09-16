> **kind:** FINDING

# `legacyBoardExportCsv` used JSON escaping instead of CSV escaping — a real corruption path — FIXED

| **Status** | Fixed |
|---|---|

## Root cause
`legacyBoardExportCsv` (`src/features/nighthawk/lib/legacy-board-table-utils.ts`), wired into the
live "Export CSV" action on `LegacyPickLogBoard.tsx`, quoted several free-text fields
(`contractLabel`, `stopLevel`, `targetLevel`, `entryRange`, `riskNote`, `factors`) with
`JSON.stringify(...)` as a stand-in for CSV field escaping. `JSON.stringify` escapes an embedded
double quote as `\"` (backslash-quote); RFC 4180 CSV instead requires **doubling** an embedded
quote as `""`. A CSV reader has no concept of backslash escapes inside a quoted field, so when it
hits the `"` immediately after the backslash it treats that as the field's closing quote — the
remainder of the quoted text spills into the next column, corrupting the row.

This was a real, reachable bug, not a hypothetical: `risk_note` (and the adjacent `thesis` field)
is LLM-authored prose, and the system prompt that generates it (`format.ts`) explicitly instructs
the model to reference catalysts and explain risk — in practice this routinely produces text that
quotes a catalyst headline verbatim, e.g. `Catalyst: "The company secured new contracts..."` (a
live example from tonight's own RIG pick's `thesis` field). Any Legacy pick whose `risk_note`
quotes a headline this way would export a corrupted CSV row.

## Evidence
- Read the sibling `vectorBoardExportCsv` (`vector-board-row-utils.ts`) earlier this session and
  noted it escapes its own free-text `reason` field correctly: `` `"${(r.reason ?? "").replace(/"/g, '""')}"` ``
  — the correct RFC 4180 pattern, already established elsewhere in the same file family.
- Live-observed `thesis` text from tonight's edition (2026-09-16) already contains embedded quotes
  in exactly the shape that would trigger this: `Catalyst: "The company secured substantial new
  contracts worth $292 million..."`.
- RED→GREEN proof: added a regression test with a `risk_note` containing an embedded quote,
  confirmed it fails against the pre-fix code (`git stash` the fix, re-run: output shows the raw
  `\"` — `Catalyst: \\"The company secured new contracts\\" — elevated risk...`), then passes
  against the fix (output shows the correctly doubled `""`).
- `npx tsc --noEmit` clean; full `npm test` run (see PR).

## Fix rationale
Added a small `csvField()` helper implementing RFC 4180 escaping (wrap in quotes, double any
embedded quote) and replaced every `JSON.stringify(...)` call in `legacyBoardExportCsv` with it.
Left `ticker`/`statusLabel`/`morningStatus` unquoted — they're fixed enum-like labels that never
contain commas or quotes, consistent with how `vectorBoardExportCsv` treats its own equivalent
fields. No behavior change to any other function; this file's other exports were untouched.

## Blast radius
Single function, single file. `legacyBoardExportCsv` has exactly one call site
(`LegacyPickLogBoard.tsx`'s "Export CSV" button). No other exporter shares this bug — checked
`vectorBoardExportCsv` (the 0DTE/Vector/Swing-shared sibling) and confirmed it already uses correct
escaping, so this was a Legacy-specific regression/gap, not a cross-product issue.
