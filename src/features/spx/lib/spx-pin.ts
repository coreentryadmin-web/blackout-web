import "server-only";

import { loadCurrentChainContracts } from "@/features/vector/lib/vector-gex-reconstruct-server";
import { loadSpxDeskPulse } from "@/features/spx/lib/spx-desk-loader";
import { etMinutes } from "@/features/spx/lib/spx-play-session-time";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  forecastPin,
  type PinForecast,
  type PinContract,
  type PinConeStep,
  type PinScenario,
} from "@/features/spx/lib/spx-pin-forecast-core";

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

/** The EOD Pin Forecaster payload the desk serves: analytic base + a Monte-Carlo overlay. */
export type SpxPinForecast = PinForecast & { montecarlo: PinMonteCarlo | null };

const RTH_CLOSE_ET_MIN = 16 * 60; // 16:00 ET
const MC_PATHS = 400;

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
  const spot = pulse?.price ?? 0;
  const priorClose = pulse?.prior_close ?? null;

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
  if (!base.available) return { ...base, montecarlo: null };

  const mc = forecastPin({ ...common, method: "montecarlo", mcPaths: MC_PATHS, seed: Math.floor(nowMs / 60_000) });
  const montecarlo: PinMonteCarlo | null = mc.available
    ? { pin: mc.pin, projectedClose: mc.projectedClose, pinPct: mc.pinPct, pinBand: mc.pinBand, cone: mc.cone, scenarios: mc.scenarios, paths: MC_PATHS }
    : null;

  return { ...base, montecarlo };
}
