> **kind:** `FINDING`

## Trade manager read badge echoed position direction instead of chart technicals — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (Largo C5 direction — narrative badge contradicts chart evidence) |
| **Area** | Night Hawk Swings — Ask Largo `tradeManagerNarrativeSection` |
| **PR** | (pending) |

### Symptom

`tradeManagerNarrativeSection` set section `bias` from `play.direction` (SHORT → bearish, LONG → bullish).
`chartTechnicalsSection` was already fixed (#4232) to use a majority vote on EMA/MACD/VWAP/structure.
A SHORT play with an entirely bullish tape therefore showed **bullish** on Chart technicals but **bearish**
on Trade manager read — the primary narrative section mislabeled the evidence.

### Fix

Extract shared `technicalsBias()` to `play-brief-technicals.ts`; both `chartTechnicalsSection` and
`tradeManagerNarrativeSection` use the same majority vote. Fall back to `neutral` when technicals absent.

### Evidence (RED → GREEN)

2 new tests in `play-brief-narrative.test.ts` mirror the #13 chart-technicals cases. Full swing suite green.
