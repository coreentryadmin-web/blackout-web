/**
 * ET SESSION FACTS — the one derivation of "what session is it, right now".
 *
 * WHY THIS EXISTS. Several Thermal-facing payloads need the same three things beside a timestamp:
 * which ET session the payload belongs to, what phase the market is in, and the wall-clock stamp.
 * They were each deriving it separately, or not at all:
 *
 *   - `get_thermal_compare` / `get_helix_thermal_compare` derive it (correctly) via `etSessionNow`.
 *   - `get_positioning` and `get_gex_heatmap` carried a bare UTC `asof` and nothing else — a UTC
 *     instant rolls its calendar DATE at 20:00 ET, so for the last four hours of every trading day
 *     a session resolved from it is a full session ahead (#2418 / #2420 class).
 *   - the public gamma snapshot grew its own copy for the freshness caveat.
 *
 * A fourth copy is how two surfaces start disagreeing about the same minute, so this is the shared
 * one and the others delegate to it.
 *
 * HOLIDAYS ARE MODELLED HERE, and that is the substantive difference from `marketPhaseFromEt`
 * alone. That helper's own doc is explicit that it does not carry a holiday calendar and that
 * reporting a holiday as OPEN is a known, bounded inaccuracy. But this repo DOES have a
 * holiday-aware trading-day gate (`isTradingDayEt`, which `isEtCashRth` already uses), so on
 * Thanksgiving the phase helper alone would say OPEN at 11:00 while the rest of the platform says
 * the market is shut. Composing the two costs one call and removes the discrepancy: a non-trading
 * day is CLOSED, whatever the clock says.
 *
 * Client-safe: the import chain is `isTradingDayEt` -> `spx-session` -> `et-date`, all pure, and
 * client components already pull it through `et-market-hours.ts`.
 */

import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { marketPhaseFromEt, type MarketPhase } from "@/lib/largo/core/system-status";

export type { MarketPhase };

export type EtSessionFacts = {
  /** OPEN | PRE-MARKET | AFTER-HOURS | CLOSED. CLOSED on weekends AND market holidays. */
  market_session: MarketPhase;
  /** The ET session date (YYYY-MM-DD). Never derive a session from a UTC calendar date. */
  session_date: string;
  /** Wall clock, e.g. "14:32 ET". */
  et_time: string;
  /** Session date + wall clock, e.g. "2026-08-22 14:32 ET" — the stamp to publish beside a UTC ISO. */
  as_of_et: string;
  /**
   * Is `session_date` an NYSE trading day at all? Distinct from `market_session === "CLOSED"`,
   * which is also true overnight on an ordinary trading day. A consumer that wants to say
   * "the market is shut today" rather than "the market is shut right now" needs this one.
   */
  is_trading_day: boolean;
};

/**
 * Resolve every ET session fact from ONE instant.
 *
 * Callers with a payload spanning several reads should pass a FROZEN `now`: the phase, the session
 * date and every age in one payload must describe the same moment, or a payload assembled across
 * 15:59:59 -> 16:00:01 reports OPEN over post-close rows.
 */
export function etSessionFacts(now: Date = new Date()): EtSessionFacts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // `hour12: false` renders midnight as "24" in some ICU versions; normalise so 24:07 -> 00:07.
  // Unnormalised that is 1440 minutes, which falls outside every phase window and would read
  // CLOSED for the wrong reason.
  const rawHour = Number(part("hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(part("minute"));
  const session_date = `${part("year")}-${part("month")}-${part("day")}`;
  const et_time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`;

  const is_trading_day = isTradingDayEt(session_date);
  // A holiday is CLOSED regardless of the clock — see the module doc.
  const market_session: MarketPhase = is_trading_day
    ? marketPhaseFromEt(DAYS[part("weekday")] ?? 1, hour * 60 + minute)
    : "CLOSED";

  return { market_session, session_date, et_time, as_of_et: `${session_date} ${et_time}`, is_trading_day };
}

/** Whole seconds between an ISO stamp and `now`, or null when unusable. Never negative. */
export function ageSecondsFromIso(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const age = Math.round((now - t) / 1000);
  // A future stamp is clock skew, not a negative age — report it as unusable rather than as "0s old".
  return age < 0 ? null : age;
}
