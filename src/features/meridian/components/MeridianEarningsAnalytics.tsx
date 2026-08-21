"use client";

import { useMemo, useState } from "react";

import {
  buildCalendarGrid,
  buildPrintClock,
  buildSurpriseScatter,
  buildWeekPulse,
  buildBeatMissStreak,
  classifyPrintSession,
  fmtCompactMoney,
  fmtCountdown,
  fmtSurprisePct,
  hasPrinted,
  type CalendarCell,
  type PrintSession,
  type ScatterPoint,
  type EarningsAnalyticsRow,
} from "@/lib/meridian/meridian-earnings-analytics-core";

/**
 * Meridian earnings ANALYTICS panels — the data-dense half of the desk.
 *
 * Everything numeric here comes from meridian-earnings-analytics-core, which is unit-tested; these
 * components own layout and interaction only. That split is deliberate: the panels cannot be
 * exercised under `tsx --test`, so any arithmetic living in them would be untestable by construction.
 *
 * TWO RULES THE WHOLE FILE FOLLOWS:
 *  1. A missing number renders as an em-dash, never as 0. `null` means "we do not know", and on a
 *     panel a fabricated 0.0% is indistinguishable from a real in-line print.
 *  2. A projected date never renders as a confirmed one. `date_status` drives a visible marker,
 *     because "NVDA prints Tuesday" and "Benzinga guesses Tuesday" are different claims.
 */

const SESSION_LABEL: Record<PrintSession, string> = {
  pre: "BMO",
  post: "AMC",
  intraday: "INTRA",
  unknown: "TBD",
};

const SESSION_TITLE: Record<PrintSession, string> = {
  pre: "Before market open",
  post: "After market close",
  intraday: "During the session",
  unknown: "Print time not yet stamped",
};

