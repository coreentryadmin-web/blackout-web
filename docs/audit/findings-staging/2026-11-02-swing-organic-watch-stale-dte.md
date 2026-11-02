> **kind:** FINDING

## Organic (non-Legacy) swing WATCH/RESEARCH candidates served a stale `contract.dte` — FIXED

**Status:** FIXED (`fix/swing-organic-watch-stale-dte`)

### Root cause

`serving-lane.ts`'s serve-time DTE refresh (`refreshLegacyExemptDteForServe`, added 2026-10-31 for
a Legacy-exempt-only live repro) recomputed `contract.dte` and the DTE token baked into `reason`
against TODAY's real ET calendar day — but only for plays passing `isLegacyExemptPlay` (i.e.
`commitGateBlockedBy.includes("legacy:exempt")`). `enrichPlay`'s subsequent dossier-merge return
object (building the rest of the served play) never touches `contract`/`reason` for ANY play type
— only `setupState`/`entryStatus`/`archetype`/`subLane`/`factors`/`regime`/`thesisLevel`/
`thesisNote`/`sectorLeadershipFacts`/`flagUnderlyingPx`/`entryTriggerUnderlyingPx`/`liveSpot` are
overwritten. So an ORDINARY organic (FLOW/STRUCTURE/CATALYST/POSITIONING/VECTOR-origin) WATCH/
RESEARCH candidate — no DB position row, no `legacy:exempt` marker, real gate-block codes — had the
identical staleness shape as the Legacy-exempt case the 2026-10-31 fix addressed (no live
`contractFromRow` recompute, no per-scan carry-forward between scans), but the gate excluded it.

This is the third occurrence of this exact bug class: (1) 2026-10-31, Legacy-exempt committed plays
via `refreshLegacyExemptDteForServe`; (2) a Legacy-promoted-WATCH variant in
`legacy-confirm-promote.ts`'s `refreshCarriedLegacyPlay`; (3) this fix, every organic WATCH/
RESEARCH candidate with no DB position row and no `legacy:exempt` marker — the largest population
of the three, and the only one neither prior fix covered.

### Evidence

Found via the five-engine live correctness audit (cycle-72), Swings board check. Live repro, `GET
/api/market/nighthawk/horizons?view=swings` fetched 2026-11-02T02:44:47Z (ET "today" = 2026-11-01):
`board.lanes.SWING.scanSessionDay: "2026-10-30"` (last scan ran Friday). The lone WATCH row, TSM
(direction SHORT, `commitGateBlockedBy: ["gate:G-S4:regime_degraded", "gate:G-S6:confluence",
"gate:G-S14:cortex_net_negative"]` — no `legacy:exempt` marker, an ordinary organic discovery
candidate), served `contract: {expiry: "2026-11-13", dte: 14}` and `reason: "P 415 exp 2026-11-13
(14DTE, Δ0.58, OI 410)"`. `calendarDte("2026-10-30", "2026-11-13") = 14` (matches what was served —
frozen to the scan day); `calendarDte("2026-11-01", "2026-11-13") = 12` (the correct value as of
serve time). Every DB-committed live row on the same board correctly recomputed fresh — e.g. AXTI
(Legacy-EXEMPT, committed) showed `contract.dte: 5` for its 2026-11-06 expiry, correctly
`calendarDte(2026-11-01, 2026-11-06) = 5`. No staleness caveat anywhere on TSM's `contract`/
`reason` — unlike the system's many deliberate `(stale — ...)` disclosures elsewhere.

New regression test proven RED (pre-fix) / GREEN (post-fix) via `git stash`/`git stash pop`:
`"a NON-legacy-exempt pre-entry WATCH play's DTE is ALSO recomputed against TODAY on every serve —
not just Legacy-exempt plays"` (`serving-lane.test.ts`) — asserted `9 !== 7` (RED, old narrow
behavior) before the fix, passed after. The prior test asserting the OLD narrow scope ("scope stays
narrow") was itself encoding the bug and is flipped to assert the corrected behavior.

Full targeted swing suite: `npx tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts`
→ 2223/2223 pass. `npx tsc --noEmit` clean.

### Blast radius

Single function, single call site: `refreshLegacyExemptDteForServe` (renamed `refreshDteForServe`)
is called only from `enrichPlay`, which itself is called only from `getSwingServingLane`'s
`discoveryPlays.map(enrichPlay)` — the pre-entry discovery lane. Committed OPEN/HOLD/TRIM ledger
rows take a completely separate path (`livePlaysFromOpenPositions` / `attachThesisExplanation`)
and never reach this function, so there is no committed row whose already-correct, freshly-
recomputed `contract.dte` this generalization could clobber. No other call site of the renamed
function exists.

### Fix rationale

Dropped the `isLegacyExemptPlay` gate entirely — the function now applies to any play with a
`contract.expiry`, which (per the blast-radius analysis above) only ever reaches pre-entry
discovery plays, the exact population that needs this refresh. Deliberately left unchanged: only
`contract.dte` and the DTE token in `reason` move — mid/bid/ask/delta/gamma/theta/vega/iv are still
untouched, since recomputing DTE needs no provider read but a fresh quote cannot be conjured the
same way; that scope boundary from the original 2026-10-31 fix was correct and is preserved.
