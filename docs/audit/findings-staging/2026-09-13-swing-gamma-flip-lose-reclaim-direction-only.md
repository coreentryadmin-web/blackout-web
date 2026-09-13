> **kind:** FINDING

## Ask Largo's gamma-flip "Lose"/"Reclaim" phrasing was chosen from trade direction alone, contradicting the brief's own dealer-regime line — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

Live repro, `GET /api/market/swing/play-brief?playId=SWING:COIN:WATCH` (2026-09-13): the brief's
"Watch levels" section read **"Lose gamma flip 183.49 — dealer posture turns against longs"** for
a LONG play whose spot (174.98) was already **well below** the flip (183.49) — a difference of
~4.6%. The SAME document's own "Why this setup"/Chart-technicals line, driven by the real,
independently-computed regime (`vec.regime.posture`), correctly reported **"Dealer gamma regime:
short gamma"** a few lines earlier — i.e. spot had already crossed through the flip into the
unfavorable regime. "Lose" a level you are already below is nonsensical: there is nothing left to
lose, the play needs to *reclaim* it.

Two call sites shared the identical bug — both picked the verb from `play.direction` alone, never
checking which side of the flip level `spot` actually sat on:

1. `play-brief-intel.ts`'s shared watch/open/closed "levels" section (`watchForSection`, ~line
   706): `play.direction === "LONG" ? "Lose gamma flip..." : "Reclaim gamma flip..."`.
2. `play-brief-narrative.ts`'s `narrateFlip` (Trade-manager-read's gamma-flip bullet, gated to
   only fire within 3% of the flip): the identical `play.direction === "LONG" ? "Lose..." :
   "Reclaim..."` pattern.

This is the **exact same bug class** already fixed once in this file for `narrateMaxPain` (live
RDDT repro, 2026-09-11, documented in that function's own comment) — pin gravity/dealer-posture
narration must read the actual computed regime/spot-vs-level relationship, not infer it from which
side the trader is betting on. `narrateFlip` — the function most directly *about* the gamma flip
level — had somehow kept the pre-fix pattern the sibling functions in the same file had already
moved away from.

### Fix

Both sites now compare `spot` to the flip level directly (the numbers are already validated
non-null at that point in both functions) before choosing the verb:

- LONG, spot above flip → "Lose ... dealer posture turns against longs" (unchanged, correct case).
- LONG, spot below flip → **"Reclaim ... needed to restore dealer support for longs"** (the fixed
  case, live COIN repro).
- SHORT, spot below flip → "Reclaim ... invalidates short thesis" (unchanged, correct case).
- SHORT, spot above flip → **"Lose ... needed to confirm the short thesis"** (the mirror fix).

### Blast radius

Two call sites, both in the swing Ask Largo play-brief lane: `watchForSection` (shared by the
WATCH-bucket "Watch levels" and OPEN-bucket "What to watch" section — the CLOSED-bucket branch was
already correctly neutral/informational and untouched) and `narrateFlip` (Trade-manager-read's
gamma-flip coaching bullet, watch/open buckets only). No gating/scoring logic touched — purely a
narrative-text correctness fix.

### Fix rationale

Mirrored the existing, already-proven fix pattern from `narrateMaxPain`/`narrateKing`/
`narrateMagnet` in the same file (compare the real number, don't infer from trade direction)
rather than inventing a new approach — this is a recurring bug SHAPE in this lane (the gamma-flip
function is simply the one instance that was missed when the others were fixed), so the fix
follows the same convention future call sites should also follow.

### Evidence of testing

- Live screenshot/API evidence: `GET /api/market/swing/play-brief?playId=SWING:COIN:WATCH` on
  production, cross-checked against the same envelope's own "Dealer gamma regime: short gamma"
  line and Chart-technicals spot (174.98) vs the Watch-levels flip figure (183.49).
- New tests, 4 total (2 per file) covering all four `(direction × spot-side)` combinations —
  `play-brief-intel.test.ts` (`watchForSection`) and `play-brief-narrative.test.ts`
  (`tradeManagerNarrativeSection`'s gamma-flip bullet). The two previously-correct combinations
  (LONG+above, SHORT+below) are pinned as non-regressions; the two previously-wrong combinations
  (LONG+below — the live COIN repro, SHORT+above — the mirror case) are pinned as the fix.
- RED confirmed: stashing only the two source files (keeping the new tests) reproduced exactly the
  4 expected failures, the 2 unchanged-behavior tests in each file staying green throughout.
- GREEN: fix restored, 185/185 pass across both files combined (previously 117 + prior narrative
  count, +4 new + 1 pre-existing test count correction — see PR for exact numbers).
- Full `src/lib/swing/*.test.ts`: 1076/1076 pass.
- `npx tsc --noEmit`: clean.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, live COIN
WATCH play-brief pull, 2026-09-13 — a deep-audit pass reading the full envelope against
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s cross-section-consistency expectations (a document should
never contradict itself about the same fact — here, dealer gamma regime). Swing-lane-local,
narrative-text correctness only — no cross-desk sign-off needed under the standing CARVE-OUT
discipline.
