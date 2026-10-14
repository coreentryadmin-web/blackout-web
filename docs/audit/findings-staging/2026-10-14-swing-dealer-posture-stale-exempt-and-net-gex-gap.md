> **kind:** FINDING

## dealerPostureLine: fourth stale-exempt call site + false "folded into narrative" claim for net GEX/session change — FIXED

| **Status** | FIXED |
|---|---|

**Root cause (P1 — narrative contradiction).** `isSwingPlayStaleCheckExempt` (`entry-enterability.ts`)
was extracted 2026-10-07 after `dataFreshnessSection` (`play-brief-intel.ts`) was found asserting
Vector-pipeline staleness for a dead-but-not-closed WATCH play while the SAME envelope's
`confidence`/`unavailableSources` claimed every live source resolved cleanly (#5620). `degradedReadLine`
(`play-brief-narrative.ts`) was fixed the same way as a documented "third call site." `dealerPostureLine`
— a sibling function in the same file, reached whenever `spot != null` instead of `degradedReadLine`'s
`spot == null` branch — was never updated, making it an unflagged fourth call site. Live repro: SWING:AMD
(WATCH, `setupState: "EXTENDED"`, `entryStatus: "EXTENDED_CHASE"` — a dead watch per `deadPlayReason`),
spot resolved via the GEX-matrix fallback (Vector's own snapshot stale, GEX matrix fresh). The brief
rendered `"**Last snapshot** (~7209s old) — spot **570.18** · dealers **short gamma**..."` while the same
envelope's `confidence.why` read "Every live source this brief reads from resolved cleanly this cycle"
and `unavailableSources: []`.

**Root cause (P2 — false "folded in" claim).** PR #5998 (same day) fixed the VEX/DEX/CHARM regime-read
text being silently dropped when `collapseRedundantIntelSections` collapses "GEX posture" into a
"folded into Trade manager read above" note. The same audit pass found the note was STILL false for
`net_gex`'s own dollar figure and `change_pct` (underlying session %): `gexPostureSection`'s `Net GEX`
and `Underlying session` lines are real content inside the collapsed section, but `dealerPostureLine`
never narrated either — live repro on RKLB and GME (both WATCH/OPEN with a narrative present): the
default envelope said only "dealer gamma posture not resolved on this read" with the "folded into Trade
manager read" note attached, while `expandIntel=1` revealed the real hidden `Net GEX`/`Underlying
session` content.

**Evidence.** See the live AMD/RKLB/GME reproductions above, captured via the standing Ask Largo
deep-dive workflow this cycle (`GET /api/market/swing/play-brief` with and without `expandIntel=1`).

**Blast radius.** Single function — `dealerPostureLine`'s return string (the "Trade manager read"
dealer-posture bullet). No other section or consumer reads these fields differently.

**Fix.** (1) Threaded `bucket` into `dealerPostureLine` and gated the "Last snapshot" lead on
`bucket === "watch" && isSwingPlayStaleCheckExempt(ctx.play)`, matching `degradedReadLine`'s existing
gate exactly — a dead watch now reads "**Right now**" (nothing left to refresh, so no stale-snapshot
caveat to assert) instead of a contradicting staleness disclosure. (2) Appended `net_gex`'s dollar figure
and `change_pct` to the bullet, gated on the same `gexMatrixStale` check the VEX/DEX/CHARM fix uses.
Nearest-wall distance was deliberately NOT added — `collectFocalLevels`/`narrateWall` already narrate the
nearest call/put wall from the same vector-first/GEX-fallback precedence elsewhere in this section, so
that content is genuinely (if differently-framed) covered already.

**Fix rationale.** Same discipline as PR #5998: make the existing "folded into Trade manager read above"
claim true rather than carve a collapse-side exception. VEX/DEX/CHARM's raw `$` figures stay out of the
narrative (their regime-read text already carries the "what it means" signal); `net_gex` has no such
text elsewhere, so its number is the one genuinely still-missing fact.

**Tests.** `play-brief-narrative.test.ts` gained 4 tests: net-GEX-$/session-change% appear (fresh
matrix) and are suppressed (stale matrix); a dead-watch AMD-shaped repro asserting "Right now" instead
of "Last snapshot"; and a regression guard proving a genuinely live (non-exempt) WATCH play under the
identical Vector-stale/GEX-fresh shape still discloses "Last snapshot" (the exemption must not leak to
active candidates). RED→GREEN proven: `git stash` of the `route.ts`... `play-brief-narrative.ts` fix
dropped exactly 2 of 118 tests (the two new positive assertions — the staleness-suppression and
regression-guard tests pass vacuously either way, as expected for suppression/regression guards);
restoring the fix brought all 118 back to green. Also ran `play-brief-intel-collapse`/`play-brief-intel`/
`play-brief`/`entry-enterability` test suites (385 tests) clean. `tsc --noEmit` clean on Node 20.
