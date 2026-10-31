> **kind:** `FINDING`

## Ask Largo swing play-brief narrated/ladder-rendered/evidence-cited a GEX-king-coincides-with-a-wall strike TWICE instead of once — FIXED

| | |
|---|---|
| **Severity** | MEDIUM (Ask Largo × Night Hawk Swings standing ownership mandate — "narrative-vs-bullet-dump quality"; not a wrong number, but the SAME real number stated twice under two labels, in three different surfaces of the same response) |
| **Surface** | `src/lib/swing/play-brief-narrative.ts` (`collectFocalLevels`), consumed by `tradeManagerNarrativeSection` (same file), `buildStructureLadder` (`src/lib/swing/play-brief-ladder.ts`), and `extractEvidence` (`src/lib/swing/play-brief-adapter.ts`) — all reached by `GET /api/market/swing/play-brief` |
| **Status** | FIXED |

### Root cause

`collectFocalLevels(ctx, spot)` builds the shared, ordered list of structural price levels
(`dark_pool`, `put_wall`, `call_wall`, `gamma_flip`, `king`, `max_pain`, `magnet`) that every other
focal-level consumer in the swing play-brief reads from. It pushed each kind independently,
whenever it resolved non-null, with **no check for whether a later kind's resolved price equals an
earlier one already pushed**. The GEX king strike — definitionally wherever gamma concentration
peaks — commonly sits AT a major wall, so this collision is common, not an edge case.

Three independent downstream consumers of the SAME `focal` array each duplicated the collision on
their own:

1. **The narration loop** (`tradeManagerNarrativeSection`, same file) deduped only by **kind**
   (`used: Set<LevelKind>`), never by price — so both `narrateWall()` and `narrateKing()` fired as
   separate "Trade manager read" bullets about the literal same strike.
2. **`buildStructureLadder()`** (`play-brief-ladder.ts`) maps `focal` 1:1 into rungs via a plain
   `.map()`, so `envelope.structureLadder.rungs` carried two byte-identical `{price,
   target.rewardRisk}` entries differing only in `kind`/`label`.
3. **`extractEvidence()`** (`play-brief-adapter.ts`) walks those rungs and pushes an `"R:R to
   <label> ($<price>): <N>R"` string per rung with a target — so `evidence_numbers` stated the
   identical reward:risk number twice under two different labels.

A related, narrower fix shipped 2026-10-08 (`resolveInvalidationFocalLevel`'s own doc comment,
same file) patched a SIDE EFFECT of this exact collision — the wasted bullet slot could starve the
reserved Break-watch level's own narration out of the `MAX_BULLETS` cap — without deduping the
underlying collision itself. That fix's own comment literally names the symptom ("two bullets were
spent explaining call wall and GEX king, the same $7.50 strike, narrated twice") but explicitly
left the duplication unaddressed. This fix is the root-cause companion to that one.

### Evidence

Live reproduction (2026-10-31, production, read-only, `GET /api/market/swing/play-brief`), 3/3 real
tickers checked:

- **META** (`SWING:META:69`, 620C): call wall and GEX king both resolve to 700 →
  `structureLadder.rungs` contained `{kind:"call_wall",price:700,target:{rewardRisk:3.15,...}}` and
  `{kind:"king",price:700,target:{rewardRisk:3.15,...}}` back to back — byte-identical except
  `kind`/label. `evidence_numbers` contained both `"R:R to call wall ($700.00): 3.1R"` and `"R:R to
  GEX king ($700.00): 3.1R"`. Narration rendered both a "Call wall 700.00" bullet and a "GEX king
  700.00" bullet about the same strike.
- **CC** (`SWING:CC:2320`, 14C): call wall and GEX king both resolve to 15.00 — identical shape.
- **TSM** (WATCH, 415P): put wall and GEX king both resolve to 400.00 — identical shape.

RED→GREEN, `git stash` of just the source fix (`play-brief-narrative.ts`), keeping the new tests in
place:

- **Before the fix**: `collectFocalLevels` returns TWO entries at the collided price (confirmed via
  a direct unit test reproducing the META shape: call wall + king both at 700); the narration loop
  renders both a `**Call wall 700.00**` and a `**GEX king 700.00**` bullet; `buildStructureLadder`
  produces two rungs at the collided price; the real end-to-end pipeline (`composeSwingPlayBrief` →
  `adaptSwingBriefToLargo`) cites two `"R:R to ..."` evidence strings for the same price.
- **After the fix**: exactly one merged entry/rung/bullet/evidence-string survives in every case.

Full suites, Node 20: `play-brief-narrative.test.ts` 206/206 (combined with `play-brief-ladder.test.ts`
+ `play-brief-adapter.test.ts`), 941/941 across every related swing play-brief test file
(`play-brief-narrative-coaching`, `play-brief-intel`, `play-brief-intel-collapse`, `play-brief`
included). `npx tsc --noEmit` clean repo-wide on Node 20. The existing 2026-10-08 Break-watch-budget
test (`"a distant put wall still gets its own bullet when it anchors Break watch, even past
MAX_BULLETS"`) passes unchanged.

