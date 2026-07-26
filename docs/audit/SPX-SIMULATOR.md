# SPX Slayer desk — ADMIN-ONLY SIMULATION VIEW

A way for an admin to open a URL in a browser and **watch a synthetic SPX session play
through the REAL desk UI** on production — the Pulse rail, GEX matrix, pin forecast, sniper
header, and play state all driven by simulated data — while every member keeps seeing the
real, untouched desk. **Members can never see sim data.**

This is a faithful mirror of the Night Hawk 0DTE simulator (see `ZERODTE-SIMULATOR.md`);
same three-layer isolation, same feeder shape, applied to the SPX desk REST lanes.

## Watch URL

```
https://blackouttrades.com/dashboard?sim=1
```

Open it while signed in **as an admin** (Clerk `publicMetadata.role === "admin"` or an
`ADMIN_EMAILS` address). Every desk lane fetch then appends `?sim=1` and the routes serve
the isolated sim bundle. Drop the `?sim=1` and you are back on the real member desk
immediately. A non-admin who appends `?sim=1` sees the **live** desk unchanged (the flag
only rewrites request URLs — it grants no access; the server gate re-checks admin).

## Seed / drive it

Feed desk bundle frames on a clock with the admin sim feeder (authenticates as a temporary
admin Clerk user, deleted in a `finally`):

```bash
# Full synthetic RTH arc — spot marches up through the gamma flip (a gamma-flip cross), GEX
# walls build, the pin drifts + tightens into the close, a couple of large sweeps light up the
# Pulse rail, and one directional play runs its full lifecycle
# (SCANNING → WATCHING → armed BUY → OPEN/managed → CLOSED).
npm run sim:spx -- --synthetic --base=https://blackouttrades.com

# Replay a captured session (array of { etMinute, payload }, payload = an SpxSimDeskBundle):
npm run sim:spx -- --replay=./session.json --base=https://blackouttrades.com

# Faster (ET-minutes advanced per real second; default 60):
npm run sim:spx -- --synthetic --speed=120

# Preview the frame schedule without authenticating or posting:
npm run sim:spx -- --synthetic --dry-run
```

Secrets are read from env only (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) and
never printed. The feeder prints the exact watch URL on start. `--dry-run` structurally
validates every generated frame against the same `isSpxSimDeskBundle` contract the admin
ingest enforces and reports `invalid frames: 0` (78 five-minute frames across the session).

### What the synthetic arc exercises

| Panel | Driven by lane | What moves |
|---|---|---|
| **Sniper header** | `desk` / `pulse` | spot 6300 → 6340 → 6325, VIX 14.2 → 13.0, VWAP/EMAs, regime flips at the flip |
| **GEX matrix** | `gexHeatmap` (SPX) | 31-strike ladder × 5 expiries, call wall 6350, put wall 6250, γ-flip 6310, VEX lens |
| **Pin forecast** | `pin` | projected close drifts to 6325, pin snaps to a strike, `pinPct` tightens 0.34 → 0.84 |
| **Play state** | `play` | SCANNING → WATCHING → armed **BUY** (`signal_committed`) → OPEN/HOLD/TRIM → SELL → CLOSED |
| **Pulse rail / tape** | `desk`/`flow` | two large SPXW sweeps at the walls, tide/flow premium, 0DTE net |

The gamma-flip **cross** is real: the session opens below 6310 (short gamma) and trades
above it midday (long gamma), so the regime read on the matrix and header flips live.

## Reset

```bash
npm run sim:spx -- --reset          # clears the sim Redis key
# or directly:
curl -X DELETE https://blackouttrades.com/api/admin/spx/sim/desk   # (admin cookie)
```

The sim key also carries a short TTL (default 30 min, `SPX_SIM_TTL_SEC`), so an abandoned
sim self-expires with no manual reset.

## Isolation guarantee — why members can NEVER see sim data

Three **independent** layers guard the member desk; all three must hold before a byte of sim
data reaches a browser:

