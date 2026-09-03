"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { PlayTerminal, etClock } from "./PlayTerminal";
import { DiscoveryFunnelStrip, MarketStateStrip, SessionStatsStrip, SpxSlayerBadgeStrip } from "@/features/nighthawk/components/zerodte-board-strips";
import type { DiscoveryFunnelHint } from "@/lib/zerodte/discovery-funnel-hint";
import type { MarketStateSnapshot } from "@/lib/zerodte/market-state-engine";
import type { SpxSlayerBadge } from "@/features/spx/lib/spx-slayer-badge-map";
import type { ZeroDteSessionBoardStats } from "@/lib/zerodte/session-board-stats";
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
  playQualityPct,
  primaryReturnLabel,
  primaryReturnPct,
  useLifecyclePlayCard,
} from "./play-card-display";
import { isWatchTrackStatus } from "./play-card-lifecycle";
import { legacyPrimaryPnlPct } from "@/features/nighthawk/lib/legacy-primary-pnl";
import { PlayLifecycleCardBody } from "./PlayLifecycleCard";
import { DeckPlayTableHeader } from "./DeckPlayTableHeader";
import { groupSwingSections } from "./swing-section-groups";
import {
  buildDeckCommandCenterStats,
  convictionRankContext,
} from "./deck-command-center";
import { deriveEngineStatus } from "./deck-engine-status";

/** Status filter mode: which plays to show in the list. */
type StatusFilter = DeckStatusFilter;

