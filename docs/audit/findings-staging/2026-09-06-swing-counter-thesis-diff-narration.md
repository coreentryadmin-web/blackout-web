> **kind:** FINDING

## Swing Ask Largo — counter-thesis + trade-manager diff narration — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **PR** | (this PR) |
| **Area** | Night Hawk Swings / Ask Largo |

### What was missing

Per `CLAUDE.md` Ask Largo mandate, two scoped gaps remained on `main` after #4101:
1. **Counter-thesis** — the brief never steelmanned the opposing case; traders only saw bullish coaching on LONG rows.
2. **What-changed diff** — `diffBriefSnapshots` emitted raw numeric deltas (`Thesis health 60% → 54%`) instead of trade-manager coaching voice.

### Fix

- `counterThesisLine()` in `play-brief-narrative.ts` — deterministic bear/bull risks from HELIX flow, NH/0DTE stance, overhead/below walls, EMA stack, dealer gamma posture, fading pillars.
- `narrateThesisShift` / `narratePnlShift` / `narrateSpotShift` in `play-brief-diff.ts` — coaching-voice refresh deltas.

### Validate at RTH

Open a swing play on Night Hawk → Ask Largo panel → refresh twice during RTH; confirm "What changed" uses coaching language and Trade manager read shows "Counter-thesis" when desks disagree.
