## Thesis Health 'Signal stack' pillar silently truncated to 3 signal kinds, disagreeing with the same envelope's own score-pillar breakdown — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate live health-check cycle (Workflow deep-dive of
`GET /api/market/swing/play-brief` against real production OPEN positions).

**Root cause:** `signalScore()` in `src/lib/swing/thesis-health.ts` computes the aggregate "Signal
stack" pillar score correctly from ALL signal kinds (`hasFlow`/`hasVector`/`hasBanger`/`count>=3`),
but its displayed `label` was `[...set].slice(0, 3).join("+")` — an arbitrary cap at 3 kinds with
no "+N more" indicator. Any OPEN position with 4+ discovery-origin signal kinds (FLOW/STRUCTURE/
CATALYST/BANGER/VECTOR/POSITIONING) silently dropped one or more from the "Thesis health" section's
"Signal stack" bullet, while the same envelope's "Why this setup" section (which reads the frozen
score-pillar factors) correctly listed all of them — a direct, same-envelope disagreement about
which signals corroborate the setup.

**Evidence:** Live repro on CRWV:63 (a real OPEN position): the envelope's own `signalKinds`/
score-pillar data and "Why this setup" section both showed FLOW + STRUCTURE + CATALYST(+2.9pts) +
BANGER (4 kinds), but the SAME envelope's "Thesis health" section rendered "Signal stack —
FLOW+STRUCTURE+BANGER (Δ +0.0 pts)" — CATALYST silently dropped. Confirmed by directly reading the
source: `signalScore`'s label slice has no bound check against `count`, so any 4th-and-beyond kind
in Set iteration order never appears anywhere in the displayed label.

**Fix:** append "+N more" when the kind set exceeds 3, disclosing the truncation instead of hiding
it — the underlying score calculation is unchanged (it never depended on the label), so no scoring
behavior changes, only what's shown.

**Tests:** `src/lib/swing/thesis-health.test.ts` — added 2 tests: a 4-kind setup must show "+1 more"
in the signal-stack label (not silently drop CATALYST), and a 2-kind setup's label is unchanged
(no "+N more" when nothing was truncated). Full `thesis-health.test.ts` suite: 28/28 pass; `tsc
--noEmit` clean.

**Blast radius:** `thesis-health.ts` only — the score computation and every other pillar are
untouched.
