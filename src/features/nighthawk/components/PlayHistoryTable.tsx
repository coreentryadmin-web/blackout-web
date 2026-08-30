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
//
// Color discipline (explicit product decision): exactly THREE tones anywhere in this
// component — green for a positive P&L, red for negative, amber/orange for exactly zero
// ("flat") — never a red/amber/green ramp keyed to magnitude the way WinRateBar's tier bars
// use elsewhere in this same panel. A history row is a single realized outcome, not a rate;
// there is no "weak win" shade to earn here, only up, down, or flat.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { ZeroDteRecordPlay } from "@/lib/zerodte/record";
import type { ZeroDteTier } from "@/lib/zerodte/tiers";
import { dailyPnlByDate } from "@/features/nighthawk/lib/analytics-panel";
import { PlayHistoryCalendar } from "./PlayHistoryCalendar";

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

/** null | 0 | positive | negative -> the one three-way tone class this whole component uses. */
function pnlTone(v: number | null | undefined): "is-up" | "is-down" | "is-flat" | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  if (v > 0) return "is-up";
  if (v < 0) return "is-down";
  return "is-flat";
}

/** direction_hit reuses the SAME three-tone vocabulary as pnlTone rather than a 4th color:
 *  true -> up (the underlying moved the called way), false -> down, null -> flat (never
 *  measured — an unresolved-underlying row is neutral evidence, not a miss). */
function hitTone(hit: boolean | null): "is-up" | "is-down" | "is-flat" {
  if (hit == null) return "is-flat";
  return hit ? "is-up" : "is-down";
}

function fmtMovePct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return `${v >= 0 ? "+" : ""}${v}%`;
}

// Widened from the original [7, 30, 90] to a fuller preset set (matching the density of a real
// range-picker dropdown) — every value is still well inside the API's own MAX_DAYS=90 cap
// (src/app/api/market/zerodte/record/route.ts), so this is a UI-only richness change, not a new
// capability claim.
export const HISTORY_WINDOW_OPTIONS = [7, 14, 30, 60, 90] as const;
export type HistoryWindowDays = (typeof HISTORY_WINDOW_OPTIONS)[number];

const HISTORY_WINDOW_LABEL: Record<HistoryWindowDays, string> = {
  7: "Last 7 days",
  14: "Last 14 days",
  30: "Last 30 days",
  60: "Last 60 days",
  90: "Last 90 days",
};

/**
 * Range-picker dropdown — visually modeled on the X Ads Manager reference (a trigger button
 * showing the current range, opening a panel of presets) but scoped to what the API actually
 * supports: a rolling "last N days ending today" window (`?days=N`, capped at 90). Deliberately
 * NOT an arbitrary start/end calendar picker — the backend has no arbitrary-range endpoint, and
 * building that control without the capability behind it would show a picker that silently does
 * something other than what it displays. Single-day drill-down (the actual date-range analog)
 * is the calendar strip below this, which IS real (dailyPnlByDate over the fetched window).
 */
