"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { PlayTerminal, etClock } from "./PlayTerminal";
import { sortPlaysForDeckBy, type DeckSortMode } from "./deck-sort";
import {
  deployedRisk,
  sessionTape,
  workingTickersOf,
  type CockpitAllocation,
} from "./cockpit";
import { condorTent } from "@/lib/zerodte/condor-render";
import { isZeroDteMarkStale, ZERODTE_MARK_STALE_MS, LEGACY_QUOTE_STALE_MS } from "@/lib/zerodte/marks-math";
import type { TerminalPlay } from "./types";
import {
  defaultZeroDteStatusFilter,
  preferredPlayId,
  type DeckSessionHeatState,
  type DeckStatusFilter,
} from "./deck-session-ui";
import { etNowParts } from "@/features/nighthawk/lib/session";
import { useSecondTick, useFlash } from "./use-deck-live";
import {
  formatReturnPct,
  originChip,
  playGradeLabel,
  playQualityPct,
  primaryReturnPct,
  tierStars,
  useEnhancedZeroDteRow,
  useHeroPlayCard,
} from "./play-card-display";
import {
  buildDeckCommandCenterStats,
  convictionRankContext,
  formatWinRate30d,
} from "./deck-command-center";

/** Status filter mode: which plays to show in the list. */
type StatusFilter = DeckStatusFilter;

function filterByStatus(plays: TerminalPlay[], filter: StatusFilter): TerminalPlay[] {
  if (filter === "ALL") return plays;
  if (filter === "OPEN") return plays.filter((p) => p.status === "OPEN" || p.status === "HOLD" || p.status === "TRIM");
  if (filter === "WATCH") return plays.filter((p) => p.status === "WATCH" || p.status === "SKIP");
  return plays.filter((p) => p.status === "CLOSED");
}

/**
 * COMMAND DECK — the two-panel matrix experience for every board (0DTE / Swings / LEAPS / Legacy).
 * Left: the ranked plays list + the Wave-2 cockpit (live portfolio-risk strip + session P&L tape).
 * Right: the terminal that breaks the selected play down (Thesis / Management / PnL) and streams live.
 * One component, fed a TerminalPlay[] by each board's adapter — the whole point of the
 * HorizonPlay/explainability/allocation unification.
 */
