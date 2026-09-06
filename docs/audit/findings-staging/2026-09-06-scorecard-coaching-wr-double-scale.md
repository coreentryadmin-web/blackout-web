## 2026-09-06 — [FINDING, Ask Largo / Night Hawk Swings, P2] scorecardCoaching double-scaled win rate — FIXED

> **kind:** `FINDING`

### Symptom

When conviction-bucket scorecards are wired server-side into swing play briefs, `scorecardCoaching()` would render **6300% WR** instead of **63% WR** — `winRate`/`ciLow`/`ciHigh` are already stored as 0–100 percent points (same shape as `containers.tsx` conviction overlay and `adapters.test.ts` fixtures), but the coaching helper multiplied by 100 again.

### Root cause

`scorecardCoaching()` in `play-brief-narrative-coaching.ts` assumed fractional 0–1 rates (`sc.winRate * 100`) while `TerminalPlay.scorecard.winRate` is percent points throughout the Night Hawk deck.

### Fix

Use `Math.round(sc.winRate)` directly; same for CI bounds. Latent today because server-side brief resolution does not yet attach scorecards — fix before wiring C10 historical context.

### Evidence

- Regression test in `play-brief-narrative-coaching.test.ts` asserts 63% not 6300%.
- `npx tsx --test src/lib/swing/play-brief-narrative-coaching.test.ts` — pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