function HistoryRangeDropdown({
  windowDays,
  onWindowDaysChange,
}: {
  windowDays: HistoryWindowDays;
  onWindowDaysChange: (days: HistoryWindowDays) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="nh-history-range" ref={rootRef}>
      <button
        type="button"
        className={clsx("nh-history-range-trigger", open && "is-open")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="nh-history-range-icon" aria-hidden>
          🗓
        </span>
        {HISTORY_WINDOW_LABEL[windowDays]}
        <span className="nh-history-range-chevron" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="nh-history-range-panel" role="listbox" aria-label="History window">
          {HISTORY_WINDOW_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="option"
              aria-selected={windowDays === d}
              className={clsx("nh-history-range-opt", windowDays === d && "is-active")}
              onClick={() => {
                onWindowDaysChange(d);
                setOpen(false);
              }}
            >
              {HISTORY_WINDOW_LABEL[d]}
              {windowDays === d && (
                <span className="nh-history-range-check" aria-hidden>
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type DirectionFilter = "ALL" | "long" | "short";
type TierFilter = "ALL" | ZeroDteTier;
type SortKey = "date" | "pnl";
type SortDir = "asc" | "desc";

function ariaSortFor(active: boolean, dir: SortDir): "none" | "ascending" | "descending" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

const TIER_OPTIONS: ZeroDteTier[] = ["A", "B", "C"];

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
  const [direction, setDirection] = useState<DirectionFilter>("ALL");
  const [tier, setTier] = useState<TierFilter>("ALL");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // The calendar reflects the FULL window regardless of the ticker/direction/tier filters
  // below it — it's a second, independent axis to narrow by (same relationship the status
  // filter and ticker search already have on CommandDeck's board), not something that
  // should shrink out from under itself as other filters change.
  const dailyBuckets = useMemo(() => dailyPnlByDate(plays), [plays]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return plays.filter((p) => {
      if (selectedDate && p.session_date !== selectedDate) return false;
      if (direction !== "ALL" && p.direction !== direction) return false;
      if (tier !== "ALL" && p.tier !== tier) return false;
      if (q && !p.ticker.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [plays, search, direction, tier, selectedDate]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const sign = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === "pnl") {
        const av = a.managed_pnl_pct ?? Number.NEGATIVE_INFINITY;
        const bv = b.managed_pnl_pct ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * sign;
      }
      return a.session_date.localeCompare(b.session_date) * sign;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "desc");
    }
  };

  const activeFilterCount = (direction !== "ALL" ? 1 : 0) + (tier !== "ALL" ? 1 : 0) + (selectedDate ? 1 : 0);

  return (
    <div className="nh-history">
      <div className="nh-history-panel-label">
        Past sessions
        {dailyBuckets.length > 0 && <span className="nh-history-panel-sub">{dailyBuckets.length} sessions</span>}
      </div>
      <PlayHistoryCalendar buckets={dailyBuckets} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <div className="nh-history-controls">
        <HistoryRangeDropdown windowDays={windowDays} onWindowDaysChange={onWindowDaysChange} />

        <div className="nh-history-filterbar" role="group" aria-label="Direction">
          {(["ALL", "long", "short"] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={clsx("nh-history-filter-btn", direction === d && "is-active")}
              onClick={() => setDirection(d)}
              aria-pressed={direction === d}
            >
              {d === "ALL" ? "All" : d === "long" ? "Long" : "Short"}
            </button>
          ))}
        </div>

        <div className="nh-history-filterbar" role="group" aria-label="Tier">
          {(["ALL", ...TIER_OPTIONS] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={clsx("nh-history-filter-btn", tier === t && "is-active")}
              onClick={() => setTier(t)}
              aria-pressed={tier === t}
            >
              {t === "ALL" ? "All tiers" : t}
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

        {activeFilterCount > 0 && (
          <button
            type="button"
            className="nh-history-clear-btn"
            onClick={() => {
              setDirection("ALL");
              setTier("ALL");
              setSelectedDate(null);
            }}
          >
            Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="nh-analytics-empty">
          {search.trim() || activeFilterCount > 0
            ? "No plays match the current filters."
            : `No graded plays in the last ${windowDays}d.`}
        </p>
      ) : (
        <div className="nh-history-tablewrap">
          <table className="nh-history-table">
            <thead>
              <tr>
                <th
                  className="nh-history-th-sortable"
                  onClick={() => toggleSort("date")}
                  aria-sort={ariaSortFor(sortKey === "date", sortDir)}
                >
                  Date {sortKey === "date" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th>Ticker</th>
                <th>Dir</th>
                <th>Tier</th>
                <th>Outcome</th>
                <th
                  className="nh-history-col-num nh-history-th-sortable"
                  onClick={() => toggleSort("pnl")}
                  aria-sort={ariaSortFor(sortKey === "pnl", sortDir)}
                >
                  P&amp;L {sortKey === "pnl" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const rowKey = `${p.session_date}-${p.ticker}-${p.flagged_at}-${i}`;
                const isOpen = expandedKey === rowKey;
                return (
                  <Fragment key={rowKey}>
                    <tr
                      className="nh-history-row"
                      onClick={() => setExpandedKey(isOpen ? null : rowKey)}
                      aria-expanded={isOpen}
                    >
                      <td className="tabular-nums">
                        <span className={clsx("nh-history-expand-caret", isOpen && "is-open")} aria-hidden>
                          ▸
                        </span>
                        {p.session_date}
                      </td>
                      <td className="nh-history-ticker">{p.ticker}</td>
                      <td>
                        <span className={clsx("nh-history-dir", p.direction === "long" ? "is-long" : "is-short")}>
                          {p.direction === "long" ? "L" : "S"}
                        </span>
                      </td>
                      <td>{p.tier ?? EM_DASH}</td>
                      <td>{humanizeOutcome(p.managed_outcome)}</td>
                      <td className={clsx("nh-history-col-num tabular-nums nh-history-pnl", pnlTone(p.managed_pnl_pct))}>
                        {fmtSignedPct(p.managed_pnl_pct)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="nh-history-detail-row">
                        <td colSpan={6}>
                          <div className="nh-history-detail">
                            <div className="nh-history-detail-item">
                              <span className="nh-history-detail-label">Flagged</span>
                              <span className="tabular-nums">{p.flagged_et}</span>
                            </div>
                            <div className="nh-history-detail-item">
                              <span className="nh-history-detail-label">Score</span>
                              <span className="tabular-nums">{p.score}</span>
                            </div>
                            <div className="nh-history-detail-item">
                              <span className="nh-history-detail-label">Conviction</span>
                              <span>{p.conviction ?? EM_DASH}</span>
                            </div>
                            <div className="nh-history-detail-item">
                              <span className="nh-history-detail-label">Underlying move</span>
                              <span className={clsx("tabular-nums", `nh-history-detail-tone-${hitTone(p.direction_hit)}`)}>
                                {fmtMovePct(p.move_pct)}
                              </span>
                            </div>
                            <div className="nh-history-detail-item">
                              <span className="nh-history-detail-label">Direction hit</span>
                              <span className={`nh-history-detail-tone-${hitTone(p.direction_hit)}`}>
                                {p.direction_hit == null ? "unresolved" : p.direction_hit ? "yes" : "no"}
                              </span>
                            </div>
                            <div className="nh-history-detail-item">
                              <span className="nh-history-detail-label">Graded via</span>
                              <span>{p.managed_source ?? EM_DASH}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PlayHistoryTable;
