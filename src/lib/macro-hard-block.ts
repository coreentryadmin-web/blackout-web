/**
 * Shared macro release hard-block windows — used by SPX Slayer entry gates and
 * 0DTE Command G-7 (docs/audit/NIGHTHAWK-0DTE-DECISION.md §2 G-7).
 *
 * Pure ET math lives in spx-macro-window.ts; this module applies the same CPI/FOMC/
 * NFP/PPI/GDP rules Slayer has used since spx-play-gates.ts so both surfaces block
 * the same windows.
 */

import { parseMacroEventTime, macroBlockWindow } from "@/features/spx/lib/spx-macro-window";

export type MacroEventLike = {
  time?: string | null;
  event?: string | null;
  country?: string | null;
  date?: string | null;
};

export type MacroHardBlockResult = {
  blocked: boolean;
  /** Human sentence for SKIP cards / gate blocks. */
  reason: string | null;
  /** Short event title when blocked. */
  eventTitle: string | null;
};

function isMacroTitle(title: string): boolean {
  return (
    title.includes("CPI") ||
    title.includes("FOMC") ||
    title.includes("FED") ||
    title.includes("NFP") ||
    title.includes("PAYROLL") ||
    title.includes("PPI") ||
    title.includes("GDP")
  );
}

/**
 * Returns whether `nowEtMinutes` falls inside a macro hard-block window for any
 * high-impact release on `todayYmd`.
 */
export function evaluateMacroHardBlock(
  events: MacroEventLike[],
  nowEtMinutes: number,
  todayYmd: string
): MacroHardBlockResult {
  for (const ev of events) {
    const title = String(ev.event ?? ev.country ?? "").toUpperCase();
    if (!isMacroTitle(title)) continue;

    const evTime = parseMacroEventTime(String(ev.time ?? ""), todayYmd);
    if (evTime == null) continue;

    const isAfternoonFed =
      title.includes("FOMC") || title.includes("FED") || title.includes("RATE DECISION");

    if (isAfternoonFed) {
      const fedMins = evTime.precise && evTime.minutes >= 12 * 60 ? evTime.minutes : 14 * 60;
      if (nowEtMinutes >= fedMins - 15 && nowEtMinutes <= fedMins + 15) {
        const label = title.slice(0, 48);
        return {
          blocked: true,
          eventTitle: label,
          reason: `Macro hard block: ${label} (Fed decision window ±15m) — no new 0DTE commits.`,
        };
      }
      continue;
    }

    const win = macroBlockWindow(evTime);
    if (nowEtMinutes >= win.start && nowEtMinutes <= win.end) {
      const label = evTime.precise ? String(ev.time ?? "08:30").slice(0, 5) : "AM";
      const eventLabel = title.slice(0, 48);
      return {
        blocked: true,
        eventTitle: eventLabel,
        reason: `Macro hard block: ${eventLabel} (${label} ET window) — no new 0DTE commits.`,
      };
    }
  }
  return { blocked: false, reason: null, eventTitle: null };
}
