"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { PlayTerminal } from "./PlayTerminal";
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

/** Status filter mode: which plays to show in the list. */
type StatusFilter = "ALL" | "OPEN" | "WATCH" | "CLOSED";

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
}) {
  // Status filter: show ALL (default), only OPEN (working), WATCH (pre-entry), or CLOSED plays.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const filtered = useMemo(() => filterByStatus(plays, statusFilter), [plays, statusFilter]);

  // Counts per status group for the filter badges.
  const counts = useMemo(() => {
    let open = 0, watch = 0, closed = 0;
    for (const p of plays) {
      if (p.status === "OPEN" || p.status === "HOLD" || p.status === "TRIM") open++;
      else if (p.status === "CLOSED") closed++;
      else watch++;
    }
    return { open, watch, closed };
  }, [plays]);

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

  const [selId, setSelId] = useState<string | null>(sorted[0]?.id ?? null);

  // Keep a valid selection as the polled list changes: default to the top (sorted) play; drop a stale
  // selection. Membership is checked against the same play objects, so ordering doesn't affect validity.
  useEffect(() => {
    if (sorted.length === 0) {
      if (selId !== null) setSelId(null);
    } else if (!sorted.some((p) => p.id === selId)) {
      setSelId(sorted[0]!.id);
    }
  }, [sorted, selId]);

  const selected = sorted.find((p) => p.id === selId) ?? null;

  return (
    <div className="nh-deck">
      <div className="nh-deck-left">
        <div className="nh-deck-lh"><span>{laneLabel}</span><span>{degraded ? "data down" : statusFilter === "ALL" ? `${plays.length} plays` : `${filtered.length} of ${plays.length}`}</span></div>
        <CockpitStrip risk={risk} tape={tape} />
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
            <PlayCard key={p.id} play={p} rank={i + 1} selected={p.id === selId} onSelect={() => setSelId(p.id)} />
          ))}
        </div>
      </div>
      <PlayTerminal play={selected} />
    </div>
  );
}

/** The live portfolio cockpit: R deployed vs the allocator limit + the running session P&L tape. Both
 *  degrade to "—" when their inputs aren't on the payload (never a fabricated figure). */
function CockpitStrip({
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
}

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

/** One left-pane play card. Wave 2 surfaces the tier + discovery-origin badges, the mid mark + its
 *  executable-fill P&L, and honest staleness (dim + age) — all reading the Wave-1 payload fields. */
function PlayCard({
  play: p,
  rank,
  selected,
  onSelect,
}: {
  play: TerminalPlay;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  // A 1s local clock so a stale card's age readout advances even between the 5s board poll. One
  // interval per card is fine (≤16 rows); it only re-renders this small button.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const asOfMs = p.markAsOf ? Date.parse(p.markAsOf) : NaN;
  const hasAsOf = Number.isFinite(asOfMs);
  const staleThresholdMs = p.horizon === "LEGACY" ? LEGACY_QUOTE_STALE_MS : ZERODTE_MARK_STALE_MS;
  const stale = hasAsOf ? isZeroDteMarkStale(asOfMs, now, staleThresholdMs) : false;
  const ageMs = hasAsOf ? Math.max(0, now - asOfMs) : null;
  const ageLabel =
    ageMs == null ? null : ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s` : `${Math.round(ageMs / 60_000)}m`;

  const isCondor = p.isCondor === true;
  // Mid mark (the live/entry premium the card leads with) + the executable P&L. A CONDOR is a credit
  // structure — the directional "sell into the bid" fill P&L is inverted for it, so the card shows its
  // decay P&L (pnlPct) only, never a directional exec line.
  const showExec = !isCondor && p.execPnlPct != null;

  return (
    <button
      type="button"
      className={clsx("nh-deck-row", selected && "sel", stale && "nh-deck-card-stale")}
      onClick={onSelect}
      aria-current={selected}
    >
      <span className="nh-deck-rk">{rank}</span>
      <span>
        <span>
          <span className="nh-deck-tk">{p.ticker}</span>{" "}
          <span className={clsx("nh-deck-dp", p.direction === "LONG" ? "long" : "short")}>{p.direction}</span>
        </span>
        <span className="nh-deck-sub" style={{ display: "block" }}>{p.contract}</span>
        <span className="nh-deck-cardbadges">
          <span className={clsx("nh-deck-st", p.status)}>{p.status}</span>
          {p.tierLabel && <span className="nh-deck-cbadge tier">{p.tierLabel}</span>}
          {p.discoveryOrigin?.[0] && <span className="nh-deck-cbadge orig">{p.discoveryOrigin[0]}</span>}
          {p.horizon === "LEGACY" && p.morningStatus === "CONFIRMED" && <span className="nh-deck-cbadge conf">CONFIRMED</span>}
          {p.horizon === "LEGACY" && p.morningStatus === "DEGRADED" && <span className="nh-deck-cbadge warn">DEGRADED</span>}
          {p.horizon === "LEGACY" && p.morningStatus === "INVALIDATED" && <span className="nh-deck-cbadge brk">INVALIDATED</span>}
          {p.horizon === "LEGACY" && p.morningStatus === "UNVERIFIED" && <span className="nh-deck-cbadge pending">PENDING</span>}
          {isCondor && <CondorCardChip play={p} />}
          {stale && <span className="nh-deck-cbadge stale" title="Mark is stale — frozen">◷ {ageLabel}</span>}
        </span>
      </span>
      <span className="nh-deck-rr">
        {p.horizon === "LEGACY" && p.stockPrice != null ? (
          <>
            <span className="nh-deck-prem" style={{ display: "block" }}>
              ${p.stockPrice.toFixed(2)}
            </span>
            <span className="nh-deck-premlab">{p.pnlPct != null ? "P&L" : "STOCK"}</span>
            <span className={clsx("nh-deck-pnl", (p.pnlPct ?? p.stockChangePct ?? 0) > 0 && "nh-deck-pos", (p.pnlPct ?? p.stockChangePct ?? 0) < 0 && "nh-deck-neg")} style={{ display: "block" }}>
              {p.pnlPct != null
                ? `${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(1)}%`
                : p.stockChangePct != null ? `${p.stockChangePct >= 0 ? "+" : ""}${p.stockChangePct.toFixed(1)}%` : "—"}
            </span>
          </>
        ) : (
          <>
            <span className="nh-deck-prem" style={{ display: "block" }}>
              {p.mark != null || p.entry != null
                ? `$${(p.mark != null ? p.mark : p.entry!).toFixed(2)}`
                : "—"}
            </span>
            <span className="nh-deck-premlab">{isCondor ? "MARK" : "MID"}</span>
            <span className={clsx("nh-deck-pnl", (p.pnlPct ?? 0) > 0 && "nh-deck-pos", (p.pnlPct ?? 0) < 0 && "nh-deck-neg")} style={{ display: "block" }}>
              {p.pnlPct != null && p.pnlPct !== 0 ? `${p.pnlPct > 0 ? "+" : ""}${p.pnlPct}%` : "—"}
            </span>
            {showExec && (
              <span className={clsx("nh-deck-cardexec", p.execPnlPct! < 0 && "nh-deck-neg")}>
                fill {p.execPnlPct! > 0 ? "+" : ""}{p.execPnlPct}%
              </span>
            )}
          </>
        )}
      </span>
    </button>
  );
}
