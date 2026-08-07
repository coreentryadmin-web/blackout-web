import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { etMinutes } from "@/features/spx/lib/spx-play-session-time";
import { forecastPin, type PinContract, type PinForecast } from "@/features/spx/lib/spx-pin-forecast-core";
import { normalizeVectorTicker } from "./vector-ticker";
import { loadCurrentChainContracts } from "./vector-gex-reconstruct-server";
import { resolveForecastTarget, type ForecastTargetKind } from "./vector-forecast-target";

/**
 * GENERIC PIN FORECAST — the SPX EOD pin forecaster, run for ANY Vector ticker.
 *
 * The forecasting core (`spx-pin-forecast-core.ts`) was always ticker-agnostic; what kept it on the
 * SPX desk was that it had no way to say WHICH expiry a name pins toward or HOW LONG the run-up is.
 * Those are now `resolveForecastTarget`'s job, and the two clocks it returns feed the core's
 * `horizonMin` / `structYears` inputs. This module is the thin server shell that joins them to real
 * per-ticker market data.
 *
 * It deliberately reuses the SAME live spot + Redis-cached banded chain the per-expiry GEX walls and
 * the expected-move cone already fetch (`getGexPositioning` + `loadCurrentChainContracts`), so a
 * forecast adds NO provider RPS on a warm ticker and cannot disagree with the walls drawn beside it.
 *
 * Best-effort, exactly like `getVectorExpectedMove`: every failure path returns null so a live
 * overlay degrades to "no cone" rather than erroring or blanking the chart. It never fabricates a
 * target, a chain or a vol — on a thin single-name book the honest answer is no forecast, and a
 * forecast that always draws something is decoration.
 */

export type VectorPinForecast = PinForecast & {
  ticker: string;
  /** Which close this cone terminates on. */
  target: ForecastTargetKind;
  /** YYYY-MM-DD of that close. */
  targetYmd: string;
  /** Expiry whose book generated the ladder — may be later than `targetYmd` on an "eod" target. */
  chainExpiry: string;
  /** REAL wall-clock ms of the target close (the core's own clock is trading-time; see
   *  vector-forecast-target.ts). Use this for any "pins by <time>" label. */
  targetCloseMs: number;
  /** Set when the target is defensible but weaker than the headline — the UI badges it. */
  caveat: string | null;
};

export async function getVectorPinForecast(
  ticker: string,
  target: ForecastTargetKind
): Promise<VectorPinForecast | null> {
  const t = normalizeVectorTicker(ticker);
  try {
    const pos = await getGexPositioning(t);
    const spot = pos?.spot;
    if (!(spot && spot > 0)) return null;

    const contracts = (await loadCurrentChainContracts(t, spot)) as PinContract[];
    if (!contracts.length) return null;

    const sessionYmd = todayEtYmd();
    const now = new Date();
    const resolved = resolveForecastTarget({
      kind: target,
      nowMs: now.getTime(),
      etMinuteOfDay: etMinutes(now),
      sessionYmd,
      expiries: contracts.map((c) => c.expiry),
      isTradingDay: isTradingDayEt,
    });
    // Null means there is nothing honest to forecast (no forward expiry, or the target close has
    // passed). Never substitute a default — a fabricated target is the failure mode this whole
    // path exists to avoid.
    if (!resolved) return null;

    // Only the target expiry's book pins price at that close. Mixing expiries would blend a
    // Friday wall into a monthly ladder and produce a magnet no single book actually supports.
    const expiryContracts = contracts.filter((c) => c.expiry === resolved.chainExpiry);
    if (expiryContracts.length < 2) return null;

    // Prior close from the live day-change: spot / (1 + change%). Derived rather than fetched
    // because it only feeds the forecast's "gap context" driver text, so it does not justify a
    // second provider call — and a non-finite change_pct simply yields null, which the core accepts.
    const changePct = pos?.change_pct;
    const priorClose =
      typeof changePct === "number" && Number.isFinite(changePct) && changePct > -100
        ? spot / (1 + changePct / 100)
        : null;

    const forecast = forecastPin({
      spot,
      priorClose,
      contracts: expiryContracts,
      sessionYmd,
      nowMs: now.getTime(),
      // Trading-time clock (see vector-forecast-target.ts) — paired with horizonMin so tFrac is
      // measured in the same units it is divided by.
      closeMs: resolved.closeMs,
      horizonMin: resolved.horizonMin,
      structYears: resolved.structYears,
      method: "montecarlo",
      // Deterministic per ticker+target+session so two polls in the same session agree with each
      // other, while different names still explore different path draws.
      seed: stableSeed(`${t}:${target}:${sessionYmd}`),
    });

    return {
      ...forecast,
      ticker: t,
      target,
      targetYmd: resolved.targetYmd,
      chainExpiry: resolved.chainExpiry,
      targetCloseMs: resolved.targetCloseMs,
      caveat: resolved.caveat,
    };
  } catch {
    return null; // live overlay: degrade to "no cone", never throw
  }
}

/** FNV-1a → uint32. Stable across processes so every replica seeds the same paths for a ticker. */
function stableSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
