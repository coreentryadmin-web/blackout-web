import "server-only";

import { loadCurrentChainContracts } from "@/features/vector/lib/vector-gex-reconstruct-server";
import { loadSpxDesk, loadSpxDeskPulse } from "@/features/spx/lib/spx-desk-loader";
import { etMinutes } from "@/features/spx/lib/spx-play-session-time";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  forecastPin,
  type PinForecast,
  type PinContract,
  type PinConeStep,
  type PinScenario,
} from "@/features/spx/lib/spx-pin-forecast-core";
import { resolvePinSpotInputs } from "@/features/spx/lib/spx-pin-spot";
import {
  isPinStable,
  pushPinSample,
  type PinStabilitySample,
} from "@/features/spx/lib/spx-pin-stability";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";

/** Monte-Carlo overlay summary — the truer (multi-humped) distribution beside the analytic base. */
export type PinMonteCarlo = {
  pin: number | null;
  /** Unsnapped live projected close (empirical median of the MC closes) — see PinForecast. */
  projectedClose: number | null;
  pinPct: number | null;
  pinBand: [number, number] | null;
  cone: PinConeStep[];
  scenarios: PinScenario[];
  paths: number;
};

/** The EOD Pin Forecaster payload the desk serves: analytic base + a Monte-Carlo overlay, plus the
 *  temporal-stability verdict (see spx-pin-stability.ts) so the UI can avoid flickering a pin that
 *  hasn't agreed across consecutive polls yet. */
export type SpxPinForecast = PinForecast & {
  montecarlo: PinMonteCarlo | null;
  /** True once the last PIN_STABILITY_WINDOW polls' snapped pin agreed within tolerance. */
  pinStable: boolean;
  /** The last pin value that WAS confirmed stable — held steady across noisy polls in between.
   *  Null until the very first stable cluster forms for the session. This is the number the UI
   *  should headline as "the" pin; `pin` remains the raw, poll-fresh snapped value for anyone who
   *  wants it (drivers/scenarios/internal math are unaffected — this only gates what's SURFACED). */
  pinConfirmed: number | null;
};

const RTH_CLOSE_ET_MIN = 16 * 60; // 16:00 ET
const MC_PATHS = 400;

// ── module-level rolling-window state (per-process; mirrors src/lib/server-cache.ts's in-memory
// `store` pattern) — tracks the last PIN_STABILITY_WINDOW raw snapped pins for THIS session day, so
// buildSpxPinForecast can require them to agree before trusting/surfacing a pin. Resets when the ET
// session day rolls over (a new day's book has no bearing on yesterday's stability streak). ──
let pinStabilityDay = "";
let pinStabilitySamples: PinStabilitySample[] = [];
let pinStabilityConfirmed: number | null = null;

function trackPinStability(sessionYmd: string, rawPin: number | null): { stable: boolean; confirmed: number | null } {
  if (sessionYmd !== pinStabilityDay) {
    pinStabilityDay = sessionYmd;
    pinStabilitySamples = [];
    pinStabilityConfirmed = null;
  }
  pinStabilitySamples = pushPinSample(pinStabilitySamples, rawPin);
  const stable = isPinStable(pinStabilitySamples);
  if (stable) pinStabilityConfirmed = pinStabilitySamples[pinStabilitySamples.length - 1] as number;
  return { stable, confirmed: pinStabilityConfirmed };
}

/**
 * Build the live EOD pin forecast for SPX 0DTE. Reuses the desk's warm spot/prior-close (pulse lane)
 * and the cached banded chain (loadCurrentChainContracts) — so it adds NO provider RPS. Runs the
 * cheap analytic model as the base and a Monte-Carlo overlay for the truer close distribution.
 *
 * Time-to-close is derived DST-safely from the ET wall clock: closeMs = now + (16:00 − nowET) — no
 * timezone-offset math. The core self-guards (collecting before a chain/bars exist; closed after 16:00).
 */
