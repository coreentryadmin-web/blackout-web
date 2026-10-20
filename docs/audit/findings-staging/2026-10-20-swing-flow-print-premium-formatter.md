## A swing play-brief's notable flow prints rendered raw, unreadable per-contract-price dollar amounts for hundreds-of-thousands-dollar premiums, one line below a correctly K/M-scaled aggregate in the same section — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit live-testing
`GET /api/market/swing/play-brief` across OPEN/WATCH/CLOSED buckets for real positions (CRWV #63
OPEN, CRWV #61 CLOSED).

**Root cause:** `flowIntelSection`'s notable-prints loop (`src/lib/swing/play-brief-intel.ts`,
inside the "Flow & positioning" section) formatted each print's premium with `fmtUsd` (aliased from
`fmtOptionUsd` in `fmt-money.ts`, documented "Absolute per-contract option-premium PRICE at 2dp" —
built for $0.01-$999.99 contract prices like stop/target/mark rails). Applied to raw HELIX flow-print
premiums — hundreds of thousands of dollars — it produced unreadable output with no thousands
separator and a spurious 2dp suffix: live-confirmed on CRWV-OPEN (`PUT 43.00 $715000.00`,
`CALL 59.00 $577700.00`, `CALL 59.00 $473820.00`) and independently reproduced on CRWV-CLOSED
(`PUT 65.00 $873200.00`, `PUT 55.00 $824770.00`, `CALL 90.00 $781120.00`). The HELIX tape aggregate
rendered one line above in the SAME section correctly uses the K/M-scaled `fmtPremium` formatter
(`"HELIX tape (6h): balanced — calls $204K · puts $252K"`) — two incompatible dollar-magnitude
styles for the same kind of fact (flow premium) in one section.

**Live impact:** reachable on every swing play-brief whose ticker has HELIX flow prints in the last
48h — not an edge case; this is the normal, expected case for an actively-flowing ticker.

**Fix:** Swapped `fmtUsd` → `fmtPremium` at the one call site
(`play-brief-intel.ts`'s notable-prints loop). `fmtPremium` is already imported and used in this same
file for the identical "flow premium" quantity at two sibling call sites (the HELIX tape aggregate,
and the GEX-wall premium annotation) — this was the one omission.

**Fix rationale:** `fmtPremium` self-guards null/non-finite (returns `"—"`), so the existing
`p.premium != null ? fmtUsd(...) : "—"` ternary needed no restructuring, just the formatter swap —
minimal diff, matching exactly what the sibling call sites already do. Did not touch `fmtUsd`/
`fmtOptionUsd` itself (correctly used elsewhere in this same file for genuine per-contract prices —
stop/target rails) or the two sibling call sites that already use `fmtPremium` correctly.

**Blast radius:** single call site. Two existing tests asserted the buggy raw-format output
(`$3430000.00`, `$500000.00`) and were updated to assert the corrected `fmtPremium` output
(`$3.4M`, `$500K`) — confirmed these were genuinely asserting the pre-fix bug, not an unrelated
format, before changing them.

**Tests:** 1 new regression test (live-repro values: HELIX tape aggregate `$204K` alongside a
notable print `$715K`, explicitly asserting the raw `$715000.00` format never appears) + 2 existing
tests updated to the corrected format. RED→GREEN proven via `git stash` (3/3 new/updated assertions
fail pre-fix, pass post-fix — confirmed together with the sibling `play-brief-diff.ts` fix in the
same stash cycle). `tsc --noEmit` clean. Full suite green on Node 20.