/** Importance 0–5 → a 5-slot meter. Benzinga's own scale; we do not re-rank it. */
function ImportanceMeter({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="mea-imp" title={`Benzinga importance ${v}/5`} aria-label={`Importance ${v} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={`mea-imp-pip${i <= v ? " is-on" : ""}`} aria-hidden="true" />
      ))}
    </span>
  );
}

function SessionChip({ session }: { session: PrintSession }) {
  return (
    <span className={`mea-session mea-session-${session}`} title={SESSION_TITLE[session]}>
      {SESSION_LABEL[session]}
    </span>
  );
}

/** Signed value with tone. `null` → a muted em-dash, never a zero. */
function Delta({ value, digits = 1 }: { value: number | null | undefined; digits?: number }) {
  const known = value != null && Number.isFinite(value);
  const tone = !known ? "unknown" : value! > 0 ? "up" : value! < 0 ? "down" : "flat";
  return <span className={`mea-delta mea-delta-${tone}`}>{fmtSurprisePct(value, digits)}</span>;
}

// ── 1. WEEK PULSE — the top stat strip ────────────────────────────────────────────────────────

export function MeridianEarningsPulse({ rows }: { rows: readonly EarningsAnalyticsRow[] }) {
  const p = useMemo(() => buildWeekPulse(rows), [rows]);
  const beatPct = p.beatRate == null ? "—" : `${Math.round(p.beatRate * 100)}%`;

  return (
    <div className="mea-pulse" aria-label="Earnings window summary">
      <div className="mea-pulse-cell">
        <span className="mea-pulse-value">{p.total}</span>
        <span className="mea-pulse-label">prints in window</span>
      </div>
      <div className="mea-pulse-cell">
        <span className="mea-pulse-value mea-tone-violet">{p.megaCap}</span>
        <span className="mea-pulse-label">importance ≥4</span>
      </div>
      <div className="mea-pulse-cell">
        <span className="mea-pulse-value mea-tone-cyan">{p.confirmed}</span>
        <span className="mea-pulse-label">confirmed dates</span>
      </div>
      <div className="mea-pulse-cell">
        <span className="mea-pulse-value">{p.printed}</span>
        <span className="mea-pulse-label">already printed</span>
      </div>
      <div className="mea-pulse-cell">
        {/* Beat rate is null until something is graded — an ungraded week shows a dash, not 0%. */}
        <span className={`mea-pulse-value ${p.beatRate == null ? "" : p.beatRate >= 0.5 ? "mea-tone-emerald" : "mea-tone-rose"}`}>
          {beatPct}
        </span>
        <span className="mea-pulse-label">EPS beat rate{p.printed > 0 ? ` (${p.beats}/${p.beats + p.misses})` : ""}</span>
      </div>
      <div className="mea-pulse-cell">
        <span className="mea-pulse-value">
          <Delta value={p.medianEpsSurprisePct} />
        </span>
        <span className="mea-pulse-label">median surprise</span>
      </div>
    </div>
  );
}

// ── 2. PRINT CLOCK — what lands in the next 24h ───────────────────────────────────────────────

export function MeridianPrintClock({
  rows,
  nowMs,
  onSelectTicker,
}: {
  rows: readonly EarningsAnalyticsRow[];
  /** Owned by the caller so this component is deterministic and testable. */
  nowMs: number;
  onSelectTicker?: (ticker: string) => void;
}) {
  const clock = useMemo(() => buildPrintClock(rows, nowMs, 24), [rows, nowMs]);

  if (!clock.length) {
    return (
      <p className="mea-empty">
        Nothing prints in the next 24 hours. The window is genuinely quiet — this is not a load failure.
      </p>
    );
  }

  return (
    <ol className="mea-clock" aria-label="Prints in the next 24 hours">
      {clock.map((c) => {
        const imminent = c.minutesUntil != null && c.minutesUntil >= 0 && c.minutesUntil <= 120;
        return (
          <li
            key={`${c.ticker}-${c.date}-${c.time ?? "tbd"}`}
            className={`mea-clock-row${imminent ? " is-imminent" : ""}${c.printed ? " is-printed" : ""}`}
          >
            <button
              type="button"
              className="mea-clock-hit"
              onClick={() => onSelectTicker?.(c.ticker)}
              disabled={!onSelectTicker}
            >
              <span className="mea-clock-when">
                <span className="mea-clock-count">{c.printed ? "printed" : fmtCountdown(c.minutesUntil)}</span>
                <SessionChip session={c.session} />
              </span>
              <span className="mea-clock-id">
                <span className="mea-clock-ticker">{c.ticker}</span>
                {c.company && <span className="mea-clock-co">{c.company}</span>}
              </span>
              <span className="mea-clock-meta">
                <ImportanceMeter value={c.importance} />
                {/* A projected date must never look like a confirmed one. */}
                {!c.confirmed && (
                  <span className="mea-badge mea-badge-projected" title="Date is Benzinga-projected, not confirmed by the company">
                    projected
                  </span>
                )}
                <span className="mea-clock-est">
                  est {c.estimated_eps != null ? c.estimated_eps.toFixed(2) : "—"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ── 3. CALENDAR HEAT GRID — day × volume, shaded by realized surprise ──────────────────────────

/** Shade a day by its mean realized EPS surprise. Unprinted days get NO shade, by design. */
function cellTone(cell: CalendarCell): string {
  const v = cell.avgEpsSurprisePct;
  if (v == null) return "mea-cal-tone-none";
  if (v >= 0.1) return "mea-cal-tone-beat-strong";
  if (v > 0) return "mea-cal-tone-beat";
  if (v === 0) return "mea-cal-tone-flat";
  if (v > -0.1) return "mea-cal-tone-miss";
  return "mea-cal-tone-miss-strong";
}

export function MeridianEarningsCalendar({
  rows,
  onSelectDate,
  selectedDate,
}: {
  rows: readonly EarningsAnalyticsRow[];
  onSelectDate?: (date: string) => void;
  selectedDate?: string | null;
}) {
  const cells = useMemo(() => buildCalendarGrid(rows), [rows]);
  const maxTotal = useMemo(() => cells.reduce((m, c) => Math.max(m, c.total), 0), [cells]);

  if (!cells.length) return <p className="mea-empty">No earnings rows in this window.</p>;

  return (
    <div className="mea-cal" aria-label="Earnings calendar heat grid">
      {cells.map((cell) => {
        const d = new Date(`${cell.date}T12:00:00Z`);
        const dow = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
        const dayNum = d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
        // Bar height encodes VOLUME; colour encodes realized surprise. Two channels, two facts.
        const fill = maxTotal > 0 ? Math.max(6, Math.round((cell.total / maxTotal) * 100)) : 6;
        return (
          <button
            key={cell.date}
            type="button"
            className={`mea-cal-cell ${cellTone(cell)}${selectedDate === cell.date ? " is-selected" : ""}`}
            onClick={() => onSelectDate?.(cell.date)}
            disabled={!onSelectDate}
            title={`${cell.date} — ${cell.total} prints, ${cell.megaCap} at importance ≥4, ${cell.printed} printed${
              cell.avgEpsSurprisePct != null ? `, avg surprise ${fmtSurprisePct(cell.avgEpsSurprisePct)}` : ", nothing printed yet"
            }`}
          >
            <span className="mea-cal-dow">{dow}</span>
            <span className="mea-cal-day">{dayNum}</span>
            <span className="mea-cal-bar" aria-hidden="true">
              <span className="mea-cal-bar-fill" style={{ height: `${fill}%` }} />
            </span>
            <span className="mea-cal-count">{cell.total}</span>
            {cell.megaCap > 0 && <span className="mea-cal-mega">{cell.megaCap}★</span>}
            <span className="mea-cal-sessions" aria-hidden="true">
              {cell.sessions.pre > 0 && <i className="mea-dot mea-dot-pre" title={`${cell.sessions.pre} before open`} />}
              {cell.sessions.post > 0 && <i className="mea-dot mea-dot-post" title={`${cell.sessions.post} after close`} />}
              {cell.sessions.unknown > 0 && <i className="mea-dot mea-dot-unknown" title={`${cell.sessions.unknown} time TBD`} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── 4. SURPRISE SCATTER — EPS vs revenue, quadrant-labelled ────────────────────────────────────

const QUADRANT_LABEL: Record<string, string> = {
  double_beat: "Double beat",
  eps_beat_rev_miss: "EPS beat · rev miss",
  eps_miss_rev_beat: "EPS miss · rev beat",
  double_miss: "Double miss",
};

export function MeridianSurpriseScatter({
  rows,
  onSelectTicker,
}: {
  rows: readonly EarningsAnalyticsRow[];
  onSelectTicker?: (ticker: string) => void;
}) {
  const s = useMemo(() => buildSurpriseScatter(rows), [rows]);
  const [hover, setHover] = useState<ScatterPoint | null>(null);

  if (!s.points.length) {
    return (
      <p className="mea-empty">
        Nothing has printed with both EPS and revenue surprise yet
        {s.pending > 0 ? ` — ${s.pending} still pending` : ""}
        {s.incomplete > 0 ? `, ${s.incomplete} printed without a full surprise pair` : ""}.
      </p>
    );
  }

  // Map a surprise onto 0–100% of the plot box. The origin is dead centre because the bound is
  // symmetric, so a beat and a miss of equal size sit equidistant from the axes.
  const pos = (v: number) => 50 + (v / s.bound) * 50;

  return (
    <div className="mea-scatter-wrap">
      <div className="mea-scatter" role="img" aria-label="EPS surprise versus revenue surprise scatter">
        <span className="mea-scatter-axis mea-scatter-axis-x" aria-hidden="true" />
        <span className="mea-scatter-axis mea-scatter-axis-y" aria-hidden="true" />
        <span className="mea-scatter-q mea-scatter-q-tr">{QUADRANT_LABEL.double_beat} · {s.counts.double_beat}</span>
        <span className="mea-scatter-q mea-scatter-q-br">{QUADRANT_LABEL.eps_beat_rev_miss} · {s.counts.eps_beat_rev_miss}</span>
        <span className="mea-scatter-q mea-scatter-q-tl">{QUADRANT_LABEL.eps_miss_rev_beat} · {s.counts.eps_miss_rev_beat}</span>
        <span className="mea-scatter-q mea-scatter-q-bl">{QUADRANT_LABEL.double_miss} · {s.counts.double_miss}</span>

        {s.points.map((p) => (
          <button
            key={`${p.ticker}-${p.date}`}
            type="button"
            className={`mea-dotpt mea-dotpt-${p.quadrant}${p.importance >= 4 ? " is-mega" : ""}`}
            style={{ left: `${pos(p.eps_surprise_pct)}%`, bottom: `${pos(p.rev_surprise_pct)}%` }}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p)}
            onBlur={() => setHover(null)}
            onClick={() => onSelectTicker?.(p.ticker)}
            title={`${p.ticker} — EPS ${fmtSurprisePct(p.eps_surprise_pct)}, revenue ${fmtSurprisePct(p.rev_surprise_pct)}`}
          >
            <span className="mea-dotpt-label">{p.ticker}</span>
          </button>
        ))}
      </div>

      <div className="mea-scatter-foot">
        <span className="mea-scatter-scale">axis ±{fmtSurprisePct(s.bound, 0)}</span>
        {/* Honesty line: a scatter that hides its omissions reads as a complete week. */}
        {(s.pending > 0 || s.incomplete > 0) && (
          <span className="mea-scatter-omitted">
            not plotted: {s.pending} pending
            {s.incomplete > 0 ? `, ${s.incomplete} missing a surprise axis` : ""}
          </span>
        )}
        {hover && (
          <span className="mea-scatter-hover">
            <strong>{hover.ticker}</strong> EPS <Delta value={hover.eps_surprise_pct} /> · rev{" "}
            <Delta value={hover.rev_surprise_pct} />
          </span>
        )}
      </div>
    </div>
  );
}

// ── 5. BEAT/MISS STREAK RAIL — per-ticker history ──────────────────────────────────────────────

export function MeridianBeatStreak({
  ticker,
  rows,
}: {
  ticker: string;
  rows: readonly EarningsAnalyticsRow[];
}) {
  const s = useMemo(() => buildBeatMissStreak(ticker, rows), [ticker, rows]);

  if (!s.entries.length) {
    return <p className="mea-empty">No printed quarters on record for {ticker}.</p>;
  }

  const streakLabel =
    s.currentStreak === 0
      ? "no streak"
      : `${Math.abs(s.currentStreak)} straight ${s.currentStreak > 0 ? "beat" : "miss"}${Math.abs(s.currentStreak) > 1 ? "es" : ""}`;

  return (
    <div className="mea-streak" aria-label={`${ticker} beat and miss history`}>
      <div className="mea-streak-head">
        <span className="mea-streak-ticker">{ticker}</span>
        <span className={`mea-streak-badge ${s.currentStreak > 0 ? "is-beat" : s.currentStreak < 0 ? "is-miss" : ""}`}>
          {streakLabel}
        </span>
        <span className="mea-streak-rate">
          {s.beatRate == null ? "—" : `${Math.round(s.beatRate * 100)}% beat`}
          <span className="mea-streak-n"> · {s.graded} graded</span>
        </span>
        <span className="mea-streak-avg">
          avg <Delta value={s.avgEpsSurprisePct} />
        </span>
      </div>
      <ol className="mea-streak-rail">
        {s.entries.map((e) => (
          <li
            key={e.date}
            className={`mea-streak-mark ${e.beat === true ? "is-beat" : e.beat === false ? "is-miss" : "is-ungraded"}`}
            title={`${e.fiscal ?? e.date} — EPS ${fmtSurprisePct(e.eps_surprise_pct)}${
              e.beat === null ? " (no surprise recorded — ungraded, not a miss)" : ""
            }`}
          >
            <span className="mea-streak-mark-bar" style={{ height: `${Math.min(100, 20 + Math.abs((e.eps_surprise_pct ?? 0) * 200))}%` }} />
            <span className="mea-streak-mark-label">{e.fiscal?.split(" ")[0] ?? "?"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── 6. PRINT TABLE — the dense, sortable ledger ────────────────────────────────────────────────

type SortKey = "date" | "importance" | "eps_surprise" | "rev_surprise" | "ticker";

export function MeridianEarningsTable({
  rows,
  onSelectTicker,
}: {
  rows: readonly EarningsAnalyticsRow[];
  onSelectTicker?: (ticker: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>("date");
  const [desc, setDesc] = useState(false);
  const [onlyMega, setOnlyMega] = useState(false);
  const [onlyPrinted, setOnlyPrinted] = useState(false);

  const view = useMemo(() => {
    let list = [...rows];
    if (onlyMega) list = list.filter((r) => (r.importance ?? 0) >= 4);
    if (onlyPrinted) list = list.filter(hasPrinted);
    // Nulls always sort LAST regardless of direction — an unknown is not "the smallest value",
    // and letting it float to the top of a desc sort buries the real leaders.
    const cmp = (a: EarningsAnalyticsRow, b: EarningsAnalyticsRow): number => {
      const num = (x: number | null | undefined) => (x != null && Number.isFinite(x) ? x : null);
      switch (sort) {
        case "ticker":
          return a.ticker.localeCompare(b.ticker);
        case "importance":
          return (b.importance ?? 0) - (a.importance ?? 0);
        case "eps_surprise":
        case "rev_surprise": {
          const av = num(sort === "eps_surprise" ? a.eps_surprise_pct : a.revenue_surprise_pct);
          const bv = num(sort === "eps_surprise" ? b.eps_surprise_pct : b.revenue_surprise_pct);
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return bv - av;
        }
        default:
          return a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker);
      }
    };
    list.sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
    return list;
  }, [rows, sort, desc, onlyMega, onlyPrinted]);

  const head = (key: SortKey, label: string, cls = "") => (
    <th
      className={`mea-th ${cls}${sort === key ? " is-sorted" : ""}`}
      onClick={() => {
        if (sort === key) setDesc((d) => !d);
        else {
          setSort(key);
          setDesc(false);
        }
      }}
      aria-sort={sort === key ? (desc ? "descending" : "ascending") : "none"}
      scope="col"
    >
      {label}
      <span className="mea-th-caret" aria-hidden="true">{sort === key ? (desc ? "▾" : "▴") : ""}</span>
    </th>
  );

  return (
    <div className="mea-table-wrap">
      <div className="mea-table-controls">
        <button type="button" className={`mea-toggle${onlyMega ? " is-on" : ""}`} onClick={() => setOnlyMega((v) => !v)}>
          Importance ≥4
        </button>
        <button type="button" className={`mea-toggle${onlyPrinted ? " is-on" : ""}`} onClick={() => setOnlyPrinted((v) => !v)}>
          Printed only
        </button>
        <span className="mea-table-count">{view.length} of {rows.length}</span>
      </div>
      {/* Wide table scrolls INSIDE its own container so the desk never scrolls sideways. */}
      <div className="mea-table-scroll">
        <table className="mea-table">
          <thead>
            <tr>
              {head("date", "Date")}
              {head("ticker", "Ticker")}
              <th className="mea-th" scope="col">When</th>
              {head("importance", "Imp")}
              <th className="mea-th mea-num" scope="col">Est EPS</th>
              <th className="mea-th mea-num" scope="col">Act EPS</th>
              {head("eps_surprise", "EPS surp", "mea-num")}
              <th className="mea-th mea-num" scope="col">Revenue</th>
              {head("rev_surprise", "Rev surp", "mea-num")}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const printed = hasPrinted(r);
              return (
                <tr
                  key={`${r.ticker}-${r.date}-${r.fiscal_period ?? ""}`}
                  className={`mea-tr${printed ? " is-printed" : " is-pending"}`}
                  onClick={() => onSelectTicker?.(r.ticker)}
                >
                  <td className="mea-td mea-td-date">
                    {r.date}
                    {(r.date_status ?? "").toLowerCase() !== "confirmed" && (
                      <span className="mea-badge mea-badge-projected" title="Benzinga-projected date, not company-confirmed">P</span>
                    )}
                  </td>
                  <td className="mea-td mea-td-ticker">
                    <span className="mea-tk">{r.ticker}</span>
                    {r.fiscal_period && r.fiscal_year && (
                      <span className="mea-fiscal">{r.fiscal_period} {r.fiscal_year}</span>
                    )}
                  </td>
                  <td className="mea-td"><SessionChip session={classifyPrintSession(r.time)} /></td>
                  <td className="mea-td"><ImportanceMeter value={r.importance ?? 0} /></td>
                  <td className="mea-td mea-num">{r.estimated_eps != null ? r.estimated_eps.toFixed(2) : "—"}</td>
                  <td className="mea-td mea-num">{r.actual_eps != null ? r.actual_eps.toFixed(2) : "—"}</td>
                  <td className="mea-td mea-num"><Delta value={r.eps_surprise_pct} /></td>
                  <td className="mea-td mea-num">{fmtCompactMoney(r.actual_revenue ?? r.estimated_revenue)}</td>
                  <td className="mea-td mea-num"><Delta value={r.revenue_surprise_pct} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
