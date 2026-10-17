> **kind:** FINDING

## SPX Slayer play narrative: `anchorPhrase()` cites the farthest GEX wall instead of the nearest one — FIXED

| **Status** | Fixed (`anchorPhrase()`, `src/features/spx/lib/spx-play-intel.ts`) |
|---|---|

**Found via:** the standing 5-engine live monitor cycle (2026-10-17 ~19:21-19:29 UTC), SPX Slayer health check sub-agent.

**Live repro.** `GET /api/market/spx/play` (cron auth), field `gates.play_idea`:
```
"play_idea": "Leaning Puts — 7660 Put could be the play off below 7900 resistance"
```
`desk.gex_walls` is returned strike-descending (confirmed live via `GET /api/market/spx/desk`: 7900, 7675, 7670, 7665, 7660, then supports 7655…7635 — price was 7659.44).

**Root cause.** `anchorPhrase()`'s resistance branch (`src/features/spx/lib/spx-play-intel.ts`, ~line 65-67) used `desk.gex_walls?.find((w) => w.kind === "resistance")` with no proximity selection. `.find()` returns the FIRST element matching the predicate, and since the array is strike-descending, that is always the highest-strike (farthest) resistance wall — never the nearest one. Expected: the resistance cited should be the nearest one above spot (7660, only 0.56 pts away) — the exact wall the confluence score is keyed off of (`factors[]`: `{"label":"GEX resistance","weight":-18,"detail":"Into 0DTE resistance 7660 (−1 pts)"}`, produced by `buildLevels()`'s `nearestWall()` helper in `spx-signals.ts`). Actual: the narrative cited 7900, a wall 240.56 pts from spot, while the real near-term resistance that drove the score was never mentioned.

The support branch (`desk.gex_walls?.find((w) => w.kind === "support")`) had the identical shape but happened to return the nearest support by coincidence of the descending sort order (supports sit below spot, so the first support hit scanning high-to-low is the closest one) — not by design, so it was fixed too for robustness rather than left "correct by accident."

**Blast radius.** `humanizeGateBlock()` (same file) substitutes this exact `buildPlayIdeaIntel()` line for several real gate-block reasons (grade-too-low, score-too-low, "too many conflicts", weak confirmations) any time `desk.vwap` is null or price is on the "wrong" side of VWAP for the chosen direction — so the incoherent wall citation reaches `gates.blocks[]` text during live trading hours too, not just the closed-session `play_idea` field checked in this repro.

**Fix.** Exported `nearestWall()` from `spx-signals.ts` (previously a private helper) and reused it in both `anchorPhrase()` branches — the identical resolver `buildLevels()` already uses to pick the wall that drives the confluence score, with its own `requireSide` constraint ("below"/"above" price) so the narrative always cites the same level the score is keyed off of, rather than re-deriving "nearest" a second way.

**Why this fix and not an alternative.** Considered a local `.filter().sort()[0]` inline (mirroring `suggestPlayStrike()`'s own pattern a few lines above) instead of exporting `nearestWall`, but reusing the canonical resolver directly guarantees the narrative text and the score-driving factor can never disagree on which wall is "nearest" again — the two are now structurally the same computation, not two independent ones that happened to agree today.

**Tests.** One new regression test in `src/features/spx/lib/spx-play-intel.test.ts` using the exact live repro shape (price 7659.44, resistances 7900/7675/7670/7665/7660 descending) asserts the anchor now cites 7660, not 7900. RED→GREEN proven via `git stash` of `spx-play-intel.ts`/`spx-signals.ts` alone (1 failure without the fix, 0 with it restored). Full `src/features/spx/lib` suite: 849/849 pass. `tsc --noEmit`: clean.
