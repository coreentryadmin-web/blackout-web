## 2026-09-06 — [FINDING, Ask Largo / Night Hawk Swings, P2] technicalsCoaching echoed play direction instead of chart bias — FIXED

> **kind:** `FINDING`

### Symptom

Ask Largo's trade-manager **Chart read** bullet (`technicalsCoaching`) could label a SHORT play as
"supports short swing" while the same bullet body listed a bull EMA stack and above-VWAP spot — the
closing phrase echoed position direction instead of the technicals just narrated. The dedicated
**Chart technicals** intel section was already fixed (#4232 / FINDINGS #13) to use `technicalsBias()`,
but the parallel coaching bullet was not updated.

### Root cause

`technicalsCoaching()` in `play-brief-narrative-coaching.ts` derived its closing bias from
`play.direction` heuristics (LONG + ema up OR rsi < 65 → "supports long swing", etc.) instead of
calling the shared `technicalsBias()` majority vote used by `chartTechnicalsSection`. Violates Largo
contract **C5 (direction)**: evidence-based chart read must not be inferred from the play's own
LONG/SHORT label.

### Fix

Import `technicalsBias` and map its output to honest prose ("chart reads bullish/bearish/mixed chart
read"), with an optional alignment clause vs swing direction when chart bias and play direction agree
or conflict — never substituting position direction for chart evidence.

### Evidence

- Three regression tests in `play-brief-narrative-coaching.test.ts` (INTC SHORT+bull tape, NN
  LONG+bear tape, aligned LONG+bull).
- `npx tsx --test src/lib/swing/play-brief-narrative-coaching.test.ts`: pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