/** Direction filter — ALL (default) or narrow to one side. */
type DirectionFilter = "ALL" | "LONG" | "SHORT";

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
  deckHorizon = "ZERO_DTE",
  boardAsOf = null,
  upstreamOk = null,
  marketState = null,
  discoveryFunnel = null,
  sessionStats = null,
  spxSlayerBadge,
  focusTicker = null,
  boardChrome = "default",
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
  /** Replace the "X of Y" header with the command-center stat strip + engine status. */
  commandCenter?: boolean;
  /** Lane context for engine-status session logic (defaults to ZERO_DTE cadence). */
  deckHorizon?: TerminalPlay["horizon"];
  /** Board snapshot instant (`as_of`) — drives Live Engine Status last-update age. */
  boardAsOf?: string | null;
  /** Board upstream health flag — false forces engine Offline (never fabricated). */
  upstreamOk?: boolean | null;
  /** 0DTE only — regime-adaptive rail weights (Phase 2b). */
  marketState?: MarketStateSnapshot | null;
  /** 0DTE only — top session gate hint (Phase 2c). */
  discoveryFunnel?: DiscoveryFunnelHint | null;
  /** 0DTE only — scan vs commit session counters. */
  sessionStats?: ZeroDteSessionBoardStats | null;
  /** 0DTE only — SPX Slayer's own live play, read-only board badge (feat/nh-spx-badge). Undefined
   *  on lanes that don't pass it (Swings/LEAPS/Legacy) — the badge renders nothing, never idle
   *  chrome for a lane that was never meant to carry it. */
  spxSlayerBadge?: SpxSlayerBadge | null;
  /** Set once by a cross-deck "go to this ticker" navigation (e.g. a Legacy play's "moved to
   *  Swings Open" link) — forces the selection to that ticker's row as soon as it's present in
   *  `plays`, overriding the normal preferred-selection logic for one focus event. */
  focusTicker?: string | null;
  /** Vector board chrome — wider detail rail + premium filter styling (Legacy parity). */
  boardChrome?: "default" | "vector";
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

  // Ticker search — a second, independent narrowing on top of the status filter (never replaces
  // it: typing "NVDA" while on the OPEN filter still only shows an open NVDA row, not every NVDA
  // row regardless of status). Applies identically on every horizon since this is the one shared
  // CommandDeck all four boards render through.
  const [search, setSearch] = useState("");
  const searched = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return filtered;
    return filtered.filter((p) => p.ticker.toUpperCase().includes(q));
  }, [filtered, search]);

  // Direction filter — third independent lens (status × search × direction), same compose-not-
  // replace rule. Reads the play's real `direction` field only; a condor's direction value is
  // whatever the adapter set it to (never fabricated here just to make the filter "work").
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("ALL");
  const directed = useMemo(() => {
    if (directionFilter === "ALL") return searched;
    return searched.filter((p) => p.direction === directionFilter);
  }, [searched, directionFilter]);

  // Sort lens: the status banding (default) or the Wave-2 conviction ranking. Additive — the status
  // sort is unchanged; conviction is a second view over the SAME list (deck-sort.ts).
  const [sortMode, setSortMode] = useState<DeckSortMode>("status");
  const sorted = useMemo(() => sortPlaysForDeckBy(directed, sortMode), [directed, sortMode]);
  // SWING only: split the flat sorted list into its seven serving.ts sections so the board renders them as
  // visually distinct rails (FINDINGS 2026-08-06 P2) instead of one undifferentiated concatenated list —
  // exactly the failure mode serving.ts's own header says it exists to prevent.
  const swingGroups = useMemo(
    () => (deckHorizon === "SWING" ? groupSwingSections(sorted) : null),
    [deckHorizon, sorted],
  );
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    sorted.forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [sorted]);

  // Cockpit figures — computed off the FULL board (not the display order), so they're identical under
  // either sort. Both auto-update on the SWR board refresh that replaces `plays`.
  const risk = useMemo(
    () => deployedRisk(allocation ?? null, workingTickersOf(plays)),
    [allocation, plays],
  );
  const tape = useMemo(() => sessionTape(plays), [plays]);

  const [selId, setSelId] = useState<string | null>(null);
  // Mobile-only (see the `@media (max-width:820px)` rule in globals.css, which is what makes
  // this state meaningful at all — on desktop both nh-deck-left/right show unconditionally and
  // this attribute is inert): whether the member has EXPLICITLY asked to see a play's detail on
  // a narrow viewport, vs. the board's own on-load/on-poll auto-selection. Before this, the two
  // rails always rendered stacked full-height on mobile the instant any play existed — the list
  // never got to be the default view, and its columns (STATUS/PLAY/GRADE/TIME/PNL) had to share
  // a squeezed row width, truncating the ticker/strike/expiry text (member report 2026-08-29).
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const selectPlay = useCallback((id: string) => {
    setSelId(id);
    setMobileDetailOpen(true);
  }, []);
  const closeMobileDetail = useCallback(() => setMobileDetailOpen(false), []);

  // Keep a valid selection as the polled list changes: prefer working → watch → closed on first
  // pick so a CLOSED row doesn't monopolize the right rail when WATCH setups exist. Deliberately
  // does NOT open the mobile detail view — this is the board choosing a default, not the member
  // asking to see one.
  useEffect(() => {
    if (sorted.length === 0) {
      if (selId !== null) setSelId(null);
    } else if (!sorted.some((p) => p.id === selId)) {
      setSelId(preferredPlayId(sorted) ?? sorted[0]!.id);
    } else if (selId === null) {
      setSelId(preferredPlayId(sorted) ?? sorted[0]!.id);
    }
  }, [sorted, selId]);

  // Cross-deck focus: a Legacy play's "moved to Swings Open" link sets focusTicker once — select
  // that ticker's row as soon as it's present (it may take a poll cycle for the freshly-promoted
  // name to appear in this lane's fetched data). Re-fires on every focusTicker/sorted change but
  // is a no-op once selId already matches, so it doesn't fight the member's own subsequent clicks.
  // This IS an explicit "go look at this play" navigation (unlike the default-selection effect
  // above), so it opens the mobile detail view too.
  useEffect(() => {
    if (!focusTicker) return;
    // The status filter can hide the freshly-promoted row (e.g. filter=OPEN, name lands in WATCH)
    // — widen to ALL so a focus navigation is never silently invisible.
    setStatusFilter("ALL");
    const match = plays.find((p) => p.ticker.toUpperCase() === focusTicker.toUpperCase());
    if (match && selId !== match.id) {
      setSelId(match.id);
      setMobileDetailOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTicker, plays, selId]);

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
  const engineStatus = useMemo(
    () =>
      commandCenter
        ? deriveEngineStatus({
            degraded,
            loading,
            sessionHeat,
            boardAsOf,
            nowMs,
            etMinutes: hour * 60 + minute,
            upstreamOk,
            horizon: deckHorizon,
          })
        : null,
    [commandCenter, degraded, loading, sessionHeat, boardAsOf, nowMs, hour, minute, upstreamOk, deckHorizon],
  );

  return (
    <div
      className={clsx(
        "nh-deck nh-deck-fill",
        boardChrome === "vector" && "nh-deck--vector-chrome",
      )}
      data-mobile-view={mobileDetailOpen ? "detail" : "list"}
    >
      <div className="nh-deck-left">
        {commandCenter ? (
          <>
          <DeckCompactHeader
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            playCounts={{ all: plays.length, open: counts.open, watch: counts.watch, closed: counts.closed }}
            search={search}
            setSearch={setSearch}
            directionFilter={directionFilter}
            setDirectionFilter={setDirectionFilter}
          />
          {deckHorizon === "ZERO_DTE" && !degraded && (sessionStats || marketState || discoveryFunnel?.summary || spxSlayerBadge !== undefined) ? (
            <div className="nh-deck-context-strips mb-2 space-y-1.5 px-0.5">
              <SessionStatsStrip stats={sessionStats} compact />
              <MarketStateStrip ms={marketState} compact />
              <DiscoveryFunnelStrip funnel={discoveryFunnel} compact />
              <SpxSlayerBadgeStrip badge={spxSlayerBadge} compact />
            </div>
          ) : null}
          </>
        ) : (
          <>
            <div className="nh-deck-lh">
              <span>{laneLabel}</span>
              <span>
                {degraded
                  ? "data down"
                  : statusFilter === "ALL" && !search.trim() && directionFilter === "ALL"
                    ? `${plays.length} plays`
                    : `${directed.length} of ${plays.length}`}
              </span>
            </div>
            {deckHorizon === "ZERO_DTE" && !degraded && (sessionStats || marketState || discoveryFunnel?.summary || spxSlayerBadge !== undefined) ? (
              <div className="nh-deck-context-strips mb-2 space-y-2 px-0.5">
                <SessionStatsStrip stats={sessionStats} />
                <MarketStateStrip ms={marketState} />
                <DiscoveryFunnelStrip funnel={discoveryFunnel} />
                <SpxSlayerBadgeStrip badge={spxSlayerBadge} />
              </div>
            ) : null}
            <CockpitStrip risk={risk} tape={tape} />
            <DeckChromeRow
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              playCounts={{ all: plays.length, open: counts.open, watch: counts.watch, closed: counts.closed }}
              search={search}
              setSearch={setSearch}
              directionFilter={directionFilter}
              setDirectionFilter={setDirectionFilter}
            />
          </>
        )}
        <div className={clsx("nh-deck-rows", commandCenter && "nh-deck-play-table")}>
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
          {!loading && filtered.length > 0 && searched.length === 0 && (
            <div className="nh-deck-empty">No plays match &ldquo;{search.trim()}&rdquo;.</div>
          )}
          {!loading && searched.length > 0 && directed.length === 0 && (
            <div className="nh-deck-empty">No {directionFilter.toLowerCase()} plays match your other filters.</div>
          )}
          {commandCenter && !loading && sorted.length > 0 && (
            <DeckPlayTableHeader sortMode={sortMode} setSortMode={setSortMode} />
          )}
          {swingGroups ? (
            swingGroups.map((g) => (
              <div key={g.key} className="nh-deck-section-group" data-section={g.key}>
                <div className="nh-deck-section-head" title={g.hint}>
                  <span className="nh-deck-section-label">{g.label}</span>
                  <span className="nh-deck-section-count">{g.plays.length}</span>
                </div>
                {g.plays.map((p) => (
                  <PlayCard key={p.id} play={p} rank={rankById.get(p.id) ?? 1} selected={p.id === selId} onSelect={selectPlay} nowMs={nowMs} />
                ))}
              </div>
            ))
          ) : (
            sorted.map((p, i) => (
              <PlayCard key={p.id} play={p} rank={i + 1} selected={p.id === selId} onSelect={selectPlay} nowMs={nowMs} />
            ))
          )}
        </div>
      </div>
      <PlayTerminal
        play={selected}
        sessionClosed={sessionClosed}
        nowMs={nowMs}
        convictionRank={convictionRank}
        onBack={closeMobileDetail}
      />
    </div>
  );
}