1. **Admin auth gate.** The ingest endpoint (`POST/DELETE /api/admin/spx/sim/desk`) is
   `requireAdminApi()` — 401/403 for anyone else. Every SPX read route only consults the sim
   key after re-checking `isAdminUser` server-side. A non-admin who appends `?sim=1` gets the
   **member** lane (proven by the `shouldServeSpxSim` truth-table test).
2. **Separate Redis key.** Sim frames live in `spx:desk:snapshot:sim:v1` (→ `blackout:…`), a
   **different** key from every live SPX cache lane (`spx-desk:<date>`, `spx-desk-pulse:*`,
   `spx-desk-flow:*`, `spx-pin:*`, `spx-bootstrap:*`, the matrix cache). The sim module
   (`src/lib/platform/spx-sim-desk.ts`) never reads or writes any live lane — a bug there
   physically cannot corrupt what members see. (Enforced by a test that greps the module for
   the live-key literals.)
3. **Opt-in `?sim=1` param.** Absent the param, every route runs the **unchanged** live
   member path for everyone, admin included.

### Member-path-unchanged proof

On each of the **7 routes** the sim behavior is a single **early branch added in front of the
untouched live reader**, gated on
`isSpxSimRequested(?sim) && auth.via === "user" && isAdminUser(...)`:

| Route | Live reader (unchanged, still reached) | Sim serves |
|---|---|---|
| `spx/bootstrap` | `loadBootstrapBundle()` | `snap.bootstrap` |
| `spx/desk` | `loadSpxDesk()` | `snap.desk` |
| `spx/pulse` | `loadSpxDeskPulse()` | `snap.pulse` |
| `spx/flow` | `loadSpxDeskFlow()` | `snap.flow` |
| `spx/play` | `getSpxPlayState()` | `snap.play` |
| `spx/pin` | `loadSpxPinForecast()` | `snap.pin` |
| `gex-heatmap` (`ticker==="SPX"` only) | `fetchGexHeatmap()` | `snap.gexHeatmap` |

Any request that isn't an admin explicitly asking for sim — no `?sim=1`, a non-admin (even
with `?sim=1`), a cron caller, or (for the matrix) any non-SPX ticker — falls straight
through to that untouched reader. Client-side, the URL is **byte-identical to today** for
every member: the `sim` flag defaults false, so the fetchers append nothing. Sim responses
carry an `X-Spx-Sim: 1` header for quick verification.

### Known gaps (this desk-path PR)

- **VectorPulse chart play banner** stays on the live play key — the embedded Vector chart's
  own play fetch was deliberately left unchanged (its key is hardcoded). The desk's own play
  state (sniper header / play panel) DOES switch to sim. Chart-path sim is a follow-up.
- **SSE pulse stream** (`spx/pulse/stream`) stays on live — the sim runs on the REST lanes
  only. The REST pulse poll still drives header/price motion in sim mode.

## Files

- `src/lib/platform/spx-sim-desk.ts` — isolated sim key, TTL, the `shouldServeSpxSim` gate,
  `isSpxSimRequested`, bundle validation, read/write/clear (+ `.test.ts`).
- `src/app/api/admin/spx/sim/desk/route.ts` — admin-only ingest (POST/DELETE).
- `src/app/api/market/spx/{bootstrap,desk,pulse,flow,play,pin}/route.ts` and
  `src/app/api/market/gex-heatmap/route.ts` — added the gated sim read branch.
- `src/lib/api.ts` + `useMergedDesk` / `useSpxPlay` / `useSpxPinForecast` /
  `SpxGexMatrixHeatmap` / `SpxPinForecast` / `SpxDashboard` — `?sim=1` propagation.
- `scripts/audit/spx-sim-feed.mjs` (`npm run sim:spx`) — the feeder;
  `scripts/audit/lib/spx-sim-frames.mjs` — the pure synthetic-frame builders (+ `.test.ts`).
