## Night Hawk Swings — `siblingPositionsNote` could silently hide a real concurrent position when two positions fill within $0.005 — FIXED

> **kind:** `FINDING`

**Symptom:** The swing play-brief's "Other concurrent position(s)" section
(`siblingPositionsNote`, `src/lib/swing/play-brief.ts`) discloses every OTHER live
position a member holds on the same ticker. Its self-exclusion test (telling "this is
the position the brief is about" apart from "a genuine sibling") was `Math.abs(r.entryPremium
- play.entry) > 0.005` — i.e. "if the entry premium is close enough to mine, treat it as me."

**Root cause:** The function's own doc comment stated the justification directly: "two
genuinely different positions on one ticker always differ in strike/expiry/entry price
in practice." Live data (Ask Largo standing-mandate deep-dive, 2026-10-11) falsifies this:
AMD carried two independently-committed open positions, `positionId` 51 (archetype
`EVENT_DRIVEN`) and 52 (archetype `PULLBACK_CONTINUATION`) — genuinely separate theses by
`commit.ts`'s own idempotency key (`swingThesisKey(ticker, direction, archetype)` treats a
different archetype as a different thesis, so both were allowed to commit independently) —
that both resolved to the IDENTICAL contract (605C 2026-10-16) via `pickChainContract` and
filled only $0.25 apart ($17.73 vs $17.48). That gap happened to clear the old `> 0.005`
bar, but nothing stops two independently-committed positions from filling within half a
cent of each other (two orders hitting the same quoted mid) — in that narrower case the old
filter would misidentify the real sibling as "self," the section would compute zero
siblings, and `!siblings.length` returns `null`: the whole disclosure silently vanishes. A
member with two live positions on a ticker would see no indication of the second one at
all — the "absence must be disclosed, never silent" violation (Largo contract point 3) this
section exists to prevent in the first place (its own header cites the original 2026-09-11
bug it was built to fix), reached here via a different gap.

**Evidence:** Live repro via the production play-brief API (`GET
/api/market/swing/play-brief?playId=SWING:AMD&ticker=AMD&status=COMMIT&positionId=52` and
`...positionId=51`, 2026-10-11): both briefs correctly surfaced the other (confirmed via the
`GET /api/market/nighthawk/horizons?view=swings` board data showing identical `contract`
objects — strike 605, expiry 2026-10-16, right C — for both `positionId` 51 and 52, with
`archetype` fields `EVENT_DRIVEN` and `PULLBACK_CONTINUATION` respectively) only because the
$0.25 entry gap cleared the `0.005` threshold — confirming the mechanism is real, even
though this specific live instance wasn't actually hidden. A new regression test
(`src/lib/swing/play-brief.test.ts`, "a same-ticker sibling with a near-identical entry
premium is still disclosed") pins the narrower failing case directly: same fixture, entry
premiums moved to within $0.0001 of each other — RED pre-fix (confirmed via `git stash`:
"must be disclosed... AssertionError, expected: true"), GREEN post-fix.

**Fix:** Prefer an exact `positionId` match as the self-test whenever both sides carry one.
The CommandDeck row-identity convention stamps `id: "${horizon}:${ticker}${positionId ?
`:${positionId}` : ""}"` (`banger-lane-merge.ts`'s own comment), so `ctx.play.id` carries the
reviewed position's real `positionId` as its third colon-segment for any row with a genuine
ledger position; `parseSwingPlayId` (already imported in this file, already used at
`play-brief.ts:~1125` for the same purpose in `bookContextSection`'s overlap call) recovers
it. When both the reviewed play and a lane row resolve a `positionId`, sibling-hood is now
decided by `r.positionId !== selfPositionId` — exact identity, not price proximity. Only
when either side lacks a resolvable `positionId` (the pre-existing, already-documented
banger-origin gap: `horizonPlayFromBangerPosition` never stamps `positionId` because banger
and swing ledger rows are separate DB sequences that can collide numerically) does the
function fall back to the original premium-proximity heuristic — unchanged behavior for that
case, so the existing 2026-09-11 banger-sibling-disclosure test (APPS/BAND/INSP/TWST) is
untouched and still passes.

**Fix rationale:** `positionId`-based matching is strictly more precise than a price-based
proxy whenever it's available, and costs nothing extra (no new fetch — `HorizonPlay` already
carries `positionId` on every lane row; `parseSwingPlayId` is pure and already in scope).
Deliberately NOT attempting to make `positionId` resolvable for banger rows here (same scope
line the original 2026-09-11 fix drew) — that needs a separate resolution branch against
`banger_positions` and risks cross-DB-sequence id collisions, out of scope for this fix.

**Blast radius:** `src/lib/swing/play-brief.ts`'s `siblingPositionsNote` only. No other
caller of this function; no change to `checkPortfolioOverlap`/`bookContextSection` (the
sibling overlap-and-concentration section), which already had its own, separate
`positionId`-based self-exclusion fix from the 2026-09-06 SWING-SYSTEM-CTO-AUDIT (finding
#10) — this fix brings `siblingPositionsNote` to the same standard of precision that
function already met.

**Regression guard:** `src/lib/swing/play-brief.test.ts` — new test pins the exact failure
mode (entry premiums within the old $0.005 self-test band, distinct `positionId`s, identical
contract) and verified RED pre-fix / GREEN post-fix via `git stash`. Full
`src/lib/swing/*.test.ts` suite: 1671/1671 pass post-fix. `npx tsc --noEmit`: clean.