/** Status filter toggles — ALL / OPEN / WATCH / CLOSED. */
function DeckStatusFilterBar({
  statusFilter,
  setStatusFilter,
  playCounts,
  prominent = false,
}: {
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  playCounts: { all: number; open: number; watch: number; closed: number };
  prominent?: boolean;
}) {
  return (
    <div
      className={clsx("nh-deck-filterbar", prominent && "nh-deck-filterbar--prominent")}
      role="group"
      aria-label="Filter plays by status"
    >
      <button type="button" className={clsx("nh-deck-filtbtn", statusFilter === "ALL" && "on")} onClick={() => setStatusFilter("ALL")}>
        ALL <span className="cnt">{playCounts.all}</span>
      </button>
      <button type="button" className={clsx("nh-deck-filtbtn", statusFilter === "OPEN" && "on")} onClick={() => setStatusFilter("OPEN")}>
        OPEN <span className="cnt">{playCounts.open}</span>
      </button>
      <button type="button" className={clsx("nh-deck-filtbtn", statusFilter === "WATCH" && "on")} onClick={() => setStatusFilter("WATCH")}>
        WATCH <span className="cnt">{playCounts.watch}</span>
      </button>
      <button type="button" className={clsx("nh-deck-filtbtn", statusFilter === "CLOSED" && "on")} onClick={() => setStatusFilter("CLOSED")}>
        CLOSED <span className="cnt">{playCounts.closed}</span>
      </button>
    </div>
  );
}

