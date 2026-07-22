import type { SpxDeskSummary } from "@/lib/platform/types";
import type { PlaybookPlay } from "../types";
import type { DayTradeSignal } from "./day-trade-types";
import { todayEt as todayEtStr } from "@/lib/et-date";

export type SpxMacroBias = "bull" | "bear" | "neutral";

/** Infer session-wide SPX bias from desk summary fields. */
export function resolveSpxMacroBias(spx: SpxDeskSummary): SpxMacroBias {
  let bullish = 0;
  let bearish = 0;

  if (spx.above_vwap === true) bullish += 1;
  else if (spx.above_vwap === false) bearish += 1;

  const tide = (spx.tide_bias ?? "").toLowerCase();
  if (/bull|risk.?on|positive/i.test(tide)) bullish += 1;
  if (/bear|risk.?off|negative/i.test(tide)) bearish += 1;

  if (spx.flow_0dte_net != null) {
    if (spx.flow_0dte_net > 0) bullish += 1;
    else if (spx.flow_0dte_net < 0) bearish += 1;
  }

  if (spx.change_pct != null) {
    if (spx.change_pct > 0.15) bullish += 1;
    else if (spx.change_pct < -0.15) bearish += 1;
  }

  if (bullish >= bearish + 2) return "bull";
  if (bearish >= bullish + 2) return "bear";
  return "neutral";
}

export function isLongDirection(direction: string): boolean {
  const d = direction.trim().toUpperCase();
  return d.includes("LONG") || d === "BULL" || d === "BULLISH";
}

export function isShortDirection(direction: string): boolean {
  const d = direction.trim().toUpperCase();
  return d.includes("SHORT") || d === "BEAR" || d === "BEARISH";
}

export function isAmbiguousDirection(direction: string): boolean {
  const d = direction.trim().toUpperCase();
  if (!d || d === "—" || d === "NEUTRAL" || d === "UNKNOWN") return true;
  const long = isLongDirection(direction);
  const short = isShortDirection(direction);
  return !long && !short;
}

export function playAlignsWithSpxBias(direction: string, bias: SpxMacroBias): boolean {
  if (isAmbiguousDirection(direction)) return false;
  if (bias === "neutral") return true;
  if (bias === "bull") return isLongDirection(direction);
  return isShortDirection(direction);
}

export function filterSignalsBySpxAlignment(
  signals: DayTradeSignal[],
  spx: SpxDeskSummary | null,
  requireAlignment: boolean
): { signals: DayTradeSignal[]; bias: SpxMacroBias | null; dropped: number } {
  if (!requireAlignment || !spx) {
    return { signals, bias: spx ? resolveSpxMacroBias(spx) : null, dropped: 0 };
  }

  const bias = resolveSpxMacroBias(spx);
  const aligned = signals.map((s) => ({
    ...s,
    spx_aligned: playAlignsWithSpxBias(s.direction, bias),
  }));
  const kept = aligned.filter((s) => s.spx_aligned);
  return { signals: kept, bias, dropped: aligned.length - kept.length };
}

export function parseDayMaxDte(filters: Record<string, string | number | boolean>): number {
  const raw = Number(filters.max_dte);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
  return 1;
}

export function optionsPlayWithinMaxDte(optionsPlay: string, maxDte: number): boolean {
  const text = optionsPlay.trim();
  if (!text || text === "—") return true;

  // 1) Explicit ISO expiry (e.g. "SPY 2026-07-22 $565 CALL") — the precise path.
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    const expiry = new Date(`${iso[1]}T16:00:00-04:00`);
    const todayEt = todayEtStr();
    const todayMs = new Date(`${todayEt}T12:00:00-04:00`).getTime();
    const dte = Math.round((expiry.getTime() - todayMs) / 86_400_000);
    return dte <= maxDte;
  }

  // 2) Explicit DTE MARKER in the text ("0DTE", "0 DTE", "1DTE", "0–3 DTE"). The playbook / LLM
  //    path writes the expiry this way instead of an ISO date (see the format prompt + UI fixtures:
  //    "SPY 565C (0DTE)", "NVDA 880C (0–3 DTE)"). Before this, ANY such play fell through to the
  //    reject-if-tight branch below and was dropped — so on a normal day the 0–1 DTE day filter
  //    silently discarded nearly every 0DTE play and only an ISO-dated one (e.g. an index play)
  //    survived: the "only one SPX play all day" bug. For a RANGE ("0–3 DTE") use the LOW end — the
  //    contract is available at that minimum DTE, so it qualifies for a ≤ maxDte day trade.
  const dteMarker = text.match(/(\d+)\s*(?:[–—-]\s*\d+\s*)?d(?:te|\.t\.e|ays?\s*to\s*(?:exp|expir))/i);
  if (dteMarker) {
    const lowDte = Number(dteMarker[1]);
    if (Number.isFinite(lowDte)) return lowDte <= maxDte;
  }

  // 3) MONTH-NAME expiry ("… — Jul 27") — the format the deterministic synthesis actually emits
  //    (deterministic-edition.ts formatOptionsPlay → shortExpiry: "Mon DD", no year). This is the
  //    LIVE production format, so without this branch the entire day board fell through to the
  //    reject-if-tight default below — the structural other half of the empty-0DTE-board bug. Year
  //    is inferred from today; a wrap across year-end (today Dec, expiry Jan) is corrected.
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mon = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (mon) {
    const monIdx = MONTHS.indexOf(mon[1]!.slice(0, 3).toLowerCase());
    const day = Number(mon[2]);
    if (monIdx >= 0 && Number.isFinite(day)) {
      const todayEt = todayEtStr();
      const year = Number(todayEt.slice(0, 4));
      const todayMs = new Date(`${todayEt}T12:00:00-04:00`).getTime();
      const mm = String(monIdx + 1).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      let dte = Math.round((new Date(`${year}-${mm}-${dd}T16:00:00-04:00`).getTime() - todayMs) / 86_400_000);
      if (dte < -60) {
        dte = Math.round((new Date(`${year + 1}-${mm}-${dd}T16:00:00-04:00`).getTime() - todayMs) / 86_400_000);
      }
      return dte <= maxDte;
    }
  }

  // 4) "weekly"/"monthly" markers → not a same-day expiry; drop under a tight 0–1 DTE day filter.
  if (/\b(weekly|monthly|leaps?)\b/i.test(text)) return maxDte > 1;

  // 5) No parseable expiry AND no marker — reject when enforcing tight DTE (0–1 DTE day trade).
  return maxDte > 1;
}

export function filterPlaysByMaxDte(plays: PlaybookPlay[], maxDte: number): PlaybookPlay[] {
  return plays.filter((p) => optionsPlayWithinMaxDte(p.options_play, maxDte));
}
