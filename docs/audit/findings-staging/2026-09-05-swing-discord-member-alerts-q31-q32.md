# 2026-09-05 — Swing member Discord alerts (deep-dive Q31–Q32)

## Problem

Swing's capital-preservation path (`closeAndRollSwingPosition` via `swing-active-refresh`) could
terminate or roll real-money positions with zero member-visible signal. 0DTE and Legacy already
post BTO/STC embeds through the Chief Trade Alert Bot; Swing had no equivalent subsystem.

## Fix

- `src/lib/swing/discord-trade-notify.ts` — env-gated (`SWING_DISCORD_ALERTS`) BTO/STC via shared
  `postChiefTrade`, with optional `SWING_CHIEF_TRADE_CHANNEL_ID` routing.
- `executeSwingCommits` — fire-and-forget BTO on fresh real-money open.
- `swing-active-refresh` — fire-and-forget STC on CLOSE; STC parent + BTO child on ROLL.
- `fetchSwingPositionById` — load roll child row for child-leg BTO payload.

## Ops

Set `SWING_DISCORD_ALERTS=1` and `SWING_CHIEF_TRADE_CHANNEL_ID` in production alongside existing
`CHIEF_TRADE_BOT_URL` / `CHIEF_TRADE_API_SECRET`. Default off — opt-in parity with 0DTE/Legacy.

## Verification

```bash
npx tsx --test src/lib/swing/discord-trade-notify.test.ts
npx tsc --noEmit
```