/** Ticker quick-search — narrows the play list by substring, independent of the status filter.
 *  Clear button only renders once there's something to clear (never a dead control). */
function DeckSearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="nh-deck-search">
      <span className="nh-deck-search__icon" aria-hidden>
        ⌕
      </span>
      <input
        type="search"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search ticker…"
        aria-label="Search plays by ticker"
        className="nh-deck-search__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="nh-deck-search__clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Direction filter — ALL / LONG / SHORT. Compact, same chip family as the status filter but a
 *  visually distinct second group so the two independent lenses don't read as one control. */
function DeckDirectionFilterBar({
  directionFilter,
  setDirectionFilter,
}: {
  directionFilter: DirectionFilter;
  setDirectionFilter: (f: DirectionFilter) => void;
}) {
  return (
    <div className="nh-deck-filterbar nh-deck-filterbar--direction" role="group" aria-label="Filter plays by direction">
      <button type="button" className={clsx("nh-deck-filtbtn", directionFilter === "ALL" && "on")} onClick={() => setDirectionFilter("ALL")}>
        L/S
      </button>
      <button type="button" className={clsx("nh-deck-filtbtn", directionFilter === "LONG" && "on")} onClick={() => setDirectionFilter("LONG")}>
        LONG
      </button>
      <button type="button" className={clsx("nh-deck-filtbtn", directionFilter === "SHORT" && "on")} onClick={() => setDirectionFilter("SHORT")}>
        SHORT
      </button>
    </div>
  );
}

/** Filter chrome — status + direction toggles + ticker search; sort lives on table column
 *  headers in command center. */
function DeckChromeRow({
  statusFilter,
  setStatusFilter,
  playCounts,
  prominentFilters = false,
  search,
  setSearch,
  directionFilter,
  setDirectionFilter,
}: {
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  playCounts: { all: number; open: number; watch: number; closed: number };
  prominentFilters?: boolean;
  search: string;
  setSearch: (v: string) => void;
  directionFilter: DirectionFilter;
  setDirectionFilter: (f: DirectionFilter) => void;
}) {
  return (
    <div className="nh-deck-chrome-row">
      <DeckStatusFilterBar
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        playCounts={playCounts}
        prominent={prominentFilters}
      />
      <DeckDirectionFilterBar directionFilter={directionFilter} setDirectionFilter={setDirectionFilter} />
      <DeckSearchBox value={search} onChange={setSearch} />
    </div>
  );
}

/** Two-row compact header — stats/engine/risk on row 1; status filters on row 2. */
/**
 * Compact header — filters ONLY. Used to render a "primary" row above this (lane label + Opps/
 * Top/Edge stat pills + engine heartbeat + SPX Slayer badge + risk/P&L cockpit) duplicating
 * information already available elsewhere on the page (the view toggle already says which lane
 * you're on; the play list itself IS the opportunity count; engine/risk/P&L are drill-down
 * detail, not a landing-page headline) — removed per explicit product direction (2026-08-28):
 * "within a fraction of a second of opening Night Hawk, I see the actual trades." `laneLabel`/
 * `degraded`/`stats`/`engineStatus`/`risk`/`tape`/`spxSlayerBadge` are no longer threaded into
 * this component; CommandDeck's own computation of them is untouched (the commandCenter=false
 * branch below still renders MarketStateStrip/DiscoveryFunnelStrip/SpxSlayerBadgeStrip/
 * CockpitStrip and is exercised by CommandDeck.ssr.test.ts, so those helpers stay defined).
 */
