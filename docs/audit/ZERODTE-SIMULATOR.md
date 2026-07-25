# 0DTE Night Hawk — ADMIN-ONLY SIMULATION VIEW

A way for an admin to open a URL in a browser and **watch a simulated 0DTE session play
through the REAL Night Hawk panel** on production — while every member keeps seeing the
real, untouched board. Members can never see sim data.

## Watch URL

```
https://blackouttrades.com/night-hawk?sim=1
```

Open it while signed in **as an admin** (Clerk `publicMetadata.role === "admin"` or an
`ADMIN_EMAILS` address). A persistent amber **"SIMULATION — not live"** banner shows on
the 0DTE deck while sim mode is active. Drop the `?sim=1` and you are back on the real
member board immediately.

## Seed / drive it

Feed board frames on a clock with the admin sim feeder (authenticates as a temporary
admin Clerk user, deleted in a `finally`):

```bash
# Full synthetic RTH arc — the canonical 5-play demo, plays in ~6–7 min:
#   NVDA long/FLOW → +80% (TRIM) · TSLA long/BREAKOUT → +40% · META long → +30% target
#   SPX iron CONDOR/PIN → +76% time_stop · AMD long put/FLOW → −50% STOPPED
npm run sim:feed -- --synthetic --base=https://blackouttrades.com

# Replay a captured session (array of { etMinute, payload }):
npm run sim:feed -- --replay=./session.json --base=https://blackouttrades.com

# Faster (ET-minutes advanced per real second; default 60):
npm run sim:feed -- --synthetic --speed=120

# Preview the frame schedule without authenticating or posting:
npm run sim:feed -- --synthetic --dry-run
```

Secrets are read from env only (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)
and never printed. The feeder prints the exact watch URL on start.

## Reset

```bash
npm run sim:feed -- --reset          # clears the sim Redis key
# or directly:
curl -X DELETE https://blackouttrades.com/api/admin/zerodte/sim/board   # (admin cookie)
```

The sim key also carries a short TTL (default 30 min, `ZERODTE_SIM_BOARD_TTL_SEC`), so an
abandoned sim self-expires with no manual reset.

## Isolation guarantee — why members can NEVER see sim data

Three **independent** layers guard the member board; all three must hold before a byte of
sim data reaches a browser:

1. **Admin auth gate.** The ingest endpoint (`POST/DELETE /api/admin/zerodte/sim/board`)
   is `requireAdminApi()` — 401/403 for anyone else. The board GET route only consults
   the sim key after re-checking `isAdminUser` server-side. A non-admin who appends
   `?sim=1` gets the **member** board (proven by the `shouldServeSimBoard` truth-table
   test).
2. **Separate Redis key.** Sim frames live in `zerodte:board:snapshot:sim:v1`
   (→ `blackout:…`), a **different** key from the member snapshot
   `zerodte:board:snapshot:v1`. The sim module (`src/lib/platform/zerodte-sim-board.ts`)
   never reads or writes the member key — a bug there physically cannot corrupt what
   members see. (Enforced by a test that greps the module for the member-key literal.)
3. **Opt-in `?sim=1` param.** Absent the param, the board GET route runs the **unchanged**
   member path (`getZeroDteBoardPayload()`) for everyone, admin included.

### Member-path-unchanged proof

The board route's default path is byte-for-byte the same call it always made:
`getZeroDteBoardPayload()`. The sim behavior is an **added branch in front of it**, gated
on `isSimRequested(?sim) && authResult.via === "user" && isAdminUser(...)`. Any request
that isn't an admin explicitly asking for sim falls straight through to that untouched
call. In sim mode the client also **disables the real live-marks SSE overlay**, so no real
member marks are ever painted onto the simulated board.

## Files

- `src/lib/platform/zerodte-sim-board.ts` — isolated sim key, TTL, the `shouldServeSimBoard`
  gate, payload validation, read/write/clear (+ `.test.ts`).
- `src/app/api/admin/zerodte/sim/board/route.ts` — admin-only ingest (POST/DELETE).
- `src/app/api/market/zerodte/board/route.ts` — added the gated sim read branch.
- `src/features/nighthawk/command-deck/containers.tsx` — `?sim=1` propagation + banner.
- `scripts/audit/zerodte-sim-feed.mjs` (`npm run sim:feed`) — the feeder.
