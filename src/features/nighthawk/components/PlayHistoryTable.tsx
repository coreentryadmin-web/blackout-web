"use client";

// "History" browser for the 0DTE track record — the piece the X Ads Manager reference
// (a date-range picker over a browsable campaign table) had that Night Hawk didn't: a way
// to actually SEE individual past plays, not just the aggregate win-rate bars above it.
//
// No new data: `record.plays` (ZeroDteRecordPlay[]) already carries session_date, ticker,
// direction, tier, and the as-managed outcome/P&L for every graded play in the window —
// NighthawkAnalyticsPanel.tsx was already fetching it, just to feed aggregate-only helpers
// (winRateByTier, sessionPnlCurve) and never rendering the rows themselves. This component
// is purely a client-side view over the SAME array the panel already holds; it fetches
// nothing on its own.
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import type { ZeroDteRecordPlay } from "@/lib/zerodte/record";

const EM_DASH = "—";

function fmtSignedPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return `${v >= 0 ? "+" : ""}${v}%`;
}

/** Same humanization list NighthawkAnalyticsPanel keeps for `by_outcome` bucket labels —
 *  duplicated rather than imported since that map is a private module-level const, not an
 *  export; both are stamping the same raw engine-exit vocabulary from record.ts. */
const OUTCOME_LABEL: Record<string, string> = {
  doubled: "doubled",
  stopped: "stopped",
  time_stop: "time stop",
  ratchet_breakeven_floor: "breakeven floor",
  ratchet_early_profit_floor: "early profit floor",
  ratchet_profit_floor: "profit floor",
  runner_floor: "runner floor",
  plan_stop: "plan stop",
  plan_target_trim: "target trim",
  trim_scale_first: "1st trim",
  trim_scale_second: "2nd trim",
  trim_scale_runner_target: "runner target",
  flat_theta_bleed: "flat scratch",
};

function humanizeOutcome(raw: string | null): string {
  if (raw == null) return EM_DASH;
  if (OUTCOME_LABEL[raw]) return OUTCOME_LABEL[raw];
  if (raw.startsWith("thesis_break")) return "thesis break";
  return raw;
}

export const HISTORY_WINDOW_OPTIONS = [7, 30, 90] as const;
export type HistoryWindowDays = (typeof HISTORY_WINDOW_OPTIONS)[number];

export function PlayHistoryTable({
  plays,
  windowDays,
  onWindowDaysChange,
}: {
  plays: ZeroDteRecordPlay[];
  windowDays: HistoryWindowDays;
  onWindowDaysChange: (days: HistoryWindowDays) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return plays;
    return plays.filter((p) => p.ticker.toUpperCase().includes(q));
  }, [plays, search]);

  return (
    <div className="nh-history">
      <div className="nh-history-controls">
        <div className="nh-history-window" role="group" aria-label="History window">
          {HISTORY_WINDOW_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={clsx("nh-history-window-btn", windowDays === d && "is-active")}
              onClick={() => onWindowDaysChange(d)}
              aria-pressed={windowDays === d}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="nh-history-search">
          <span className="nh-history-search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter ticker…"
            aria-label="Filter history by ticker"
            className="nh-history-search-input"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="nh-analytics-empty">
          {search.trim() ? `No plays match "${search.trim()}" in the last ${windowDays}d.` : `No graded plays in the last ${windowDays}d.`}
        </p>
      ) : (
        <div className="nh-history-tablewrap">
          <table className="nh-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ticker</th>
                <th>Dir</th>
                <th>Tier</th>
                <th>Outcome</th>
                <th className="nh-history-col-num">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={`${p.session_date}-${p.ticker}-${p.flagged_at}-${i}`}>
                  <td className="tabular-nums">{p.session_date}</td>
                  <td>{p.ticker}</td>
                  <td>
                    <span className={clsx("nh-history-dir", p.direction === "long" ? "is-long" : "is-short")}>
                      {p.direction === "long" ? "L" : "S"}
                    </span>
                  </td>
                  <td>{p.tier ?? EM_DASH}</td>
                  <td>{humanizeOutcome(p.managed_outcome)}</td>
                  <td
                    className={clsx(
                      "nh-history-col-num tabular-nums",
                      p.managed_pnl_pct != null && (p.managed_pnl_pct >= 0 ? "is-up" : "is-down")
                    )}
                  >
                    {fmtSignedPct(p.managed_pnl_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PlayHistoryTable;
