> **kind:** FINDING

## Ask Largo truncation probe never covered `get_swing_play_brief` — COVERAGE FIXED

| **Status** | FIXED (probe coverage gap closed; no active truncation found) |
|---|---|
| **Severity** | P3 — tooling coverage gap, not a live product defect |
| **Found by** | Ask Largo × Night Hawk Swings standing deep-dive mandate (2026-10-19) |

### Root cause

`scripts/audit/largo-truncation-probe.mjs` exists to catch exactly one class of bug: a Largo tool
whose payload "works" (the call succeeds, the loop completes) while `anthropicToolLoop`'s
`MAX_TOOL_RESULT_CHARS` cap (16,000 chars, head-kept/tail-dropped) silently cuts the JSON handed
back to the model. Three real Night Hawk bugs shipped exactly this way before the probe existed
(`get_zerodte_record` delivered 1.5% of itself, `get_nighthawk_edition` cut every play,
`get_nighthawk_outcomes` quoted a wrong win rate from a truncated window).

The probe's own `LANE_TOOLS` comment for the swing lane claimed: *"Night Hawk Swings' only real
tool... there is no second swing tool to probe."* That was true when written (2026-08-23/
2026-09-09 cleanup of the phantom `get_swing_discovery` entry) but went stale the moment
`get_swing_play_brief` shipped (2026-09-12, `src/lib/largo/swing-play-brief-read.ts` — see that
file's own header on why it was added: `composeSwingPlayBrief` was previously reachable only from
the Command Deck UI route, never from a live Largo chat answer). Nothing re-checked the comment's
claim against the tool registry when the new tool landed, so the probe silently stopped covering
roughly half of Largo's swing surface area.

This matters more than an ordinary coverage gap because of a second, related fact found while
tracing it: `get_swing_play_brief`'s dispatch in `src/lib/largo/run-tool.ts` (`case
"get_swing_play_brief"`) applies **no shaping/compaction step** before returning —
`swingPlayBriefForLargo` hands back `composeSwingPlayBrief`'s raw object verbatim
(`roundFloats({ available: true, ...brief })`, no reordering, no truncation-aware field ordering).
Contrast `get_nighthawk_edition`, whose case routes through `compactNightHawkEditionForModel`
specifically because a raw edition object put `market_recap` before `plays` and the tail-cut ate
every play. The swing play-brief is the richest single-position Largo surface in the repo (per the
previous round of this same mandate: 7 narrative/intel sections that can each run to several
hundred characters of trade-manager prose, plus book context, track record, meridian catalysts,
roll history) — exactly the shape of payload the other three bugs came from. Nobody had asked
whether it is actually at risk, including the probe that exists to ask that question.

### Evidence

- `grep -c "title:" src/lib/swing/play-brief-intel.ts` → 26 titled sections across the full
  composition surface (play-brief.ts + play-brief-intel.ts + play-brief-narrative*.ts).
- Measured (not guessed) via a standalone script invoking `composeSwingPlayBrief` directly with a
  maximally-populated OPEN-position context (meridian catalyst + peer lens, graduated archetype
  track record, ticker history, 2-roll history, trade-manager narrative, 11 of ~24 possible
  sections rendering with no errors): serialized result is **9,382 characters** against the
  **16,000-char cap** — 59%, with real headroom even before accounting for sections this fixture
  didn't trigger (Book context needs a real theme/direction portfolio overlap via
  `checkPortfolioOverlap`, not just any sibling position — correctly did not fire here).
- `src/lib/largo/run-tool.ts`'s `get_swing_play_brief` case (confirmed by reading): no
  compaction/fit call, unlike `get_nighthawk_edition`'s case two cases above it.
- `scripts/audit/largo-truncation-probe.test.ts`'s own guard (`every LANE_TOOLS entry... names a
  real, currently-defined Largo tool`) passes with the new entry added — `get_swing_play_brief` is
  confirmed present in `LARGO_TOOL_DEFS` (`src/lib/largo/tool-defs.ts`).

### Fix

Added `["get_swing_play_brief", "ticker NVDA"]` to `LANE_TOOLS` in
`scripts/audit/largo-truncation-probe.mjs`, and corrected the stale "no second swing tool to
probe" comment to describe what actually changed and why the new entry exists, including the
by-inspection size measurement above so a future reader doesn't have to re-derive it. `npx tsc
--noEmit` clean; `largo-truncation-probe.test.ts` (the existing phantom-tool-name guard) passes
2/2 with the new entry in place.

### What this fix does NOT do, and why

Does not add a `compactSwingPlayBriefForModel`-style shaping step to `run-tool.ts`'s
`get_swing_play_brief` case. The measured evidence (9,382/16,000 chars on a deliberately rich
fixture) shows this is not currently an active truncation bug — adding a fitting layer for a risk
that isn't materializing would be the same mistake this repo's own performance-mandate discipline
explicitly warns against (`CLAUDE.md`: "do not add an overlap guard... to a cron/route that is not
actually measured to be at risk — check its own numbers first, every time"). What this fix actually
buys is that the probe will now ACTUALLY WATCH this tool going forward: the next live
`node --import tsx scripts/audit/largo-truncation-probe.mjs` run exercises it, and if a future
change to the swing play-brief (more sections, richer book-context prose, more sibling positions)
pushes a real position over the cap, this probe — not another live-model misreport — is what
catches it.
