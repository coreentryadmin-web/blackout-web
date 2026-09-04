# Swing Command — Unified Multi-Session Desk (2026-09-04)

## Problem

Night Hawk shipped **four parallel surfaces** for multi-day options:

| Surface | What it actually was | Member pain |
|---------|---------------------|-------------|
| **Swings** | Thesis engine + `swing_positions` ledger + CommandDeck (partial) | No live marks SSE, weaker right-rail vs 0DTE |
| **Bangers** | Engine B breakout screen + `banger_positions` + simple list UI | Not integrated with swing thesis; separate tab nobody used as entry/exit |
| **Vector** | Chart desk + `vector_pick_leaders` audit log | Signals only — no OPEN/HOLD/TRIM lifecycle |
| **0DTE** | Full Command Deck (reference UX) | Different product (same-day exit) |

Members had to learn three UIs for overlapping holds (4–15 DTE weeklies) and none of Bangers/Vector behaved like a real playbook.

## Decision

**One Swing Command lane** on the existing horizon spine:

- **DTE window:** `5–15` on the spine (`HORIZONS.SWING`; 4-DTE weeklies remain on 0DTE for same-day discipline).
- **Exit:** `SCALE_OUT` (`src/lib/zerodte/scale-out.ts`) — unchanged.
- **Ledger:** `swing_positions` remains canonical; **open `banger_positions` fold in** as MANAGING/SCALING_OUT rows with `BANGER` origin.
- **Vector:** **enrichment only** — recent `vector_pick_leaders` stamp `VECTOR` on matching tickers (no second ledger).
- **UI:** Same **CommandDeck + ZeroDteCommandPanel** as 0DTE (single scroll panel, trim ladder, thesis health when wired).
- **Nav:** Night Hawk toggle is **0DTE · Swings · Legacy**. `?view=banger` / `?view=vector` aliases resolve to Swings.

## Architecture

```
NightHawkFeed (view=SWING)
  └─ HorizonDeck / SwingCommandDeck
       └─ GET /api/market/nighthawk/horizons?view=swings
            └─ getSwingServingLane()
                 ├─ discoverSwingFromPersisted (organic thesis)
                 ├─ fetchOpenSwingPositions (live sections)
                 ├─ fetchBangerBoardRows (Engine B merge)
                 └─ fetchVectorPickLeaderRows (corroboration)
```

Key modules:

- `src/lib/horizons.ts` — `SWING_MAX_DTE = 15`
- `src/lib/swing/banger-lane-merge.ts` — banger → `HorizonPlay`
- `src/lib/swing/vector-lane-enrich.ts` — Vector signalKinds
- `src/lib/swing/serving-lane.ts` — assembly seam
- `src/features/nighthawk/command-deck/PlayTerminal.tsx` — SWING uses `ZeroDteCommandPanel`

## Sub-lanes (post-narrow)

| Sub-lane | DTE | Notes |
|----------|-----|-------|
| TACTICAL | 5–7 | Fast theta, minute grader |
| STANDARD | 8–15 | Default swing |
| EXTENDED | *(retired)* | Type kept for historical rows; not in `SWING_SUB_LANES_ORDER` |

## Remaining P0/P1 (from swing backlog)

1. ~~**Frozen contract re-resolve**~~ — **DONE** (`refreshCarriedLegacyPlay` on carry)
2. ~~**Swing marks SSE**~~ — **DONE** (shared marks lane via `live-marks-active.ts`)
3. ~~**Executable bid/ask P&L**~~ — **DONE** (adapter + marks overlay)
4. ~~**Public swing record API**~~ — **DONE** (`GET /api/market/swing/record`)
5. ~~**Pre-entry banger discovery**~~ — **DONE** (`banger:watch:v1` cache → WATCH section)
6. **Thesis health / gates parity with 0DTE** — partial; not every row carries full `thesis_health`
7. **Calibration / score floors** — still provisional until backtest graduation
8. **4–15 literal DTE** — spine is **5–15**; 4-DTE weeklies stay on 0DTE unless spine changes

## What we did NOT merge

- **Vector chart desk** (`/vector`) — stays as analysis; picks feed Swing Command only.
- **Banger discovery cron** — still runs; output surfaces on Swings tab instead of `BangerBoard`.
- **LEAPS horizon id** — spine `16–90 DTE`; still no member toggle.

## Rollout

1. Ship nav + API merge + UI panel parity.
2. Monday RTH: verify banger OPEN rows appear under MANAGING with BANGER badge.
3. Follow with marks SSE + frozen-contract fix before sizing marketing on Swing Command.
