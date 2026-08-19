/**
 * WHICH narrowed horizons a given sweep tick writes.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────────────
 * #2273 put all three narrowed rails (0dte/weekly/monthly) on the 5s sweep and #2274 reverted it
 * the same day. Its READ half was right and is restored alongside this file: a narrowed horizon is
 * a subset of expiry columns of a matrix the sweep already holds, so deriving it costs no network
 * at all. What killed it was the WRITE half — every ticker went from one rail write to four, about
 * 122 -> 488 per 5s tick, the sweep overran, and the blended rail everyone depends on regressed
 * from 5s to 10-25s.
 *
 * A rail "append" is not cheap: `appendSessionWallSample` does a read-modify-write of the WHOLE
 * session rail plus a durable-queue enqueue, and the payload grows all session. Four of those per
 * ticker per tick is not a rounding error, and `shared-cache` exposes no pipeline to fold them
 * into one round trip. So the honest options were to accept 4x, or to spend the extra writes where
 * they actually buy something.
 *
 * ── THE RULE, AND ITS PRICE ──────────────────────────────────────────────────────────
 * Not every horizon deserves the same resolution. A 0DTE wall structure moves within a session —
 * it is the rail a member watches intraday, and the one behind the "beads should form every 5s"
 * requirement. A MONTHLY wall does not meaningfully change in five seconds; sampling it at the
 * sweep cadence spends writes on a picture that looks the same either way.
 *
 * So: 0DTE writes on every sweep, weekly and monthly on every Nth. That is roughly
 * 1 blended + 1 0dte + 2/N per ticker instead of 4 — about 2.2 writes per ticker at N=12 rather
 * than 4, while taking weekly/monthly from their current ~300s cron cadence down to N x 5s.
 *
 * This is a TRADE, not a free win, and it should be read as one: weekly and monthly rails become
 * coarser than 0DTE by construction. They are also 5x finer than the 300s they get today.
 *
 * Deliberately a pure function of the tick index — no clock, no state — so the cadence is
 * deterministic, testable, and identical across replicas that share a tick counter.
 */

import type { VectorDteHorizon } from "./vector-dte-horizon";

/**
 * Sweeps between weekly/monthly writes. **1 = every sweep (5s), the same cadence as 0DTE.**
 *
 * ── WHY THIS IS 1 AGAIN (2026-08-19) ─────────────────────────────────────────────────
 * The rationing above was never about what a viewer needs — it was about WRITE COST, because an
 * append used to rewrite the whole growing rail. That is fixed: rails are append-only lists now
 * (`redisListKey` in vector-wall-persist.ts), so one sample costs one RPUSH regardless of how long
 * the session already is. The budget this constant was defending no longer exists.
 *
 * The measured consequence of rationing, which is why it had to go: a rail is only dense for a
 * ticker somebody is WATCHING, because viewing triggers live 5s writes. Live prod, one session:
 *
 *     SPX  weekly 3845 samples   (viewed all session — the flagship desk)
 *     TSLA weekly  591
 *     NVDA weekly  100
 *     AAPL weekly   70
 *
 * The Vector chart OPENS on weekly. So an unviewed ticker showed a rail built from ~100 samples
 * across ~15 strike rows — about 6 beads per row — which renders as one visible level while SPX
 * renders ten. Members read that as "the beads are broken on everything except SPX", and they were
 * right: whether your ticker had a usable rail depended on whether anyone happened to be looking at
 * it, which is not a property any product should have.
 *
 * The requirement is now explicit and unconditional: **every universe ticker records every rail
 * every 5s, viewed or not** (non-universe rides the 15s active lane, likewise viewed or not).
 *
 * ── THE COST, STATED ─────────────────────────────────────────────────────────────────
 * 4 rail writes per ticker per tick instead of ~2.2 (`meanRailWritesPerTick`). That is the same
 * WRITE COUNT that overran the sweep in #2273 — but not the same write. Each is now O(1) rather
 * than O(session length), which is the variable that actually blew the budget: #2273's writes got
 * more expensive every minute of the session, and these do not.
 */
export const NARROWED_SLOW_HORIZON_EVERY_N_TICKS = 1;

/** Horizons written on EVERY sweep. The one a member watches intraday. */
const FAST_HORIZONS: readonly VectorDteHorizon[] = ["0dte"];

/** Horizons written every Nth sweep. Structure that does not move in seconds. */
const SLOW_HORIZONS: readonly VectorDteHorizon[] = ["weekly", "monthly"];

/**
 * Which narrowed horizons this tick should write.
 *
 * `tickIndex` is a monotonically increasing sweep counter. Tick 0 writes everything, so a freshly
 * started replica seeds all three rails immediately rather than leaving weekly/monthly blank for
 * the first minute — an empty rail and a coarse rail look identical to a reader, and only one of
 * them is honest.
 */
export function horizonsForTick(tickIndex: number): VectorDteHorizon[] {
  const i = Number.isFinite(tickIndex) && tickIndex >= 0 ? Math.floor(tickIndex) : 0;
  const everyN =
    Number.isFinite(NARROWED_SLOW_HORIZON_EVERY_N_TICKS) && NARROWED_SLOW_HORIZON_EVERY_N_TICKS > 0
      ? NARROWED_SLOW_HORIZON_EVERY_N_TICKS
      : 1;
  return i % everyN === 0 ? [...FAST_HORIZONS, ...SLOW_HORIZONS] : [...FAST_HORIZONS];
}

/**
 * Rail writes per ticker on a given tick, INCLUDING the blended rail.
 *
 * Exported so the cost of this design is a number a reader can check rather than a claim in a
 * comment — the whole reason the previous attempt was reverted is that its write cost was only
 * discovered in production.
 */
export function railWritesForTick(tickIndex: number): number {
  return 1 + horizonsForTick(tickIndex).length;
}

/** Mean rail writes per ticker per tick over a full cycle. The number to compare against 4. */
export function meanRailWritesPerTick(): number {
  const n = NARROWED_SLOW_HORIZON_EVERY_N_TICKS;
  let total = 0;
  for (let i = 0; i < n; i++) total += railWritesForTick(i);
  return total / n;
}