### Blast radius

Single shared function, single file (`collectFocalLevels` in `play-brief-narrative.ts`), but reached
by every consumer of its output: the "Trade manager read" narration loop and `breakTrigger`/
`resolveInvalidationFocalLevel` (same file), `buildStructureLadder`'s rungs (`play-brief-ladder.ts`,
rendered visually by `BieStructureLadder.tsx`), and `extractEvidence`'s plain-text evidence array
(`play-brief-adapter.ts`, the Largo-contract-facing `evidence_numbers` field every rich Largo answer
over a swing play reads). Any ticker whose GEX king strike coincides with its call or put wall
(common — confirmed on 3/3 real tickers checked in one pass) was exposed on every one of these
surfaces simultaneously. `counterThesisLine`/`dealerPostureLine` (same file) independently
re-derive put/call wall directly from `vec`/`gex` rather than reading `collectFocalLevels`'s output,
so they were never affected and needed no change. `envelope.levels` (`levelsFromContext`,
`play-brief.ts`) and `LADDER_COVERED_LEVEL_LABELS` (`src/features/largo/answer/level-dedup.ts`) are
a separate, independently-computed list filtered by label text, not by this function's output —
out of scope here, unaffected either way.

### Fix rationale

Dedupe at the root — `collectFocalLevels` — via a new `pushFocalLevel(out, level)` helper used at
every one of the function's 7 push sites instead of a bare `out.push(...)`. On a price collision
(same tolerance, `< 0.01`, `confluenceZoneKindsLabel` already uses elsewhere in this product for
price identity — `play-brief-absence.ts`), a "hard" kind (`put_wall`/`call_wall`/`king`/
`dark_pool` — a real, priced structural fact) always outranks a neutral pivot (`gamma_flip`/
`max_pain`/`magnet` — mirrors `roleForKind`'s own non-neutral/neutral split in
`play-brief-ladder.ts`, restated locally to avoid a circular import). Within the hard tier — the
live repro's actual shape, king coinciding with a wall — the earlier-pushed kind survives, which,
given this function's fixed push order (dark-pool prints, then put/call wall, then king), means a
real wall's directional breached/cleared/reclaimed coaching (`narrateWall`) wins over king's generic
pin-risk framing (`narrateKing`).

This priority was **not** picked a priori — it was checked against this file's own existing,
already-shipped tests before being chosen. Four existing narration tests (2026-10-14, "LONG put
wall ABOVE spot reads as broken support", "LONG call wall BELOW spot reads as cleared resistance",
"SHORT call wall BELOW spot reads as reclaimed resistance", "SHORT put wall ABOVE spot reads as
already broken") construct fixtures where a wall and the GEX king happen to coincide at the same
price, and assert on the **wall's** narration text specifically. An earlier design draft of this fix
had `king` win every collision (reasoning that `resolveInvalidationFocalLevel` treats `king` as a
valid invalidation candidate for EITHER trade direction while a wall is only valid for one
direction) — that draft was discarded specifically because it broke all four of those pre-existing
tests (the single surviving bullet would have been king's generic "pin risk" text, not the wall's
breached/cleared/reclaimed text those tests require). Matching the file's own established display
convention (wall wins) over a theoretically-tidier but untested alternative is the documented,
deliberate trade-off: losing `king`'s direction-agnostic validity when it coincides with a
cross-direction wall is a known, narrow gap this fix accepts rather than claims to solve perfectly —
noted in `pushFocalLevel`'s own doc comment for a future session to revisit if it ever matters in
practice.

### Tests

- `src/lib/swing/play-brief-narrative.test.ts` — 3 new tests: `collectFocalLevels` merges a
  call-wall/king collision and a put-wall/king collision into one entry each (live META/CC/TSM
  shape); `tradeManagerNarrativeSection` narrates exactly one bullet (the wall's) for a colliding
  strike, not two.
- `src/lib/swing/play-brief-ladder.test.ts` — 1 new test: `buildStructureLadder` produces exactly
  one rung for a colliding strike, not two.
- `src/lib/swing/play-brief-adapter.test.ts` — 1 new test: drives the REAL end-to-end pipeline
  (`composeSwingPlayBrief` → `adaptSwingBriefToLargo`, not a hand-built `structureLadder`) and
  asserts exactly one `"R:R to ..."` evidence string for the colliding price, with a sanity check
  that the real pipeline actually merged the rungs upstream (so the test can't pass for the wrong
  reason).

All 5 new tests proven RED without the source fix (`git stash` of just `play-brief-narrative.ts`)
and GREEN with it restored. 941/941 pass across every related swing play-brief test file. `npx tsc
--noEmit` clean repo-wide on Node 20.