export function CommandDeck({
  plays,
  laneLabel,
  emptyHint,
  degraded = false,
  loading = false,
  allocation,
  sessionHeat = null,
  commandCenter = false,
  winRate30d = null,
}: {
  plays: TerminalPlay[];
  laneLabel: string;
  /** Shown when the lane has no plays (e.g. Swings/LEAPS before discovery, or a flat 0DTE tape). */
  emptyHint?: string;
  /** True when the board data is unavailable/degraded — renders a distinct warning so an outage is never
   *  painted as a calm flat tape (9-3). */
  degraded?: boolean;
  /** True while the first fetch is in progress — shows skeleton rows instead of the empty hint. */
  loading?: boolean;
  /** The payload's Portfolio Allocation Engine decisions — feeds the cockpit R-deployed strip. Absent
   *  for lanes that don't allocate (Swings/LEAPS/Legacy) → the strip degrades to "—". */
  allocation?: CockpitAllocation[] | null;
  /** Board `session.heat.state` — drives default filter + right-rail LIVE/CLOSED honesty. */
  sessionHeat?: DeckSessionHeatState;
  /** 0DTE only — replace the "X of Y" header with the command-center stat strip. */
  commandCenter?: boolean;
  /** 30d as-managed win rate from `/api/market/zerodte/record` — null when unavailable. */
  winRate30d?: number | null;
}) {
  // Counts per status group for the filter badges (and the session-aware default filter).
  const counts = useMemo(() => {
    let open = 0, watch = 0, closed = 0;
    for (const p of plays) {
      if (p.status === "OPEN" || p.status === "HOLD" || p.status === "TRIM") open++;
      else if (p.status === "CLOSED") closed++;
      else watch++;
    }
    return { open, watch, closed };
  }, [plays]);

  // Status filter: RTH defaults to OPEN/WATCH (actionable); after close defaults to ALL.
  // Seed once from the first non-empty board so a later heat flip doesn't yank the member's lens.
  const { hour, minute } = etNowParts();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [filterSeeded, setFilterSeeded] = useState(false);
  useEffect(() => {
    if (filterSeeded || plays.length === 0) return;
    setStatusFilter(
      defaultZeroDteStatusFilter({
        heatState: sessionHeat,
        open: counts.open,
        watch: counts.watch,
        etMinutes: hour * 60 + minute,
      }),
    );
    setFilterSeeded(true);
  }, [filterSeeded, plays.length, sessionHeat, counts.open, counts.watch, hour, minute]);

  const filtered = useMemo(() => filterByStatus(plays, statusFilter), [plays, statusFilter]);

  // Sort lens: the status banding (default) or the Wave-2 conviction ranking. Additive — the status
  // sort is unchanged; conviction is a second view over the SAME list (deck-sort.ts).
  const [sortMode, setSortMode] = useState<DeckSortMode>("status");
  const sorted = useMemo(() => sortPlaysForDeckBy(filtered, sortMode), [filtered, sortMode]);

  // Cockpit figures — computed off the FULL board (not the display order), so they're identical under
  // either sort. Both auto-update on the SWR board refresh that replaces `plays`.
  const risk = useMemo(
    () => deployedRisk(allocation ?? null, workingTickersOf(plays)),
    [allocation, plays],
  );
  const tape = useMemo(() => sessionTape(plays), [plays]);

  const [selId, setSelId] = useState<string | null>(null);

  // Keep a valid selection as the polled list changes: prefer working → watch → closed on first
  // pick so a CLOSED row doesn't monopolize the right rail when WATCH setups exist.
  useEffect(() => {
    if (sorted.length === 0) {
      if (selId !== null) setSelId(null);
    } else if (!sorted.some((p) => p.id === selId)) {
      setSelId(preferredPlayId(sorted) ?? sorted[0]!.id);
    } else if (selId === null) {
      setSelId(preferredPlayId(sorted) ?? sorted[0]!.id);
    }
  }, [sorted, selId]);

  const selected = sorted.find((p) => p.id === selId) ?? null;
  const sessionClosed = String(sessionHeat ?? "").toUpperCase() === "CLOSED";
  const nowMs = useSecondTick();
  const cmdStats = useMemo(
    () => (commandCenter ? buildDeckCommandCenterStats(plays) : null),
    [commandCenter, plays],
  );
  const convictionRank = useMemo(
    () => (selected && commandCenter ? convictionRankContext(plays, selected.id) : null),
    [commandCenter, plays, selected],
  );

  return (
    <div className="nh-deck">
      <div className="nh-deck-left">
        {commandCenter ? (
          <DeckCommandCenter
            laneLabel={laneLabel}
            degraded={degraded}
            stats={cmdStats}
            winRate30d={winRate30d}
          />
        ) : (
          <div className="nh-deck-lh">
            <span>{laneLabel}</span>
            <span>
              {degraded
                ? "data down"
                : statusFilter === "ALL"
                  ? `${plays.length} plays`
                  : `${filtered.length} of ${plays.length}`}
            </span>
          </div>
        )}
        <CockpitStrip risk={risk} tape={tape} />
        <div className="nh-deck-chrome-row">
        <div className="nh-deck-filterbar" role="group" aria-label="Filter plays by status">
          <button type="button" className={clsx("nh-deck-filtbtn", statusFilter === "ALL" && "on")} onClick={() => setStatusFilter("ALL")}>ALL <span className="cnt">{plays.length}</span></button>
          <button type="button" className={clsx("nh-deck-filtbtn", statusFilter === "OPEN" && "on")} onClick={() => setStatusFilter("OPEN")}>OPEN <span className="cnt">{counts.open}</span></button>
          <button type="button" className={clsx("nh-deck-filtbtn", statusFilter === "WATCH" && "on")} onClick={() => setStatusFilter("WATCH")}>WATCH <span className="cnt">{counts.watch}</span></button>
          <button type="button" className={clsx("nh-deck-filtbtn", statusFilter === "CLOSED" && "on")} onClick={() => setStatusFilter("CLOSED")}>CLOSED <span className="cnt">{counts.closed}</span></button>
        </div>
        <div className="nh-deck-sortbar" role="group" aria-label="Sort plays">
          <button type="button" className={clsx("nh-deck-sortbtn", sortMode === "status" && "on")} onClick={() => setSortMode("status")}>STATUS</button>
          <button type="button" className={clsx("nh-deck-sortbtn", sortMode === "conviction" && "on")} onClick={() => setSortMode("conviction")}>CONVICTION</button>
        </div>
        </div>
        <div className="nh-deck-rows">
          {degraded && (
            <div className="nh-deck-degraded" role="alert">⚠ Board data unavailable — retrying</div>
          )}
          {loading && plays.length === 0 && (
            <div className="nh-deck-loading">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="nh-deck-skel" aria-hidden>
                  <div className="nh-skel-bar" style={{ width: "40%" }} />
                  <div className="nh-skel-bar" style={{ width: "70%" }} />
                  <div className="nh-skel-bar" style={{ width: "55%" }} />
                </div>
              ))}
            </div>
          )}
          {!loading && plays.length === 0 && (
            <div className="nh-deck-empty">{emptyHint ?? "No plays right now."}</div>
          )}
          {!loading && plays.length > 0 && filtered.length === 0 && (
            <div className="nh-deck-empty">No {statusFilter.toLowerCase()} plays right now.</div>
          )}
          {sorted.map((p, i) => (
            <PlayCard key={p.id} play={p} rank={i + 1} selected={p.id === selId} onSelect={setSelId} nowMs={nowMs} />
          ))}
        </div>
      </div>
      <PlayTerminal
        play={selected}
        sessionClosed={sessionClosed}
        nowMs={nowMs}
        convictionRank={convictionRank}
      />
    </div>
  );
}

