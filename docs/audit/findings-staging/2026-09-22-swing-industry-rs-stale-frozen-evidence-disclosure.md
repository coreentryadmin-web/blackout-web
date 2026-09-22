> **kind:** FINDING

## Swing "Why this setup" repeated a pre-#5446 Industry-read claim on already-committed positions — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — `src/lib/swing/play-brief-intel.ts` (`whyThisSetupSection`) |
| **Severity** | P2 — a live, disclosed follow-on of #5446 (frozen decision evidence continuing to display a claim now known false) |
| **Status** | FIXED |
| **Found via** | Live re-verification of the #5446 fix on HUT:41's play-brief, ~40 minutes post-merge; escalated to #4076 (comment 5783714615), option chosen per collaborator response (comment 5783742597) |

### Root cause

#5446 (merged 2026-09-22T20:08:01Z) fixed `industry-group-rs.ts`'s `resolveGroupBenchmark` so a
crypto-equity name (theme `"crypto-equity"` via `portfolio/sector-map.ts`'s `sectorFor()`) never
mechanically resolves a SIC/label-derived sector ETF (e.g. HUT's real Polygon SIC 6199 "FINANCE
SERVICES" → Financials/XLF). The fix is correct and verified live in code.

But `sectorLeadershipFacts` (the facts behind `whyThisSetupSection`'s "Industry read" line and the
"Rel. strength" score pillar) is computed once into the `SwingDossier` at commit/discovery time and
pinned — nothing in `active-refresh.ts` (the live-price/manage-state refresh cron) or the play-brief
read path re-runs `buildSwingDossier`/`resolveGroupBenchmark` for an already-committed position. Live
re-check of HUT:41 (committed BEFORE #5446 shipped) ~40 minutes after the fix merged: the brief still
read *"leading Financials (XLF) by 10.7% over 10 sessions"* in a section literally titled "Why this
setup" — a claim #5446 itself proved false for this exact ticker/theme.

### Why this wasn't folded into #5446 directly

Genuine design tension, escalated to #4076 rather than picked unilaterally: rewriting the frozen
`sectorLeadershipFacts` live at brief-read time would let score-pillar totals drift after commit for
reasons unrelated to the actual commit decision — breaking the same "grade against what was actually
known at commit time" principle the calibration/track-record machinery elsewhere in this engine
already depends on. A collaborating session (comment 5783742597) recommended the narrower fix below
rather than a general live-re-derive.

### Fix

`whyThisSetupSection` now checks the EXACT, narrow bug signature #5446 fixed — `sectorFor(play.ticker)`
resolves to a theme in `NO_SECTOR_BENCHMARK_THEMES` (now exported from `industry-group-rs.ts`) AND the
frozen `sectorLeadershipFacts` still carries a benchmark. When both hold, the line is replaced with
*"sector benchmark evidence recorded before a classification fix — historical score unaffected"*
instead of repeating the pre-fix claim. Every other case (including a legitimate, still-accurate
industry read like NVDA vs SMH) is untouched.

This mirrors the `statusBucket(play)==="closed"` disclosure pattern already shipped in
`flowIntelSection` (#5444, "not what this trade traded under") — same "disclose, don't silently
rewrite" shape, gated on a different, narrower condition. Does NOT touch `active-refresh.ts`, the
dossier's freeze semantics, or the score-pillar point totals — the historical score stays exactly what
it was at commit, only the now-known-stale prose claim is caveated.

### Evidence

- RED→GREEN: `play-brief-intel.test.ts` — new test proves the HUT/crypto-equity case rendered
  "leading Financials (XLF)..." pre-fix (git-stash isolated), the caveat post-fix; a sibling test proves
  a legitimate industry read (NVDA vs SMH) is completely unaffected.
- `npx tsc --noEmit` — clean.
- Collateral suite green: `play-brief-intel.test.ts` (198/198), `industry-group-rs.test.ts` (13/13),
  `play-brief.test.ts` + `play-brief-intel-collapse.test.ts` (119/119 combined).

### What was deliberately left unchanged

- `active-refresh.ts` / the dossier's commit-time freeze semantics — per the collaborator discussion,
  live-re-deriving the whole dossier would widen scope well past this bug and reopen a separate,
  larger "should any of the rest of the dossier be live" question.
- The score-pillar point totals themselves (`factors` array, "Rel. strength — +35 pts") — still shown
  as-was, since they're the historical record of what actually got the play committed; only the prose
  claim naming a specific (now-known-wrong) benchmark is caveated.
