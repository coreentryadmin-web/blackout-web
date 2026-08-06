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

  // 0DTE chain: today's expiry; fall back to the nearest listed expiry when today isn't an expiry.
  let contracts: PinContract[] = [];
  if (spot > 0) {
    const chain = (await loadCurrentChainContracts("SPX", spot).catch(() => [])) as PinContract[];
    const todayContracts = chain.filter((c) => c.expiry === sessionYmd);
    if (todayContracts.length) contracts = todayContracts;
    else if (chain.length) {
      const nearest = chain.map((c) => c.expiry).sort()[0];
      contracts = chain.filter((c) => c.expiry === nearest);
    }
  }

  const common = { spot, priorClose, contracts, sessionYmd, nowMs, closeMs };

  const base = forecastPin({ ...common, method: "analytic" });
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