/** 0DTE left-rail command center — today's opportunity set at a glance. */
function DeckCommandCenter({
  laneLabel,
  degraded,
  stats,
  winRate30d,
}: {
  laneLabel: string;
  degraded: boolean;
  stats: ReturnType<typeof buildDeckCommandCenterStats> | null;
  winRate30d: number | null;
}) {
  const topLine = stats?.topRated
    ? `${stats.topRated.ticker} (${stats.topRated.grade})`
    : "—";
  const edge = degraded ? null : stats?.edge ?? null;
  return (
    <div className="nh-deck-cmd" aria-label="Today's command center">
      <div className="nh-deck-cmd-lane">{laneLabel}</div>
      <div className="nh-deck-cmd-grid">
        <div className="nh-deck-cmd-stat">
          <span className="nh-deck-cmd-lab">Today&apos;s Opportunities</span>
          <span className="nh-deck-cmd-val">{degraded ? "—" : stats?.opportunities ?? 0}</span>
        </div>
        <div className="nh-deck-cmd-stat">
          <span className="nh-deck-cmd-lab">Top Rated</span>
          <span className="nh-deck-cmd-val nh-deck-cmd-top">{degraded ? "—" : topLine}</span>
        </div>
        <div className="nh-deck-cmd-stat">
          <span className="nh-deck-cmd-lab">Win Rate (30d)</span>
          <span className="nh-deck-cmd-val">{degraded ? "—" : formatWinRate30d(winRate30d)}</span>
        </div>
        <div className="nh-deck-cmd-stat">
          <span className="nh-deck-cmd-lab">Today&apos;s Edge</span>
          <span className={clsx("nh-deck-cmd-val", edge && `edge-${edge.toLowerCase()}`)}>
            {degraded ? "—" : edge ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The live portfolio cockpit: R deployed vs the allocator limit + the running session P&L tape. Both
 *  degrade to "—" when their inputs aren't on the payload (never a fabricated figure).
 *
 * Memoized: CommandDeck re-renders every 1000ms on useSecondTick (nowMs, needed by PlayCard's
 * staleness/age display) — this strip depends on neither, so memo bails it out of that churn.
 */
const CockpitStrip = memo(function CockpitStrip({
  risk,
  tape,
}: {
  risk: ReturnType<typeof deployedRisk>;
  tape: ReturnType<typeof sessionTape>;
}) {
  const riskFrac = risk && risk.limitR > 0 ? Math.max(0, Math.min(1, risk.deployedR / risk.limitR)) : 0;
  const total = tape.empty ? null : tape.totalR;
  const totalCls = total == null ? "" : total > 0 ? "nh-deck-pos" : total < 0 ? "nh-deck-neg" : "";
  return (
    <div className="nh-deck-cockpit">
      <div className="nh-deck-ck">
        <div className="ckh">RISK DEPLOYED</div>
        {risk ? (
          <>
            <div className="ckv"><b>{risk.deployedR.toFixed(1)}</b> <span className="dim">/ {risk.limitR.toFixed(1)} R</span></div>
            <div className="ckbar"><i style={{ width: `${Math.round(riskFrac * 100)}%` }} /></div>
          </>
        ) : (
          <div className="ckv dim" title="Allocator book not on this payload">—</div>
        )}
      </div>
      <div className="nh-deck-ck">
        <div className="ckh">SESSION P&amp;L</div>
        {total == null ? (
          <div className="ckv dim" title="No entered plays yet this session">—</div>
        ) : (
          <>
            <div className={clsx("ckv", totalCls)}><b>{total > 0 ? "+" : ""}{total.toFixed(1)} R</b></div>
            <div className="cksub">
              realized {tape.realizedR > 0 ? "+" : ""}{tape.realizedR.toFixed(1)} · open {tape.openR > 0 ? "+" : ""}{tape.openR.toFixed(1)}
            </div>
          </>
        )}
      </div>
    </div>
  );
});

/** A compact condor breach indicator for the left card — room to the nearest short strike (points),
 *  colored by health (red once the range is breached). Never shows a directional premium P&L. */
function CondorCardChip({ play }: { play: TerminalPlay }) {
  const c = play.condor;
  if (!c) return null;
  const tent = condorTent(
    {
      spot: c.spot, short_put: c.shortPut, long_put: c.longPut, short_call: c.shortCall,
      long_call: c.longCall, wing_pts: c.wingPts, net_credit: c.netCredit, max_loss: c.maxLoss,
      breach_lower: c.breachLower, breach_upper: c.breachUpper,
      est_win_rate: c.winRate, est_intraday_breach_pct: c.breachRatePct,
    },
    c.spot,
  );
  if (tent.spotFrac == null) {
    // No live/commit spot to place — still flag the row as a condor with its tent width.
    return <span className="nh-deck-cchip" title="Iron condor — spot unavailable">◇ CONDOR</span>;
  }
  const nearest = Math.min(tent.roomDown ?? Infinity, tent.roomUp ?? Infinity);
  return (
    <span className={clsx("nh-deck-cchip", tent.breached ? "brk" : "ok")} title="Iron condor — room to nearest short strike">
      ◇ {tent.breached ? "BREACHED" : `${nearest.toFixed(0)}pt`}
    </span>
  );
}

/** Radial thesis-health ring around the rank — 0–100 arc, color by rung. */
function HealthRing({ health, rung }: { health: number; rung: string }) {
  const pct = Math.max(0, Math.min(100, health));
  const r = 14;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const cls = health >= 75 ? "ok" : health >= 45 ? "warn" : "brk";
  return (
    <svg className={clsx("nh-deck-health-ring", cls)} viewBox="0 0 36 36" aria-hidden>
      <circle className="track" cx="18" cy="18" r={r} />
      <circle className="arc" cx="18" cy="18" r={r} strokeDasharray={`${dash} ${c}`} />
      <title>{`Thesis health ${health}% · ${rung}`}</title>
    </svg>
  );
}

/** Visible rank identity for 0DTE rows — #N, letter grade, star row (never fabricated). */
function PlayRankLead({
  rank,
  grade,
  compact = false,
}: {
  rank: number;
  grade: string | null;
  /** Compact left-rail stack vs hero-grade block. */
  compact?: boolean;
}) {
  const stars = grade ? tierStars(grade) : "";
  if (compact) {
    return (
      <span className="nh-deck-rank-stack" aria-label={grade ? `Rank ${rank}, grade ${grade}` : `Rank ${rank}`}>
        <span className="nh-deck-rank-num">#{rank}</span>
        {grade ? (
          <>
            <span className="nh-deck-grade-lead">{grade}</span>
            {stars && <span className="nh-deck-grade-stars nh-deck-grade-stars-lead" aria-hidden>{stars}</span>}
          </>
        ) : (
          <span className="nh-deck-grade-lead dim">—</span>
        )}
      </span>
    );
  }
  return (
    <>
      <span className="nh-deck-rank-num nh-deck-rank-num-hero">#{rank}</span>
      {grade ? (
        <>
          <span className="nh-deck-grade-badge">{grade}</span>
          {stars && <span className="nh-deck-grade-stars" aria-hidden>{stars}</span>}
        </>
      ) : (
        <span className="nh-deck-grade-badge dim">—</span>
      )}
    </>
  );
}

/** One left-pane play card. Wave 2 surfaces the tier + discovery-origin badges, the mid mark + its
 *  executable-fill P&L, and honest staleness (dim + age) — all reading the Wave-1 payload fields.
 *
 * Memoized: CommandDeck re-renders every 1000ms (useSecondTick, needed here for staleness/age), and
 * without memo every row re-executed on every tick regardless of whether its OWN play data changed.
 * `onSelect` takes the play id (rather than the parent handing each row a fresh `() => setSelId(id)`
 * closure) so the parent can pass the stable `setSelId` setter directly — a fresh closure per row per
 * tick would otherwise defeat this memoization outright. */
export const PlayCard = memo(function PlayCard({
  play: p,
  rank,
  selected,
  onSelect,
  nowMs,
}: {
  play: TerminalPlay;
  rank: number;
  selected: boolean;
  onSelect: (id: string) => void;
  nowMs: number;
}) {
  const markFlash = useFlash(p.mark ?? p.pnlPct ?? null);

  const asOfMs = p.markAsOf ? Date.parse(p.markAsOf) : NaN;
  const hasAsOf = Number.isFinite(asOfMs);
  const staleThresholdMs = p.horizon === "LEGACY" ? LEGACY_QUOTE_STALE_MS : ZERODTE_MARK_STALE_MS;
  const stale = hasAsOf ? isZeroDteMarkStale(asOfMs, nowMs, staleThresholdMs) : false;

  const isCondor = p.isCondor === true;
  const showThRing =
    p.thesisHealth != null && (p.status === "OPEN" || p.status === "HOLD" || p.status === "TRIM");

  const hero = useHeroPlayCard(p, selected, rank);
  const enhanced = useEnhancedZeroDteRow(p);
  const grade = playGradeLabel(p);
  const quality = playQualityPct(p);
  const ret = primaryReturnPct(p);
  const origin = originChip(p);

  if (hero) {
    return (
      <button
        type="button"
        className={clsx(
          "nh-deck-row nh-deck-row-hero",
          stale && "nh-deck-card-stale",
          markFlash && "nh-deck-row-flash",
        )}
        onClick={() => onSelect(p.id)}
        aria-current={selected}
      >
        {rank === 1 && (
          <div className="nh-deck-hero-banner" aria-hidden>
            BEST PLAY TODAY
          </div>
        )}
        <div className="nh-deck-hero-top">
          <div className="nh-deck-hero-grade">
            <PlayRankLead rank={rank} grade={grade} />
            {quality != null && (
              <span className="nh-deck-quality">
                Confidence <b>{quality}%</b>
              </span>
            )}
          </div>
          <div className="nh-deck-hero-metric">
            {ret != null ? (
              <>
                <span
                  className={clsx(
                    "nh-deck-hero-pct",
                    ret > 0 && "nh-deck-pos",
                    ret < 0 && "nh-deck-neg",
                  )}
                >
                  {ret > 0 ? "▲ " : ret < 0 ? "▼ " : ""}
                  {formatReturnPct(ret)}
                </span>
                <span className="nh-deck-hero-pct-lab">
                  {p.status === "CLOSED" ? "Peak Return" : "Live P&L"}
                </span>
              </>
            ) : (
              <span className="nh-deck-hero-pct dim">—</span>
            )}
          </div>
        </div>
        <div className="nh-deck-hero-mid">
          <span className="nh-deck-hero-tk">{p.ticker}</span>
          <span className={clsx("nh-deck-dp", p.direction === "LONG" ? "long" : "short")}>
            {p.direction}
          </span>
          <span className="nh-deck-hero-contract">{p.contract}</span>
        </div>
        <div className="nh-deck-hero-divider" aria-hidden />
        <div className="nh-deck-hero-foot">
          <span className={clsx("nh-deck-st", p.status)}>{p.status}</span>
          {p.firstFlaggedAt && (
            <span className="nh-deck-cbadge time">{etClock(p.firstFlaggedAt)} ET</span>
          )}
          {origin && <span className="nh-deck-cbadge orig">{origin}</span>}
          {isCondor && <CondorCardChip play={p} />}
        </div>
        <div className="nh-deck-hero-cta">Tap to inspect →</div>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={clsx(
        "nh-deck-row",
        selected && "sel",
        enhanced && "nh-deck-row-enhanced",
        stale && "nh-deck-card-stale",
        markFlash && "nh-deck-row-flash",
      )}
      onClick={() => onSelect(p.id)}
      aria-current={selected}
      style={enhanced && quality != null ? { ["--nh-quality" as string]: `${quality}%` } : undefined}
    >
      <span className={clsx("nh-deck-rk-wrap", enhanced && "nh-deck-rank-lead")}>
        {showThRing && (
          <HealthRing health={p.thesisHealth!.health} rung={p.thesisHealth!.rungLabel} />
        )}
        {enhanced ? (
          <PlayRankLead rank={rank} grade={grade} compact />
        ) : (
          <span className="nh-deck-rk">{rank}</span>
        )}
      </span>
      <span className="nh-deck-row-body">
        {enhanced ? (
          <>
            <span className="nh-deck-row-meta">
              <span className="nh-deck-tk">{p.ticker}</span>
              <span className={clsx("nh-deck-dp", p.direction === "LONG" ? "long" : "short")}>
                {p.direction}
              </span>
              {quality != null && (
                <span className="nh-deck-quality-inline">{quality}%</span>
              )}
            </span>
            <span className="nh-deck-sub">{p.contract}</span>
            {origin && <span className="nh-deck-origin-pill">{origin}</span>}
          </>
        ) : (
          <>
            <span className="nh-deck-row-head">
              <span className="nh-deck-tk">{p.ticker}</span>
              <span className={clsx("nh-deck-dp", p.direction === "LONG" ? "long" : "short")}>
                {p.direction}
              </span>
            </span>
            <span className="nh-deck-sub">{p.contract}</span>
          </>
        )}
        {enhanced && <span className="nh-deck-row-divider" aria-hidden />}
        <span className="nh-deck-cardbadges">
          <span className={clsx("nh-deck-st", p.status)}>{p.status}</span>
          {p.firstFlaggedAt && (
            <span className="nh-deck-cbadge time" title="Time this play was first flagged">
              {etClock(p.firstFlaggedAt)} ET
            </span>
          )}
          {enhanced && origin && <span className="nh-deck-cbadge orig">{origin}</span>}
          {isCondor && <CondorCardChip play={p} />}
        </span>
      </span>
      <span className="nh-deck-rr">
        {p.status === "CLOSED" && p.peak != null ? (
          <>
            <span
              className={clsx(
                "nh-deck-prem nh-deck-prem-lg",
                p.peak > 0 && "nh-deck-pos",
                p.peak < 0 && "nh-deck-neg",
              )}
            >
              {p.peak > 0 ? "▲ " : ""}
              {formatReturnPct(p.peak)}
            </span>
            <span className="nh-deck-premlab">Peak Return</span>
          </>
        ) : p.horizon === "LEGACY" && p.stockPrice != null ? (
          <>
            <span className="nh-deck-prem" style={{ display: "block" }}>
              ${p.stockPrice.toFixed(2)}
            </span>
            <span className="nh-deck-premlab">{p.pnlPct != null ? "P&L" : "STOCK"}</span>
            <span
              className={clsx(
                "nh-deck-pnl",
                (p.pnlPct ?? p.stockChangePct ?? 0) > 0 && "nh-deck-pos",
                (p.pnlPct ?? p.stockChangePct ?? 0) < 0 && "nh-deck-neg",
              )}
              style={{ display: "block" }}
            >
              {p.pnlPct != null
                ? `${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(1)}%`
                : p.stockChangePct != null
                  ? `${p.stockChangePct >= 0 ? "+" : ""}${p.stockChangePct.toFixed(1)}%`
                  : "—"}
            </span>
          </>
        ) : (
          <>
            <span className="nh-deck-prem nh-deck-prem-lg" style={{ display: "block" }}>
              {p.mark != null || p.entry != null
                ? `$${(p.mark != null ? p.mark : p.entry!).toFixed(2)}`
                : "—"}
            </span>
            <span className="nh-deck-premlab">{isCondor ? "MARK" : "MID"}</span>
            <span
              className={clsx(
                "nh-deck-pnl nh-deck-pnl-lg",
                (p.pnlPct ?? 0) > 0 && "nh-deck-pos",
                (p.pnlPct ?? 0) < 0 && "nh-deck-neg",
                markFlash && "neon",
              )}
              style={{ display: "block" }}
            >
              {p.pnlPct != null && p.pnlPct !== 0
                ? `${p.pnlPct > 0 ? "▲ " : ""}${formatReturnPct(p.pnlPct)}`
                : "—"}
            </span>
          </>
        )}
      </span>
    </button>
  );
});
