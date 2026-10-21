## dealerPostureLine's "Last snapshot" caption ages itself off Vector even when the rendered content is entirely GEX-sourced — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate — a Workflow-based deep-dive (live-fetched real
swing play-brief envelopes across WATCH/OPEN/CLOSED buckets, then an adversarial verify pass before
acting) focused specifically on the "Dealer & dark-pool read" narrative section, not yet audited
this session.

**Root cause:** `dealerPostureLine` (`src/lib/swing/play-brief-narrative.ts`) renders a bullet
blending two possible data sources — Vector (preferred when fresh) and a GEX-matrix fallback (used
whenever Vector is stale). Every individual field it renders already requires its OWN source to be
non-stale before it's allowed to appear: `resolveGammaPosture` only falls through to
`gex.gamma_posture` when `!gexMatrixStale`; `flip` only uses the GEX fallback when
`!gexMatrixStale`; and `fragileBit`/`regimeBits`/`netGexBit`/`sessionChangeBit` are all explicitly
gated on `!gexStale`. The same vector-then-GEX-fallback pattern also resolves `spot` itself, in the
caller (`tradeManagerNarrativeSection`). The consequence: **whenever Vector is stale and the
function still resolves content at all, every value just rendered is necessarily GEX-sourced and
GEX-fresh** — resolveGammaPosture's own fallback branch requires it.

Despite this, the bullet's "Last snapshot (~Ns old)" caption was computed purely from
`vectorStale`/`vec?.dataAgeMs` — Vector's own (much older, irrelevant) age — rather than from
whichever source actually fed the content on screen. The sibling function `gexPostureSection`
(`play-brief-intel.ts`) already gets this right, captioning its own "Last snapshot" bit via
`ageSecondsLabel(gexMatrixAgeMs(gex, readMs))`; `dealerPostureLine` never adopted the same pattern.

**Evidence:** Live `GET /api/market/swing/play-brief` for TSLA (WATCH bucket): "Trade manager read"
rendered `**Last snapshot** (~10659s old) — spot **380.45** · dealers **long gamma** ... γ-flip
**379.17** ... net GEX **422.1M** · session **+1.8%**`. The SAME envelope's `evidence[]` array
attributes that identical GEX reading to `source:"GEX"`, `freshness:"recent"`, computed **80
seconds** ago — a ~133x discrepancy between the age shown and the age of the data actually
displayed. The envelope's own "Data freshness" section correctly scopes the 10659s figure to
Vector only ("Vector data 10659s old — levels may lag live spot"), never to the GEX-sourced
dealer-posture numbers — confirming the Vector age genuinely has nothing to do with this content.

**Fix:** `src/lib/swing/play-brief-narrative.ts` — when `snapshotStale` is true (which only happens
when `vectorStale` is true, meaning content is GEX-sourced by the proof above), caption with
`ageSecondsLabel(gexMatrixAgeMs(gex, readMs))` instead of `ageSecondsLabel(vec?.dataAgeMs)`. One
import added (`gexMatrixAgeMs` from `./play-brief-absence`, already used elsewhere in this file).
No change to *whether* the caption shows ("Last snapshot" vs "Right now" — still
`vectorStale && !staleCheckExempt`), only to *which age* it reports.

**Tests:** `src/lib/swing/play-brief-narrative.test.ts` —
- Corrected a pre-existing test ("stale Vector with live GEX fallback uses Last snapshot lead")
  whose assertion (`/180s old/i`, Vector's own `dataAgeMs`) had encoded the exact bug; now asserts
  the correct `/30s old/i` (GEX's `matrix_age_sec`) and that `/180s old/i` no longer appears.
- Re-scoped the "future-skewed ... Infinity" clock-skew guard test to exercise GEX's own age field
  (a small, in-tolerance future skew, `matrix_age_sec: -2`) rather than Vector's — the field this
  caption actually sources from post-fix — while confirming content isn't suppressed as stale.
- Added a new dedicated regression test mirroring the live TSLA repro (Vector 10,659s stale vs GEX
  80s fresh — ages deliberately ~133x apart so a regression fails loudly, not by rounding
  coincidence): asserts the caption shows GEX's 80s age and never Vector's 10659s age.
- RED→GREEN proven via `git stash` on the source file alone (2 fail / 139 pass without the fix,
  141/141 with it). Full `play-brief-narrative.test.ts` suite: 141/141 pass; `tsc --noEmit` clean.

**Blast radius:** `play-brief-narrative.ts`'s `dealerPostureLine` only — the one caption-age
computation. No other call site reads this function's return value differently; no scoring/gating
logic touched (purely a display/disclosure fix, matching this repo's established Largo C2
"freshness must caption its actual source" precedent already applied to `gexPostureSection` and
several other sibling sections).
