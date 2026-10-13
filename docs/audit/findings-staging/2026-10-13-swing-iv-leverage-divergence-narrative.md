## 2026-10-13 — [FINDING, P3 product-enhancement, Ask Largo / Night Hawk Swings] Play-brief never connected a steep option P&L to the underlying's own (much milder) move — leverage/IV read left to the member to infer — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| `src/lib/swing/play-brief-narrative-coaching.ts` (Ask Largo swing play-brief, Trade manager read) | P3 — trader-clarity gap, no gate/logic change | FIXED — `ivLeverageDivergenceCoaching`, wired into `collectCoachingBullets` |

**What's wrong.** Raised by a prior Ask Largo deep-audit session as a live-repro enhancement idea
(PR #4076 comment 6130751739, unanswered by Cursor for 7.5+ hours before this session picked it
up): a live-audited OPEN position, `SWING:ASTS:53` (2026-10-12), showed an underlying adverse
excursion of only **-2.6%** while the option's own P&L sat at **-23%** — `Greeks` showed `IV 75%`,
`θ -0.13/day` in the same brief. The narrative (`play-brief-narrative.ts`'s trade-manager section)
already does life-of-trade storytelling well (e.g. the existing "Round-tripped past breakeven"
line), but nowhere did it connect **P&L magnitude to the underlying's actual move** — a member
reading "-23%" next to a barely-moved underlying has to infer leverage/IV decay themselves, with a
real risk of misreading a sharp option loss as a broken thesis when the underlying itself never
confirmed that.

**Root cause / why it wasn't already covered.** Both halves of the comparison were independently
wired but never joined:
- `play.underlyingExcursion` (`{ mfePct, maePct }`, `manage-sync.ts`'s `signedExcursionPct`,
  direction-aware, persisted every management tick) was already read once, in
  `play-brief.ts`'s Management section ("Underlying excursion since entry: X% favorable / Y%
  adverse") — but only as a bare fact, never compared against anything.
- `play.greeks` (`iv`/`theta`/...) was already read in the Position section's "Greeks:" line —
  also a bare fact.
- A PRIOR attempt at roughly this idea, `underlyingExcursionCoaching`, was dead-code-removed
  2026-09-15 (see the doc comment directly above `collectCoachingBullets` in the same file) — but
  that function read `play.stockMovePct`/`stockPeakPct`/`stockTroughPct`, fields written in exactly
  one place repo-wide (`use-legacy-quotes.ts`, a Legacy-only client hook) and never populated for
  swing/LEAPS, so it was structurally dead on arrival for this lane. Its one live-computable
  remainder was a premium-only round-trip aside already shipped elsewhere
  (`mfeCaptureOutcome(play.pnlPct, play.peak, null)`) — genuinely nothing like the
  underlying-vs-option comparison requested here. That removal is likely why this specific gap
  (comparing `pnlPct` against `underlyingExcursion`, not `stockMovePct`) was never attempted before.

**Fix.** New pure coaching function `ivLeverageDivergenceCoaching(play, bucket)`
(`play-brief-narrative-coaching.ts`), wired into `collectCoachingBullets` right after
`troughResilienceCoaching` (both OPEN-only, premium-behavior bullets). Matches the current P&L's
sign to the correct excursion figure (`mfePct` for a gain, `maePct` for a loss — both already
direction-adjusted by `signedExcursionPct`), reads `play.greeks.iv`/`.theta`, and fires a line
naming both numbers plus IV/theta, attributing the gap to leverage/IV rather than a thesis
event — e.g. *"Option down more than the stock's own move would suggest — -23.0% on the option vs
-2.6% on the underlying; IV **75%** · θ -0.13/day — leverage/IV, not a thesis break."* Symmetric on
the gain side (a big winner far outrunning the underlying's own favorable move gets the same
framing, "leverage/IV, not extra thesis confirmation" — avoids overclaiming a bigger thesis
confirmation than the underlying itself actually delivered).

**Gating (deliberately conservative, both floors required):**
- Materiality floor: `|pnlPct| >= 15` — a routine few-point wiggle never fires this.
- Ratio floor: the option move must be at least 3x the matching-direction underlying move (that
  underlying move floored at 1pt so a near-zero denominator can't produce a meaningless ratio) — a
  position where premium and underlying moved roughly in proportion needs no special explanation,
  that's just delta working normally.
- Honest-null on any missing input (`pnlPct`, `underlyingExcursion`, or `greeks.iv`) — never a
  fabricated comparison. OPEN-bucket only: WATCH has no P&L yet, and CLOSED already gets the
  round-trip/giveback aside (a premium-only comparison this is deliberately distinct from, not a
  duplicate).

**Evidence.** 7 new regression tests in `play-brief-narrative-coaching.test.ts` covering: the live
ASTS-shaped repro (fires, names both percentages + IV + theta), the symmetric gain case, the ratio
floor (silent on a proportional 2x move), the materiality floor (silent on a routine small move
even at a 10x ratio), the near-zero-underlying-move denominator clamp (still fires once materiality
clears), honest-null on each missing input individually, and OPEN-only scoping. `npx tsx
--experimental-test-module-mocks --test src/lib/swing/play-brief-narrative-coaching.test.ts`: 163/163
pass (including the 7 new ones). Broader regression sweep
(`play-brief.test.ts`/`play-brief-intel.test.ts`/`play-brief-narrative.test.ts`/`play-brief-diff.test.ts`):
496/496 pass — the new bullet's MAX_BULLETS-budget interaction doesn't break any existing fixture's
exact-output assertions. `tsc --noEmit`: clean. Full `npm test`: see PR for the run confirming
0 regressions repo-wide.

**Blast radius.** Single new call site in `collectCoachingBullets`; no other consumer of
`play.underlyingExcursion` or `play.greeks` touched. No gate, score, or exit-management logic
changed — purely an additive narrative bullet, per the original ask's own stated boundary.

**Collaboration note.** The original ask (PR #4076 comment 6130751739) explicitly flagged wanting
"a second read" before shipping onto a live-position-facing surface and asked Cursor for a
go/no-go. No response arrived after 7.5+ hours of waiting across multiple check-ins (per the
standing "track open asks, follow up each cycle" discipline) — implemented independently per the
Ask Largo ownership mandate's "drive this automatically and autonomously" instruction and the
standing "NEVER SIT IDLE" policy, staying strictly inside the boundary the original ask itself
drew (no gate/stop logic touched, additive sentence only, same pattern as the existing
giveback/round-trip line). Flagged back on the #4076 thread for visibility.