export async function buildSpxPinForecast(): Promise<SpxPinForecast> {
  const pulse = await loadSpxDeskPulse().catch(() => null);
  // Pulse returns price:0 outside RTH/premarket (by design — fast lane is session-scoped).
  // Fall back to the full desk snapshot so post-close pin can honestly report "Market closed"
  // with the real last print, instead of spot=0 + "Collecting" (live 2026-07-28 regression).
  let deskFallback: { price: number; prior_close: number | null } | null = null;
  if (!(pulse?.price && pulse.price > 0)) {
    deskFallback = await loadSpxDesk().catch(() => null);
  }
  const { spot, priorClose } = resolvePinSpotInputs(pulse, deskFallback);

  const nowMs = Date.now();
  const etMin = etMinutes(new Date());
  const closeMs = nowMs + (RTH_CLOSE_ET_MIN - etMin) * 60_000;
  const sessionYmd = todayEtYmd();

  // 0DTE chain: TODAY'S expiry only.
  //
  // This used to fall back to the nearest listed expiry when today wasn't an expiry, which turned
  // the panel into a confident forecast of something that could not happen. On a weekend or
  // holiday `closeMs` still resolves to "16:00 ET today" — so the panel rendered a live countdown
  // ("781 min to close") and a full drift cone toward a close that was never going to occur, built
  // from a chain expiring DAYS later. Reported live 2026-08-08 ~03:00 ET, with the GEX matrix on
  // the same screen already saying "No 0DTE column today — levels use front expiry 2026-08-10".
  //
  // A gamma pin is an expiry-day phenomenon: the hedging that drags price to a strike only exists
  // because that strike's options expire at the bell. A ladder from a future expiry has no such
  // force acting today, so a pin computed from it is not a weaker forecast — it is a different
  // quantity wearing this one's label. Better to say "no 0DTE today" than to answer confidently.
  //
  // `loadCurrentChainContracts` NEVER THROWS — it returns [] on an unconfigured Polygon key, a
  // 429/5xx, a fetch timeout, and an unresolvable options root alike (its own contract says so).
  // So `contracts.length === 0` cannot by itself distinguish "nothing expires today" from "we
  // never got a chain", and SPX has a 0DTE expiry on EVERY trading day. `chainLive` keeps that
  // distinction: it is true when the raw chain came back with ANY expiry, which proves the fetch
  // succeeded even if nothing matches today.
  let contracts: PinContract[] = [];
  let chainLive = false;
  if (spot > 0) {
    const chain = (await loadCurrentChainContracts("SPX", spot).catch(() => [])) as PinContract[];
    chainLive = chain.length > 0;
    contracts = chain.filter((c) => c.expiry === sessionYmd);
  }

  const common = { spot, priorClose, contracts, sessionYmd, nowMs, closeMs };

  const base = forecastPin({ ...common, method: "analytic" });

  // Distinguish "there is no 0DTE expiry today" from the core's generic cold-chain state. Both are
  // unavailable, but only one of them resolves by waiting — the core's default copy says
  // "Collecting… waiting for a live 0DTE chain", which on a Saturday is a promise the desk cannot
  // keep. Say the true thing instead.
  //
  // Assert "no 0DTE today" ONLY when we actually know it. Two states qualify:
  //   - it is not a trading day at all (the weekend/holiday case this branch was written for), or
  //   - the chain came back live and simply carries no expiry matching today.
  // A trading day with an EMPTY chain is the third state and it is NOT a market fact — it is an
  // outage. Asserting through it told a member "there is no 0DTE expiry today" on a session where
  // one certainly exists, and did so in the one register that is actively harmful: it converts a
  // RECOVERABLE condition ("Collecting… waiting for a live 0DTE chain" — resolves by waiting) into
  // an irrecoverable structural claim ("nothing is coming" — do not wait). Falling through leaves
  // the core's honest collecting copy in place. The sibling path already does this:
  // vector-pin-forecast-server.ts returns null on an empty chain rather than asserting, and
  // threads the same `isTradingDayEt` calendar fact through.
  const tradingDay = isTradingDayEt(sessionYmd);
  const noZeroDteToday = spot > 0 && contracts.length === 0 && (!tradingDay || chainLive);
  if (!base.available && noZeroDteToday) {
    const { stable, confirmed } = trackPinStability(sessionYmd, null);
    return {
      ...base,
      drivers: [{
        label: "No 0DTE expiry today",
        detail: "The EOD pin is an expiry-day effect — dealer hedging only drags price to a strike because that strike expires at the bell. With no SPX contracts expiring today there is no such force to forecast, so the desk reports nothing rather than projecting a close from a later expiry.",
        weight: 1,
      }],
      montecarlo: null,
      pinStable: stable,
      pinConfirmed: confirmed,
    };
  }

  if (!base.available) {
    // Unavailable this poll (chain cold / market closed) — feed a null sample so the stability
    // window resets (see trackPinStability / pushPinSample): a gap means we don't actually know
    // the book agreed through it, so the streak restarts rather than silently skipping the gap.
    const { stable, confirmed } = trackPinStability(sessionYmd, null);
    return { ...base, montecarlo: null, pinStable: stable, pinConfirmed: confirmed };
  }

  const mc = forecastPin({ ...common, method: "montecarlo", mcPaths: MC_PATHS, seed: Math.floor(nowMs / 5_000) });
  const montecarlo: PinMonteCarlo | null = mc.available
    ? { pin: mc.pin, projectedClose: mc.projectedClose, pinPct: mc.pinPct, pinBand: mc.pinBand, cone: mc.cone, scenarios: mc.scenarios, paths: MC_PATHS }
    : null;

  const { stable, confirmed } = trackPinStability(sessionYmd, base.pin);
  return { ...base, montecarlo, pinStable: stable, pinConfirmed: confirmed };
}
