## Ask Largo swing play-brief: GE Aerospace's generic SIC "3600" catch-all code mechanically resolved to Technology (XLK) instead of the correct Industrials label — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Night Hawk Swings — sector-rotation industry-group benchmark (`src/lib/swing/industry-group-rs.ts`), surfaced in the Ask Largo swing play-brief's "Why this setup" section (`play-brief-intel.ts`) |
| **Severity** | P3 (misleading narrative context, not a data-correctness/grading bug) |
| **Status** | FIXED |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate deep-dive, 2026-10-07 |

### Root cause

`sectorEtfFromSic` (`industry-group-rs.ts`) buckets any Polygon `sic_code` in the range 3600-3699
to `XLK` (Technology), with the comment "Electronic & electrical equipment ... → Tech". That range
was written for genuine electronics/communications-equipment sub-codes (3661 telephone apparatus,
3674 semiconductors, etc.), but it also silently swallows the generic top-level catch-all code
`3600` itself — whose own Polygon `sic_description` is **"ELECTRONIC & OTHER ELECTRICAL EQUIPMENT
(NO COMPUTER EQUIP)"**, explicitly disclaiming the Tech label.

Live-confirmed 2026-10-07: GE Aerospace (jet-engine manufacturer, `GET /v3/reference/tickers/GE`)
carries exactly this generic `sic_code: "3600"`. `resolveGroupBenchmark`'s granularity ladder
(exact-SIC industry ETF → SIC-range sector ETF → static sector-map label → null) let the coarse
SIC-range tier claim a match before the correct, hand-curated static label (`sector-map.ts`:
`GE: "Industrials"`) was ever consulted — the exact "mechanically-nearest-but-substantively-wrong
ETF" failure mode this same file's header already names, and that the `NO_SECTOR_BENCHMARK_THEMES`
guard already fixed for crypto-equity names (HUT/MSTR, PR for #5446).

### Evidence

Live repro: `GET /api/market/swing/play-brief?playId=SWING:GE&ticker=GE&status=WATCH&strike=300&right=C`
(2026-10-07 14:58 ET) rendered, in the "Why this setup" section:
`"**Industry read:** lagging **Technology** (XLK) by 7.1% over 10 sessions (-4.3% vs +2.8%)."`
— for GE Aerospace, an industrial/aerospace name, never a technology company. Confirmed the raw
Polygon reference data directly: `sic_code: "3600"`, `sic_description: "ELECTRONIC & OTHER
ELECTRICAL EQUIPMENT (NO COMPUTER EQUIP)"`. Confirmed the static sector-map already has the correct
answer: `src/lib/sector-map.ts` line 39, `GE: "Industrials"` — that correct entry was simply never
reached.

RED→GREEN: added `resolveGroupBenchmark: the generic SIC '3600' catch-all code is not auto-classified
Tech — it falls through to the static sector-map label` to `src/lib/swing/industry-group-rs.test.ts`.
Pre-fix (`git stash` on the implementation file only): test failed — `resolveGroupBenchmark({ticker:
"GE", sicCode: "3600", sectorLabel: "Industrials"})` returned `{etf: "XLK", label: "Technology",
kind: "sector"}` instead of the expected Industrials/XLI. Post-fix (`git stash pop`): GREEN. Full
`src/lib/swing/industry-group-rs.test.ts` suite: 16/16 pass. `npx tsc --noEmit`: clean.

### Fix

Added `if (sic === 3600) return null;` immediately before the `3600-3699 → XLK` range check in
`sectorEtfFromSic`, scoped to the EXACT ambiguous top-level code only — every genuine sub-code in
the range (3661, 3674, etc.) is untouched and still resolves to XLK as before (asserted in the new
test). Returning `null` here (not a guess) is the same "honest absence beats a wrong mechanical
match" principle this file's own header states for the coarser SIC-range tier generally; it lets
`resolveGroupBenchmark`'s next tier (the static sector-map label) win for any ticker that has one
(GE → Industrials/XLI), and correctly yields no benchmark at all for a ticker with SIC 3600 and no
static label (SECTOR_ROTATION simply won't fire for that name, which is the existing, intentional
behavior for any unresolvable sector — never a mislabel).

### Blast radius

Single function (`sectorEtfFromSic`), single call site (`resolveGroupBenchmark`), consumed by
`swing-ingest.ts`'s `industryGroupRsFacts`/`industryGroupRs01` (SECTOR_ROTATION archetype scoring
and the `sectorLeadershipFacts` narrated in the swing play-brief's "Why this setup" / "Industry
read" line). Any other live ticker whose Polygon `sic_code` happens to be exactly `"3600"` (not
3601-3699) gets the same correction automatically on next discovery/active-refresh — not swept
individually here, since the fix is at the shared resolver, not a per-ticker patch. Frozen
`sectorLeadershipFacts` on already-committed positions pinned before this fix are NOT retroactively
rewritten (same "grade against what was known at the time" principle the adjacent `staleBenchmark`
disclosure guard already establishes in `play-brief-intel.ts`) — a future pass could extend that
exact disclosure guard to cover this SIC-3600 case too if a live position is found still carrying
the stale XLK read, but none was found live in this pass (GE's own committed board rows were
WATCH-bucket, not yet committed, so no frozen stale fact exists yet to disclose).