function DeckCompactHeader({
  statusFilter,
  setStatusFilter,
  playCounts,
  search,
  setSearch,
  directionFilter,
  setDirectionFilter,
}: {
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  playCounts: { all: number; open: number; watch: number; closed: number };
  search: string;
  setSearch: (v: string) => void;
  directionFilter: DirectionFilter;
  setDirectionFilter: (f: DirectionFilter) => void;
}) {
  return (
    <div className="nh-deck-header-compact" aria-label="Filters">
      <div className="nh-deck-hdr-row nh-deck-hdr-row--secondary nh-deck-hdr-row--filters">
        <DeckStatusFilterBar
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          playCounts={playCounts}
          prominent
        />
        <DeckDirectionFilterBar directionFilter={directionFilter} setDirectionFilter={setDirectionFilter} />
        <DeckSearchBox value={search} onChange={setSearch} />
      </div>
    </div>
  );
}

/** Live engine heartbeat — grounded on the board snapshot's `as_of`, ticks every second. */
function DeckEngineStatus({
  status,
  compact = false,
}: {
  status: ReturnType<typeof deriveEngineStatus>;
  compact?: boolean;
}) {
  return (
    <div className={clsx("nh-deck-engine-status", compact && "nh-deck-engine-status--compact")} aria-label="Engine status">
      <div className="nh-deck-engine-status__cell">
        <span className="nh-deck-engine-status__lab">Engine</span>
        <span className={clsx("nh-deck-engine-status__val", status.ok && "is-ok")}>
          {status.label}
          {status.ok && (
            <span className="nh-deck-engine-status__ok" aria-hidden>
              ✔
            </span>
          )}
        </span>
      </div>
      <div className="nh-deck-engine-status__cell nh-deck-engine-status__cell--right">
        <span className="nh-deck-engine-status__lab">Updated</span>
        <span className="nh-deck-engine-status__val nh-deck-engine-status__age">
          {status.lastUpdateAge ?? "—"}
        </span>
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
  compact = false,
}: {
  risk: ReturnType<typeof deployedRisk>;
  tape: ReturnType<typeof sessionTape>;
  compact?: boolean;
}) {
  const riskFrac = risk && risk.limitR > 0 ? Math.max(0, Math.min(1, risk.deployedR / risk.limitR)) : 0;
  const total = tape.empty ? null : tape.totalR;
  const totalCls = total == null ? "" : total > 0 ? "nh-deck-pos" : total < 0 ? "nh-deck-neg" : "";

  if (compact) {
    return (
      <div className="nh-deck-cockpit nh-deck-cockpit--compact" aria-label="Session risk and P&L">
        <div className="nh-deck-ck nh-deck-ck--compact">
          <span className="ckh">Risk</span>
          {risk ? (
            <span className="ckv">
              <b>{risk.deployedR.toFixed(1)}</b>
              <span className="dim">/{risk.limitR.toFixed(1)}R</span>
              <span className="nh-deck-ck-mini-bar" aria-hidden>
                <i style={{ width: `${Math.round(riskFrac * 100)}%` }} />
              </span>
            </span>
          ) : (
            <span className="ckv dim">—</span>
          )}
        </div>
        <div className="nh-deck-ck nh-deck-ck--compact">
          <span className="ckh">P&amp;L</span>
          {total == null ? (
            <span className="ckv dim">—</span>
          ) : (
            <span className={clsx("ckv", totalCls)}>
              <b>{total > 0 ? "+" : ""}{total.toFixed(1)}R</b>
              {tape.hasProxyR && (
                <span className="dim" title="R-unit includes Swing/LEAPS/Legacy plays — the −50% stop is 0DTE-derived, not native to these models' thesis-primary exits">*</span>
              )}
            </span>
          )}
        </div>
      </div>
    );
  }

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
            <div className={clsx("ckv", totalCls)}>
              <b>{total > 0 ? "+" : ""}{total.toFixed(1)} R</b>
              {tape.hasProxyR && (
                <span className="dim" title="R-unit includes Swing/LEAPS/Legacy plays — the −50% stop is 0DTE-derived, not native to these models' thesis-primary exits">*</span>
              )}
            </div>
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

/** Visible rank identity for 0DTE rows — moved to PlayLifecycleCard (lifecycle layout). */

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
  const markFlash = useFlash(p.mark ?? p.pnlPct ?? p.stockMovePct ?? p.trackPct ?? null);

  const asOfMs = p.markAsOf ? Date.parse(p.markAsOf) : NaN;
  const hasAsOf = Number.isFinite(asOfMs);
  const staleThresholdMs = p.horizon === "LEGACY" ? LEGACY_QUOTE_STALE_MS : ZERODTE_MARK_STALE_MS;
  const stale = hasAsOf ? isZeroDteMarkStale(asOfMs, nowMs, staleThresholdMs) : false;

  const isCondor = p.isCondor === true;
  const enhanced = useLifecyclePlayCard(p);
  const showThRing = p.thesisHealth != null && Number.isFinite(p.thesisHealth.health);

  if (enhanced) {
    return (
      <button
        type="button"
        className={clsx(
          "nh-deck-row nh-deck-row-lifecycle-compact",
          selected && "sel",
          stale && "nh-deck-card-stale",
          markFlash && "nh-deck-row-flash",
        )}
        onClick={() => onSelect(p.id)}
        aria-current={selected}
      >
        <PlayLifecycleCardBody
          play={p}
          rank={rank}
          nowMs={nowMs}
          markFlash={markFlash}
        />
        {isCondor && (
          <span className="nh-deck-lc-condor">
            <CondorCardChip play={p} />
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={clsx(
        "nh-deck-row",
        selected && "sel",
        stale && "nh-deck-card-stale",
        markFlash && "nh-deck-row-flash",
      )}
      onClick={() => onSelect(p.id)}
      aria-current={selected}
    >
      <span className="nh-deck-rk-wrap">
        {showThRing && (
          <HealthRing health={p.thesisHealth!.health} rung={p.thesisHealth!.rungLabel} />
        )}
        <span className="nh-deck-rk">{rank}</span>
      </span>
      <span className="nh-deck-row-body">
        <span className="nh-deck-row-head">
          <span className="nh-deck-tk">{p.ticker}</span>
          <span className={clsx("nh-deck-dp", p.direction === "LONG" ? "long" : "short")}>
            {p.direction}
          </span>
        </span>
        <span className="nh-deck-sub">{p.contract}</span>
        <span className="nh-deck-cardbadges">
          <span className={clsx("nh-deck-st", p.status)}>{p.status}</span>
          {p.firstFlaggedAt && (
            <span className="nh-deck-cbadge time" title="Time this play was first flagged">
              {etClock(p.firstFlaggedAt)} ET
            </span>
          )}
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
        ) : isWatchTrackStatus(p.status) && p.trackPct != null ? (
          <>
            <span
              className={clsx(
                "nh-deck-prem nh-deck-prem-lg",
                p.trackPct > 0 && "nh-deck-pos",
                p.trackPct < 0 && "nh-deck-neg",
                markFlash && "neon",
              )}
            >
              {p.trackPct > 0 ? "▲ " : ""}
              {formatReturnPct(p.trackPct)}
            </span>
            <span className="nh-deck-premlab">{primaryReturnLabel(p)}</span>
          </>
        ) : p.horizon === "LEGACY" && p.stockPrice != null ? (
          <>
            <span className="nh-deck-prem" style={{ display: "block" }}>
              ${p.stockPrice.toFixed(2)}
            </span>
            <span className="nh-deck-premlab">{p.pnlPct != null ? "Premium" : "Stock"}</span>
            <span
              className={clsx(
                "nh-deck-pnl",
                (legacyPrimaryPnlPct(p) ?? 0) > 0 && "nh-deck-pos",
                (legacyPrimaryPnlPct(p) ?? 0) < 0 && "nh-deck-neg",
              )}
              style={{ display: "block" }}
            >
              {legacyPrimaryPnlPct(p) != null
                ? `${legacyPrimaryPnlPct(p)! >= 0 ? "+" : ""}${legacyPrimaryPnlPct(p)!.toFixed(1)}%`
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
