# 2026-09-05 — Banger member Discord alerts (deep-dive Q32 sibling)

## Problem

Q32 flagged zero member-visible notification plumbing for both Swing and Banger while 0DTE and
Legacy already post BTO/STC through the Chief Trade Alert Bot. Swing was addressed in #3903;
Banger (Engine B) still had no Discord path on commit or scale-out exits.

## Fix

- `src/lib/banger/discord-trade-notify.ts` — env-gated (`BANGER_DISCORD_ALERTS`) BTO/STC via shared
  `postChiefTrade`, with optional `BANGER_CHIEF_TRADE_CHANNEL_ID` routing.
- `runBangerCommit` — fire-and-forget BTO on fresh real-money open.
- `runBangerLiveSync` — fire-and-forget partial STC on `TAKE_PARTIAL`; terminal STC on
  `EXIT_RUNNER` / `STOP_OUT`.

## Ops

Set `BANGER_DISCORD_ALERTS=1` and `BANGER_CHIEF_TRADE_CHANNEL_ID` in production alongside existing
`CHIEF_TRADE_BOT_URL` / `CHIEF_TRADE_API_SECRET`. Default off — opt-in parity with other desks.

## Verification

```bash
npx tsx --test src/lib/banger/discord-trade-notify.test.ts
npx tsx --test src/lib/banger/live-sync.test.ts src/lib/banger/commit.test.ts
npx tsc --noEmit
```
