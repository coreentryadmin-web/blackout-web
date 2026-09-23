## Night Hawk Legacy's confluence gate structurally starves the whole-market breakout lane — SHADOW-LOG ADDED, LIVE FIX DEFERRED (operator instruction)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Night Hawk Legacy — `src/features/nighthawk/lib/candidates.ts` (`applyConfluenceGate`, `laneBreakout`) |
| **Severity** | P2 — a real, well-evidenced discovery gap; not shipped live pending operator confirmation |
| **Status** | SHADOW-LOGGED, NOT FIXED |
| **Found via** | Operator directive: "study what swings sees vs what you see... take the top 29 bangers and find more bangers" |

### Root cause

Cross-checked the whole-market banger scanner (`scripts/audit/market-banger-scan.mjs --top=29`,
2026-09-22 session, top 29 movers by $-volume) against Legacy's actual full candidate pool for the
same session (`GET /api/admin/nighthawk/candidate-leaderboard?edition_for=2026-09-23`, 51 tickers —
the whole pre-publish discovery/scoring/rank funnel, not just the 3 published picks). **25 of 29
(86%) of the real market-wide bangers never entered Legacy's candidate pool at all** — not
rejected after being scored, never discovered (SOXL, TER, NTRA, VICR, RMBS, CDE, DKS, KORU, UNG,
INOD, MDLN, SIMO, LSCC, ENTG, MXL, TTAN, AMKR, AMDL, ESI, GDXU, AUGO, BOIL, BFLY missing entirely;
only MRNA/ALAB/VKTX/SNXX/MUU/JAGX made it in).

Legacy genuinely has a whole-market breakout screen (`screenBreakoutMovers`, `candidates.ts:479`,
fed by `market-wide.ts:399` off the SAME Polygon grouped-daily source the standalone scanner uses,
with LOOSER thresholds: min gain 2% vs the scanner's 5%, price ceiling $2,500 vs $400). The lane
exists and its own doc comment (`candidates.ts:437-444`) describes it as designed to widen the
funnel toward tradeable bangers. But its scoring is structurally too weak to do that:

- `LANE_MAX_BREAKOUT = 18` (flat, no multiplier) vs `LANE_MAX_FLOW = 28` PLUS a compounding
  streak-days multiplier (up to 1.7×) and an unusualness-ratio multiplier — both of which only
  apply to flow-matched tickers (`candidates.ts:837-864`), since they key off the flow lane's raw
  premium.
- `applyConfluenceGate` (`candidates.ts:620-632`) admits the top `CONFLUENCE_PROTECTED_TOP=20`
  candidates by composite_score unconditionally, then requires `CONFLUENCE_MIN_SOURCES=2` distinct
  lanes for anything ranked below that.
- Options flow concentrates in liquid mega-caps by nature, so a small/mid-cap breakout-only name
  (single-lane: "breakout" alone) both (a) almost never reaches the top-20 composite_score cut
  given its much lower ceiling and lack of multipliers, and (b) almost never gets the 2-lane
  corroboration required below rank 20, because it structurally lacks matching options flow.

Net effect: the breakout lane is real, whole-market, and looser-thresholded than the standalone
scanner — but the scoring math around it starves it before it can surface anything.

### Night Hawk Swings already solves this exact problem

`src/lib/swing/discovery.ts`'s own doc comment (lines 11-14): *"MERGE — union the two screens,
unioning provenance paths. A name on BOTH is corroborated... Crucially, a STRUCTURE-only name with
NO flow still passes through (FM#1): it just carries a null accumulation read... never dropped
merely because it has no options flow."* This is the exact guarantee Legacy's confluence gate is
missing.

### Fix built (SHADOW-ONLY, not wired into the live pipeline)

`src/features/nighthawk/lib/candidates-breakout-shadow.ts` — `computeCorrectedCandidatePool`
mirrors `applyConfluenceGate` verbatim, plus one added admission path: a row whose `sources`
include `"breakout"` is admitted unconditionally, mirroring Swing's structure-only exemption.
`compareCandidatePool` diffs the REAL `applyConfluenceGate` output (calls it directly — cannot
diverge from production) against the corrected gate over the same pre-gate rows, reporting
`newly_admitted_tickers` / `dropped_to_make_room_tickers` / `would_differ`.

Wired into `extractMultiSourceCandidates` (`candidates.ts`, immediately after the real
`applyConfluenceGate` call) as ONE new sentinel row per edition build
(`ticker: "__EDITION__"`, `stage: "breakout_confluence_shadow"`) via the same fire-and-forget
`insertNighthawkCandidateSnapshots(...).catch(...)` pattern every other capture site in this file
uses — never awaited, cannot affect selection, cannot throw into the pipeline. The new stage tag
is not in `fetchNighthawkCandidateSnapshotsInRange`'s default scope (`["rank_final","rejected"]`),
so it cannot pollute any existing reader.

**Fixing this for real would change which tickers enter Legacy's live candidate pool** — a
live-picks-logic change, not a cosmetic one — so per the operator's explicit choice ("1." — shadow
mode first), this ships observational-only for now. The next step, once real
`breakout_confluence_shadow` history accumulates across several edition builds, is comparing the
corrected pool's real forward performance (same rank-bucket-analysis machinery already built for
#30) against the live pool before any live change is proposed.

### Blast radius / what was NOT touched

- `candidates.ts`'s `applyConfluenceGate`, `laneBreakout`, `LANE_MAX_BREAKOUT`/`LANE_MAX_FLOW`, and
  every other lane function — zero edits, zero behavior change. `git diff` on the actual selection
  logic is empty.
- No other file's exported behavior changes. The one touch to `candidates.ts` beyond the new
  import is the additive shadow-capture call block.
- Tests: `candidates-breakout-shadow.test.ts` (20 cases — no-drift parity with the real gate when
  no row carries the breakout lane, the structure-exemption rescue scenario, budget respected,
  non-breakout single-lane rows stay unexempted, `compareCandidatePool`'s diff reporting, the
  sentinel-row builder, and two drift guards: the module's default params match the real exported
  constants, and a source-inspection check that `applyConfluenceGate`'s own admission condition
  hasn't silently changed shape). `candidate-snapshot-alert-wiring.test.ts` extended 6→7 call
  sites. Full suite: 15239 pass / 0 fail / 3 skipped (Node 20) after the change — same as before.
