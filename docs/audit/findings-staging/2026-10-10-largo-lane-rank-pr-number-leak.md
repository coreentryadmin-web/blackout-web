## 2026-10-10 — [FINDING, P3 Ask Largo / Night Hawk Swings] Lane rank narrative leaked an internal PR number ("pending #5577 wiring") into member-facing trade-manager copy — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Scope** | `src/lib/swing/play-brief-lane-rank.ts`, `src/lib/swing/play-brief-narrative-coaching.ts` |

**Symptom:** Live-pulled a WATCH-bucket swing play-brief today (`GET /api/market/swing/play-brief?playId=SWING:MRVL&ticker=MRVL&status=WATCH`) as part of the standing Ask Largo deep-dive mandate. The "Lane rank" section's trade-manager narrative read:

> Desk leader: **VST** @ **76** — structurally blocked from committing (pending #5577 wiring, not a live gate)

A member reading this has no way to know "#5577" is an internal GitHub PR number, and — worse — PR #5577 ("fix(swing): graduation bridge for Legacy-promoted theses into the real commit pipeline") already **merged on 2026-10-07**, three days before this read. The caveat's own code comment (written 2026-10-08, i.e. *after* #5577 merged) explains the real situation: #5577 shipped and tested the graduation-bridge fix, but the wiring that would actually *call* it into the live commit path was never connected — so the underlying "VST can't commit" fact is still true today (re-confirmed live: VST's horizons row still carries `commitGateBlockedBy: ["legacy:exempt"]`), but the PR-number reference itself is stale-reading (a merged PR described as "pending") and inappropriate for end-user copy regardless of its merge state — it's an internal engineering/ticket reference, not something a paying trader should ever see in a trade-manager narrative. The same string appeared twice: once in `laneRankSection`'s structured section body, once in `laneRankCoaching`'s folded narrative line (`play-brief-narrative-coaching.ts`), plus a regression test that asserted the exact string.

**Root cause:** When the 2026-10-08 fix (found live via GOOGL's brief naming a leader, VST, that could never actually commit) added a disclosure caveat, it described the blocking mechanism by citing the PR number that shipped (but didn't wire up) the relevant fix, rather than describing the situation in end-user language. This is exactly the "narrative reads like a bullet-dump of engineering notes instead of a trade manager" failure class the standing Ask Largo mandate asks every cycle to hunt for — it wasn't a logic bug (the caveat correctly fires only when `topLegacyExemptOnly` is true, narrowly gated per its own doc comment), just leaked internal-facing text in a member-facing surface.

**Fix:** Replaced the PR-number reference in both rendered strings with plain end-user language that preserves the same honest disclosure ("this is a platform limitation, not a real trading gate — don't read the named leader as a signal to act on"), without naming an internal ticket:
- `play-brief-lane-rank.ts`: `" — structurally blocked from committing (pending #5577 wiring, not a live gate)"` → `" — structurally blocked from committing (a platform wiring gap, not a live gate)"`
- `play-brief-narrative-coaching.ts`: `" (structurally blocked from committing — pending #5577 wiring, not a live gate)"` → `" (structurally blocked from committing — a platform wiring gap, not a live gate)"`
- Updated the one test assertion that matched the old literal string (`play-brief-narrative-coaching.test.ts`); `computeLaneRank`'s own tests only assert the `topLegacyExemptOnly` boolean, not the rendered string, so they were untouched.
- Left the surrounding **code comments** referencing `#5577` as-is — those are for engineers reading the source, not members reading the product, and they accurately record the real history (shipped-but-unwired).

**Deliberately left unchanged:** the underlying `topLegacyExemptOnly` gating logic and the fact that VST (or whichever ticker trips this) is still genuinely blocked from committing — that's a separate, already-tracked plumbing gap (the #5577 wiring itself), not something this fix touches. This fix is scoped to the user-facing wording only.

**Evidence:** `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative-coaching.test.ts` (156/156 pass) and `src/lib/swing/play-brief-lane-rank.test.ts` (31/31 pass) after the change; `npx tsc --noEmit` clean. Confirmed via GitHub API that PR #5577 merged 2026-10-07T01:07:46Z (three days before this string was still being served live), and confirmed live that VST's horizons row still carries `commitGateBlockedBy: ["legacy:exempt"]` today, so the disclosure's underlying fact remains accurate — only the internal-reference wording was wrong.
