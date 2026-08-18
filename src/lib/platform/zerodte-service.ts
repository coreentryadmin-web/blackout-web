/**
 * 0DTE Command — single source of truth for the live board payload.
 * Member route (/api/market/zerodte/board), Largo (get_zerodte_plays), and BIE
 * composers (composeZeroDtePlays / composeTickerPlayState) all read through here
 * so ledger PnL, intel lines, and Night Hawk dedupe never drift.
 */
import type { ZeroDteSetupLogRow } from "@/lib/db";
import { fetchNighthawkEchoForTickers, type EcosystemNightHawkTake } from "@/lib/bie/ecosystem-context";
import { etNowParts, isTradingDayEt, nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { zerodteBoardMaxBlockMs } from "@/lib/providers/config";
import { readGridEarnings } from "@/lib/zerodte/earnings";
import { serverCache, TTL } from "@/lib/server-cache";
import { sharedCacheDel, sharedCacheGet, sharedCacheSet, sharedCacheSetNx } from "@/lib/shared-cache";
import { roundFloats } from "@/lib/round-floats";
import {
  matchEarnings,
  matchHotNews,
  resolveFreshFindStatus,
  sessionHeat,
  type DiscoveryOrigin,
  type EnrichedZeroDteSetup,
  type OriginMaps,
} from "@/lib/zerodte/board";
import { buildIntelNote } from "@/lib/zerodte/intel";
import { allocateBoard, openPositionsFromLedger } from "@/lib/portfolio/board-allocation";
import type { AllocationDecision } from "@/lib/portfolio/allocation";
import { cortexSummaryFor } from "@/lib/zerodte/cortex-gate";
import { tierForSkip } from "@/lib/zerodte/tiers";
import {
  closedStopReason,
  isZeroDteMarkStale,
  peakPnlPct,
  pinnedLivePnlPct,
  reconcileLedgerLivePnlPct,
  ZERODTE_MARK_STALE_MS,
  type ZeroDteMarkSource,
} from "@/lib/zerodte/marks-math";
import { buildTerminalExitLadder, executableFill, type TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";
import { condorGeometryFrom, type CondorGeometry } from "@/lib/zerodte/condor-render";
import { readPinnedWhyNow, type WhyNow } from "@/lib/zerodte/why-now";
import { readFrozenExitMode, readFrozenExitPolicy } from "@/lib/zerodte/exit-sync";
import { buildResolvedExitPolicy } from "@/lib/zerodte/strategy-version";
import type { ZeroDteGreeks } from "@/lib/zerodte/live-marks";
import {
  computeThesisHealth,
  formatComputedEt,
  type ThesisHealthPayload,
} from "@/lib/zerodte/thesis-health";
import { fetchZeroDteSessionContext } from "@/lib/zerodte/entry-context";
import {
  categorizeExitReason,
  ratchetFloorPct,
  type ZeroDteExitReasonCategory,
} from "@/lib/zerodte/exit-engine";
import { PLAN_RULES } from "@/lib/zerodte/plan";
import {
  loadRecordedGovernorStops,
  summarizeGovernorForBoard,
  countShortGammaOpen,
  type ZeroDteGovernorSummary,
} from "@/lib/zerodte/governor";
import { fetchDiscoveryFunnelHint, type DiscoveryFunnelHint } from "@/lib/zerodte/discovery-funnel-hint";
// Read-only SPX Slayer badge (feat/nh-spx-badge) — additive display field only, see
// spx-slayer-badge.ts for the full scope note. NOT part of scoring/gates/governor above.
// Lazy dynamic import below (not a static import): spx-slayer-badge.ts's module graph
// reaches spx-play-options.ts, which calls polygonRestBase() at module-eval time. A
// static import here pulls that eager call into every consumer of this file's module
// graph — including zerodte-board-convergence.test.ts, whose mocked polygon module
// doesn't stub that export, breaking 23 unrelated tests. Loading it only at the actual
// call site keeps this file's static import graph — and every existing test's mocks —
// unchanged for callers that never touch the SPX badge.
import { unavailableSpxSlayerBadge, type SpxSlayerBadge } from "@/features/spx/lib/spx-slayer-badge-map";
import { gradeZeroDteLedger, readZeroDteLedgerChecked, scanZeroDteBoard, syncLedgerLiveState } from "@/lib/zerodte/scan";
import { initialDiscoveryHealth, type DiscoveryHealth } from "@/lib/zerodte/discovery-health";
import {
  readExitStampFromEntryContext,
  readTimelineTranchesFromEntryContext,
  type PlayTimelineTranche,
} from "@/lib/zerodte/play-timeline";
// Type-only (erased at compile) — the runtime handle is dynamically imported in
// registerSetupQuotes below, same relative-specifier pattern as attachLiveMarkMeta.
import type { ZeroDteSetupQuote } from "@/lib/zerodte/live-marks";

export type ZeroDteBoardLedgerRow = {
  ticker: string;
  direction: "long" | "short";
  score_max: number;
  spike: boolean;
  first_flagged_at: string;
  underlying_at_flag: number | null;
  top_strike: number | null;
  /** Contract expiry (YYYY-MM-DD) — additive (PR-D): the pane's play-card header
   *  renders it; null on rows the scanner logged without one. */
  expiry: string | null;
  conviction: string | null;
  entry_premium: number | null;
  flow_avg_fill: number | null;
  status: string | null;
  last_mark: number | null;
  /** OCC symbol pinned on the row's plan (`plan_json.occ`) — the Command Deck keys the ~1s
   *  live-marks SSE overlay by this. Null when the commit never froze a contract (legacy /
   *  pre-plan rows). Additive: the terminal already falls back to `setup.plan.occ` for WATCH
   *  finds; without this on a ledger-only working row the right-rail mark/P&L/greeks freeze
   *  at the 5s board poll (or "—") because overlayLiveMarks can't match an OCC. */
  occ: string | null;
  /** Latched premium extremes since entry — the PnL panel's peak/trough excursion (the server tracks
   *  these via advancePlayLatch; without them on the payload the terminal's Peak/Trough render "—"). */
  peak_premium: number | null;
  trough_premium: number | null;
  /** Latched peak excursion vs pinned entry — the high-water mark for closed-card display. */
  peak_pnl_pct: number | null;
  live_pnl_pct: number | null;
  /** Why a CLOSED play closed — now DISTINGUISHES the exit type (pre-this-change a
   *  ratchet exit and a target trim were both null, indistinguishable). "stopped" uses
   *  trim-scale AS-MANAGED live_pnl_pct when the peak armed tranches (shipped default exit
   *  mode); else the mechanical −50% hold-to-stop pin. Drives the exit badge; "ratchet"/"thesis"/"flat"/"target"
   *  categorize an engine exit from the pinned entry_context.exit; "time_stop" is a plain
   *  15:30 close with no engine exit; null = a live (still-open) row. Additive: only
   *  "stopped" pins P&L — every other value is a display label. */
  closed_reason: "stopped" | ZeroDteExitReasonCategory | "time_stop" | null;
  /** The active PROTECTIVE ratchet floor in P&L % terms (ratchet mode — the shipped
   *  default), derived purely from the latched peak + trim state: "your stop is now at
   *  breakeven/+20%/+50%". This is the guidance the exit engine computes but that never
   *  reached the member before. Null = no floor armed (peak below +25%) or a trim_scale
   *  runner (which rides the plan stop, not a ratchet floor). Pure, no IO. */
  floor_pnl_pct: number | null;
  /** Coarse category of the engine's EXIT decision, read from the pinned
   *  entry_context.exit.reason (ratchet/thesis/flat/target/stop). Present exactly when the
   *  engine stamped an exit; null on a plain time-stop close or a live row. Lets the pane
   *  say WHY the engine got out without re-deriving it from the raw snake_case reason. */
  exit_reason: ZeroDteExitReasonCategory | null;
  /** The engine's one-sentence exit rationale (entry_context.exit.detail) — the argued
   *  "Mark X (+Y%) is at/below the +Z% floor …" line. Null when no engine exit is pinned.
   *  This is the member-facing guidance sentence, surfaced verbatim (already rounded at the
   *  data layer by buildExitContext). */
  exit_detail: string | null;
  /** ISO instant when the exit engine stamped entry_context.exit — timeline replay anchor. */
  exit_at: string | null;
  /** Realized P&L % at the engine exit stamp — null without a pinned exit. */
  exit_pnl_pct: number | null;
  /** WS-11 reconstructed trim legs (post-session) — each carries an honest at_et. */
  timeline_tranches: PlayTimelineTranche[] | null;
  /** ISO instant of the quote behind last_mark, when the live-marks lane served
   *  it (B-9). Null = legacy sync lane (no per-quote timestamp available). */
  mark_as_of: string | null;
  /** Mark provenance from the live lane: "mid" = two-sided quote, "last" =
   *  last-trade fallback (flagged), null = legacy sync lane. */
  mark_source: ZeroDteMarkSource | null;
  /** True when the displayed mark came from the legacy SYNC lane (board `last_mark`,
   *  which carries NO per-quote timestamp — mark_as_of is null) yet a mark exists.
   *  SEV-4: lets the deck badge a non-live "sync" mark as unknown-age, so a member can't
   *  mistake an unknown-age board mark for a 1s-fresh live one. False when the live lane
   *  served this row (fresh + timestamped) or when there is no mark at all (nothing to
   *  badge). Derived, additive — no payload restructure. */
  mark_is_sync: boolean;
  move_pct: number | null;
  direction_hit: boolean | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  graded: boolean;
  nighthawk_echo: EcosystemNightHawkTake | null;
  /** Commit-time Cortex evidence pinned on the row (entry_context.cortex, #318) —
   *  additive (PR-D): the pane's play card renders the evidence table from this
   *  all day, not just during the ≤2-min window the fresh find still carries its
   *  live assessment. Null on pre-wire-in rows / refresh-lane commits — the pane
   *  shows an honest "gates-only" line, never a fabricated table. Served as an
   *  opaque blob; the client validates the shape structurally (zerodte/pane.ts). */
  cortex: Record<string, unknown> | null;
  /** Commit-time merit tier pinned on the row (entry_context.tier, PR-F) — the
   *  {tier, factors[]} assignment stamped by the SAME scan pass that committed the
   *  play. Same passthrough contract as `cortex` above: served opaque, validated
   *  structurally client-side (readTierAssignment, zerodte/pane.ts); null on rows
   *  committed before the tier wiring shipped — the pane simply shows no chip,
   *  never a re-derived or fabricated grade. */
  tier: Record<string, unknown> | null;
  /** Commit-time multi-day flow-accumulation read pinned on the row (entry_context.
   *  flow_accumulation, scan.ts) — the SAME evidence blob the live scan attaches to
   *  a fresh setup (flow-accumulation-context.ts), frozen at commit. Without this the
   *  card's accumulation badge (ZeroDteBoard.tsx AccumulationBadge, #951) silently went
   *  dark for every committed/tracked play the moment its ticker fell out of the live
   *  top-N scan snapshot (byTicker match on `setup`) — even though the entry-time read
   *  that actually confirmed the direction never changed. Same passthrough contract as
   *  `cortex`/`tier` above: served opaque, validated structurally client-side; null on
   *  rows committed before this wiring / with no multi-day signal at commit. */
  flow_accumulation: Record<string, unknown> | null;
  /** Terminal v2 — the REAL resolved exit ladder the engine runs on this row (trim-scale
   *  ⅓/⅓ ladder or the single ratchet track), resolved from the row's FROZEN
   *  exit_policy_snapshot (entry_context) and priced/fired against entry + peak. The terminal
   *  renders THIS instead of a hard-coded ratchet track, so the member sees the strategy the
   *  engine actually traded. Null on a legacy row with no frozen policy AND no committed
   *  entry_premium (nothing to resolve) — the terminal keeps the legacy single-track render. */
  exit_policy: TerminalExitLadder | null;
  /** Live two-sided book behind `last_mark` (from the 1s marks lane), for the terminal's
   *  executable-fill line (a long exits into the BID). Null off-RTH / one-sided / legacy sync. */
  bid: number | null;
  ask: number | null;
  /** Executable (sell-into-the-bid) P&L % vs the pinned entry — the number a member could
   *  actually realize right now, beside the mid `live_pnl_pct`. Null without a live bid. */
  live_pnl_pct_exec: number | null;
  /** Live option greeks (Δ Γ Θ V IV) from the 1s snapshot lane, carried on the board payload
   *  so a non-SSE consumer and the sim preview show the greeks strip. Null until priced. */
  greeks: ZeroDteGreeks | null;
  /** Which discovery rails found this play (FLOW/BREAKOUT/PIN), from the frozen origin maps —
   *  the terminal's origin header badge. Null on a legacy row with no pinned origin maps. */
  discovery_origin: DiscoveryOrigin[] | null;
  /** True when this row is a CREDIT iron condor (entry_context.play_type === "CONDOR"). The terminal
   *  uses this to SUPPRESS the directional long-premium trim ladder (inverted for a credit structure). */
  is_condor: boolean;
  /** Wave 2 — the frozen condor render geometry (short/long strikes, net_credit, wing_pts, breach
   *  levels, WR + breach-rate), a strict subset of the pinned CondorPlan (entry_context.condor), for
   *  the terminal's "price-inside-the-tent" gauge. Present ONLY on a CONDOR row that pinned a real
   *  plan; null on a directional row or a legacy condor with no pinned geometry (the terminal shows an
   *  honest "geometry unavailable" note, never a fabricated tent). Additive, null-safe, O(1) per row. */
  condor: CondorGeometry | null;
  /** Wave 3 — the "why now" trigger reason that surfaced this play (multi-day accumulation /
   *  breakout / gamma pin / sweep / flow spike / aggressor flow), read structurally from the
   *  pinned entry_context.why_now (stamped at commit — scan.ts). Drives the terminal's
   *  "⚡ triggered by …" ribbon. Null on a legacy row committed before the pin, or one whose
   *  signals supported no reason — the ribbon is then omitted (never a fabricated trigger). O(1). */
  why_now: WhyNow | null;
  /** Thesis Health — Entry Truth vs Current Truth for working ledger rows (thesis-health.ts).
   *  Null on WATCH/SKIP, CLOSED, or rows without entry_context. Recomputed each board build. */
  thesis_health: ThesisHealthPayload | null;
};

export type ZeroDteBoardPayload = {
  available: true;
  as_of: string;
  upstream_ok: boolean;
  session: {
    date: string;
    trading_day: boolean;
    heat: ReturnType<typeof sessionHeat>;
  };
  setups: EnrichedZeroDteSetup[];
  /** Per-lane provenance for the whole-market discovery origins (BREAKOUT / PIN). A lane that
   *  fail-closed or threw contributes zero setups and the board keeps serving — this says WHICH,
   *  so a shrunken roster reads as "a lane could not see" rather than "the market is quiet".
   *  Never gates scoring; never adds a setup. */
  discovery_health: DiscoveryHealth;
  ledger: ZeroDteBoardLedgerRow[];
  covered_elsewhere: string[];
  /** G-5 session risk state for the pane's governor strip — additive (PR-D). Null
   *  when the state couldn't be read this build (rendered as "unavailable", never
   *  guessed; the gate stack itself independently fails closed on the same read). */
  governor: ZeroDteGovernorSummary | null;
  /** Portfolio Allocation Engine (advisory): cross-sectional rank + duplicate-thesis + opportunity-cost
   *  decision per setup, computed over the day's setups vs the open book. ADVISORY — rides alongside the
   *  board, does not gate the engine or resize a real position (graduates on the portfolio backtest). One
   *  entry per display setup, keyed by ticker; empty when the committed set is unknowable this build. */
  allocation: AllocationDecision[];
  /** Market State Engine snapshot for this scan — regime-adaptive rail weights (Phase 2b UI provenance). */
  market_state: import("@/lib/zerodte/market-state-engine").MarketStateSnapshot | null;
  /** Phase 2c — top session rejection reason for the discovery funnel strip. */
  discovery_funnel: DiscoveryFunnelHint | null;
  /** feat/nh-spx-badge — SPX Slayer's own live play, read-only for board display ONLY. This is
   *  NOT a Night Hawk discovery lane and does not feed candidate scoring/gates/governor/allocation
   *  above — Night Hawk's only behavioral coupling to SPX Slayer remains the G-6 conflict veto in
   *  src/lib/zerodte/gates.ts. Null only for a payload built before this field existed (old cached
   *  snapshot); a live build always resolves to at least the unavailable badge, never undefined. */
  spx_slayer_badge: SpxSlayerBadge | null;
};

// ── Shared, converged board snapshot (fix/zerodte-board-convergence) ──────────────
// WHY: the board used to be assembled PER-REPLICA and served from each replica's own
// in-process withServerCache store for a 5s window (buildZeroDteBoardPayload re-derives
// on every background refresh). Two replicas warm their score inputs (the per-ticker
// `zerodte:intraday:*` reads, VIX-open, etc.) at different instants, so each converges
// to its OWN stable-but-different setup scores — and a member's ~5s SWR poll round-robins
// between replicas, so setup scores FLIP-FLOP between two values (proven live 2026-07-24:
// QQQ 68↔50, MU 52↔56, SNDK 60↔52 across a 4-round poll while `as_of` advanced every
// round). The live MARKS did NOT flip because they ride the shared `nw:optmark:` Redis
// write-through — every replica READS one shared value. This lane gives the WHOLE board
// the same property: one shared snapshot in Redis that every replica reads, so any two
// replicas serve the IDENTICAL board. Liveness is preserved by refreshing that snapshot
// on a stale-while-revalidate cadence (single writer per cycle) so `as_of`/scores/marks
// advance every cycle instead of freezing.
const BOARD_SNAPSHOT_KEY = "zerodte:board:snapshot:v1";
// How long the published snapshot lives in Redis. Comfortably longer than the serve/
// refresh windows below so freshness is governed by the snapshot's own `as_of` age
// (BOARD_SNAPSHOT_*_MS), never by the Redis key silently expiring under us.
const BOARD_SNAPSHOT_TTL_SEC = 600;
// Soft age: once the shared snapshot is older than this, the NEXT reader kicks a
// background rebuild (non-blocking SWR) so the cycle advances. Matches the ~5s member
// poll cadence — most polls land inside a fresh snapshot and never trigger a rebuild.
const BOARD_SNAPSHOT_REFRESH_MS = 5_000;
// Past BOARD_SNAPSHOT_REFRESH_MS the reader kicks a background rebuild (non-blocking SWR).
// Serve ceiling aligned with Redis TTL — a key still present is always served SWR-style
// so a stalled writer never 504s the route; only a true cold miss blocks on build.
// Proven 2026-07-29: blocking cold builds under parallel audit load exceeded CF origin
// timeout → HTTP 504 on /api/market/zerodte/board while the snapshot was still in Redis.
const BOARD_SNAPSHOT_SERVE_MAX_AGE_MS = BOARD_SNAPSHOT_TTL_SEC * 1000;
/** Serve stale shared snapshot up to 10m while rebuild runs — never 504 the route. */
const BOARD_STALE_SERVE_MAX_AGE_MS = 10 * 60_000;
// Cross-replica rebuild lock: elects ONE replica to rebuild+publish per cycle so N
// replicas don't each re-derive the same snapshot. Auto-expires (writer crash safety);
// the winner also deletes it right after publishing so the next cycle can advance.
const BOARD_BUILD_LOCK_KEY = "zerodte:board:build-lock:v1";
const BOARD_BUILD_LOCK_TTL_SEC = 20;

/** A live-lane mark overlay for one ledger row (see attachLiveMarkMeta below). Carries the
 *  fast-moving contract state the 1s live-marks store already prices — the mark + its two-
 *  sided book (for the executable fill) + greeks — so the ~5s board payload can serve the
 *  SAME live numbers to a non-SSE consumer (Largo/BIE) and to the admin sim preview, not
 *  only to the SSE-subscribed browser. All null-safe: an absent field degrades to "—". */
type LiveMarkMeta = {
  mark: number;
  mark_as_of: string;
  mark_source: ZeroDteMarkSource;
  bid: number | null;
  ask: number | null;
  greeks: ZeroDteGreeks | null;
};

/** Read the exit-engine record pinned on a row (entry_context.exit — stamped by
 *  exit-sync's buildExitContext on an engine EXIT). Structural + fail-soft: any missing
 *  or malformed shape yields nulls, so the board surfaces the real reason/sentence or
 *  nothing — never a fabricated one. */
function readPinnedExit(entryContext: Record<string, unknown> | null | undefined): {
  reason: string | null;
  detail: string | null;
} {
  const exit =
    entryContext && typeof entryContext.exit === "object"
      ? (entryContext.exit as Record<string, unknown> | null)
      : null;
  if (!exit) return { reason: null, detail: null };
  return {
    reason: typeof exit.reason === "string" ? exit.reason : null,
    detail: typeof exit.detail === "string" ? exit.detail : null,
  };
}

/** Resolve the terminal exit ladder (Terminal v2) for a row from its FROZEN exit policy.
 *  Preference order, each faithful to what the row COMMITTED under: the fully-resolved numeric
 *  snapshot (entry_context.exit_policy_snapshot) → the frozen mode name → null. A null result
 *  means "no frozen policy" — the terminal keeps its legacy single-track ratchet render rather
 *  than fabricating a trim ladder for a row that never committed to one. Never throws (a
 *  malformed blob reads as absent via the exit-sync structural guards). */
function resolveExitLadder(r: ZeroDteSetupLogRow): TerminalExitLadder | null {
  const frozen = readFrozenExitPolicy(r.entry_context);
  const policy = frozen ?? (() => {
    const mode = readFrozenExitMode(r.entry_context);
    return mode ? buildResolvedExitPolicy(mode) : null;
  })();
  if (!policy) return null;
  return buildTerminalExitLadder(policy, r.entry_premium, r.peak_premium);
}

/** Which discovery rails found this play, from the frozen origin maps (entry_context.origin_maps,
 *  WS-06). Structural + fail-soft: a legacy row with no maps → null (the terminal shows no origin
 *  badge, never a fabricated rail). Returns the rails in the map's own key order. */
function readDiscoveryOrigins(entryContext: Record<string, unknown> | null | undefined): DiscoveryOrigin[] | null {
  const maps = entryContext?.origin_maps;
  if (!maps || typeof maps !== "object") return null;
  const dirMap = (maps as OriginMaps).origin_direction_map;
  if (!dirMap || typeof dirMap !== "object") return null;
  const origins = Object.keys(dirMap).filter((o): o is DiscoveryOrigin =>
    o === "FLOW" || o === "BREAKOUT" || o === "PIN"
  );
  return origins.length > 0 ? origins : null;
}

function mapLedgerRow(
  r: ZeroDteSetupLogRow,
  nighthawkEcho: Awaited<ReturnType<typeof fetchNighthawkEchoForTickers>>,
  liveMark: LiveMarkMeta | null
): ZeroDteBoardLedgerRow {
  // B-9: the board's mark prefers the 1s live-marks lane when it has a FRESH quote
  // for this contract — the same store the SSE push and the poller's ledger sync
  // read — so every consumer of this payload shows the same number. The legacy
  // sync value (r.last_mark) remains the fallback and carries no per-quote
  // timestamp, which is surfaced honestly as mark_as_of: null.
  const lastMark = liveMark?.mark ?? r.last_mark;
  // Structure flag frozen at commit — a CONDOR is a CREDIT structure, so its P&L is
  // seller-framed (see reconcileLedgerLivePnlPct); the directional stop-pin/ratchet-floor
  // concepts below do not apply to it. Read once here and reused across the row build.
  const isCondor = r.entry_context?.play_type === "CONDOR";
  // D-1 fix: a stopped play's displayed P&L is the stop P&L (what the grader will
  // stamp), never the frozen last_mark of whichever tick happened to cross it. This
  // "stopped" verdict is ALSO the only closed_reason that pins P&L (below) — every other
  // value is a display label.
  const closedReason = closedStopReason({
    status: r.status,
    entry_premium: r.entry_premium,
    peak_premium: r.peak_premium,
    trough_premium: r.trough_premium,
  });

  // ── Exit-engine visibility (additive, no computation change) ──────────────────────
  // The rich exit decision the engine already computes (floor / reason / detail) was
  // invisible to the member — nothing carried it onto the board. Surface it here from
  // data ALREADY on the row: the pinned entry_context.exit blob (stamped on an engine
  // EXIT) + the latched peak (for the live ratchet floor). All pure — no new IO.
  const pinnedExit = readPinnedExit(r.entry_context);
  const exitStamp = readExitStampFromEntryContext(r.entry_context);
  const engineExitCategory = categorizeExitReason(pinnedExit.reason);
  // Live ratchet floor (the shipped default mode): "your stop is now at breakeven/+20/
  // +50". Derived purely from the latched peak vs the pinned entry; TRIM status is the
  // ratchet's `trimmed` latch (a trimmed runner's floor is +50%). Null when the peak
  // never armed a floor. buildZeroDteBoardPayload's roundFloats() rounds this like every
  // other premium % on the payload.
  // The ratchet floor is a DIRECTIONAL long-premium concept (a rising mark arms a protective
  // floor). A credit condor has no such ladder — its risk is the defined-loss cap, and its
  // "best" excursion is the LOWEST mark, not the highest — so applying the long-framed floor to
  // it would surface an inverted, meaningless number. Suppress it for condors (null).
  const floorPnlPct = isCondor
    ? null
    : ratchetFloorPct(pinnedLivePnlPct(r.entry_premium, r.peak_premium), r.status === "TRIM");
  // The terminal close label, now distinguishing the exit type: a pinned stop pins (and
  // wins); else an engine exit is categorized; else a plain 15:30 close is "time_stop";
  // else the row is still live (null).
  const boardClosedReason: ZeroDteBoardLedgerRow["closed_reason"] =
    closedReason === "stopped"
      ? "stopped"
      : r.status === "CLOSED"
        ? (engineExitCategory ?? "time_stop")
        : null;

  return {
    ticker: r.ticker,
    direction: r.direction,
    score_max: r.score_max,
    spike: r.spike,
    first_flagged_at: r.first_flagged_at,
    underlying_at_flag: r.underlying_at_flag,
    top_strike: r.top_strike,
    expiry: r.expiry,
    conviction: r.conviction,
    entry_premium: r.entry_premium,
    flow_avg_fill: r.flow_avg_fill,
    status: r.status,
    last_mark: lastMark,
    occ: typeof r.plan_json?.occ === "string" && r.plan_json.occ.length > 0 ? r.plan_json.occ : null,
    peak_premium: r.peak_premium,
    trough_premium: r.trough_premium,
    peak_pnl_pct: peakPnlPct(r.entry_premium, r.peak_premium),
    // Structure-aware: seller-framed for a credit condor; directional stopped closes use
    // trim-scale AS-MANAGED when peak armed tranches — the ONE derivation both build sites share.
    live_pnl_pct: reconcileLedgerLivePnlPct({
      is_condor: isCondor,
      closed_reason: closedReason === "stopped" ? "stopped" : null,
      entry_premium: r.entry_premium,
      last_mark: lastMark,
      peak_premium: r.peak_premium,
      trough_premium: r.trough_premium,
      status: r.status,
    }),
    closed_reason: boardClosedReason,
    floor_pnl_pct: floorPnlPct,
    exit_reason: engineExitCategory,
    exit_detail: pinnedExit.detail,
    exit_at: exitStamp.at,
    exit_pnl_pct: exitStamp.pnl_pct,
    timeline_tranches: readTimelineTranchesFromEntryContext(r.entry_context),
    mark_as_of: liveMark?.mark_as_of ?? null,
    mark_source: liveMark?.mark_source ?? null,
    // SEV-4: flag a mark served by the SYNC lane (no per-quote timestamp) so the deck can
    // badge it as unknown-age. liveMark == null ⟺ mark_as_of == null above; require a mark
    // to exist (lastMark != null) — an absent mark has nothing to badge.
    mark_is_sync: liveMark == null && lastMark != null,
    move_pct: r.move_pct,
    direction_hit: r.direction_hit,
    plan_outcome: r.plan_outcome,
    plan_pnl_pct: r.plan_pnl_pct,
    graded: r.graded_at != null,
    nighthawk_echo: nighthawkEcho.get(r.ticker.toUpperCase()) ?? null,
    cortex:
      r.entry_context && typeof r.entry_context.cortex === "object"
        ? ((r.entry_context.cortex as Record<string, unknown> | null) ?? null)
        : null,
    tier:
      r.entry_context && typeof r.entry_context.tier === "object"
        ? ((r.entry_context.tier as Record<string, unknown> | null) ?? null)
        : null,
    flow_accumulation:
      r.entry_context && typeof r.entry_context.flow_accumulation === "object"
        ? ((r.entry_context.flow_accumulation as Record<string, unknown> | null) ?? null)
        : null,
    // Terminal v2 additive block — all null-safe. The exit ladder is resolved from the
    // FROZEN policy (never current code); bid/ask/greeks + the executable P&L come from the
    // live-marks store entry behind `last_mark`; discovery_origin from the frozen origin maps.
    exit_policy: resolveExitLadder(r),
    bid: liveMark?.bid ?? null,
    ask: liveMark?.ask ?? null,
    // Executable (sell-into-the-bid) P&L vs the pinned entry — the honest exit-side number.
    live_pnl_pct_exec: executableFill(liveMark?.bid ?? null, liveMark?.ask ?? null, r.entry_premium).pnl_pct,
    greeks: liveMark?.greeks ?? null,
    discovery_origin: readDiscoveryOrigins(r.entry_context),
    // Structure flag frozen at commit — a CONDOR must never render the directional trim ladder.
    is_condor: isCondor,
    // Wave 2 — the condor tent geometry, read structurally from the pinned CondorPlan
    // (entry_context.condor, stamped at commit — scan.ts). Only a CONDOR row carries one; parsed by
    // condorGeometryFrom (fail-closed on a bad/absent blob → null, never a fabricated tent). O(1).
    condor:
      r.entry_context?.play_type === "CONDOR"
        ? condorGeometryFrom(r.entry_context?.condor)
        : null,
    // Wave 3 — the "why now" trigger reason pinned at commit (entry_context.why_now). Structural
    // reader, fail-soft → null on a legacy/absent pin (the terminal omits the ribbon). O(1).
    why_now: readPinnedWhyNow(r.entry_context),
    thesis_health: null,
  };
}

/**
 * Read the live-marks store (B-9 lane) for each non-CLOSED ledger row's contract.
 * Lazy-imported so this module's import graph (and its tests) stay free of the
 * lane's db/providers/ws dependencies; any failure degrades to the legacy sync
 * marks (empty map). Only FRESH quotes (≤ZERODTE_MARK_STALE_MS) overlay — a stale
 * store must never beat the sync's just-fetched snapshot.
 */
async function attachLiveMarkMeta(rows: ZeroDteSetupLogRow[]): Promise<Map<string, LiveMarkMeta>> {
  const out = new Map<string, LiveMarkMeta>();
  try {
    // RELATIVE specifier, not the "@/" alias: the tsx ESM loader (CI test runs) cannot
    // resolve tsconfig path aliases in dynamic import() — the alias form threw
    // ERR_MODULE_NOT_FOUND into this function's fail-soft catch, silently serving NO
    // live marks in tests while Next's bundler (prod) resolved it fine. Relative works
    // under both, and keeps the test's seeded store the SAME module instance.
    const { getZeroDteLiveMark, ensureZeroDteMarkPoller } = await import("../zerodte/live-marks");
    // Any board consumer keeps the 1s lane alive (idempotent; self-idles off-RTH),
    // so Largo/BIE reads through this payload stay fresh even with no SSE viewer.
    ensureZeroDteMarkPoller();
    const now = Date.now();
    for (const r of rows) {
      if (r.status === "CLOSED") continue;
      const occ = typeof r.plan_json?.occ === "string" ? (r.plan_json.occ as string) : null;
      if (!occ) continue;
      const m = getZeroDteLiveMark(occ);
      if (!m || m.mark == null || isZeroDteMarkStale(m.asOf, now, ZERODTE_MARK_STALE_MS)) continue;
      out.set(r.ticker.toUpperCase(), {
        mark: m.mark,
        mark_as_of: new Date(m.asOf).toISOString(),
        mark_source: m.source,
        // Two-sided book + greeks from the SAME fresh store entry — feeds the executable
        // fill (sell-into-the-bid) and the terminal greeks strip on the board payload.
        bid: m.bid ?? null,
        ask: m.ask ?? null,
        greeks: m.greeks ?? null,
      });
    }
  } catch {
    // Live lane unavailable (e.g. edge/test env) — legacy sync marks stand.
  }
  return out;
}

/**
 * Register the board's WATCH-only setup contracts into the 1s live-marks lane so a
 * non-entered setup's terminal shows live Δ Γ Θ V IV + mark instead of "—" (the lane
 * only quoted entered ledger plays before). The lane treats these as QUOTE-ONLY — a
 * live bid/ask/mid/mark + greeks, never a ledger row/status/persist/exit (see
 * mergeTrackedContracts + the quote_only guard in live-marks.ts).
 *
 * Watch-only = a setup whose ticker is NOT in today's ledger. An entered / managed /
 * closed ledger ticker already OWNS its card's mark via the entered lane (and the deck
 * merges a same-ticker setup INTO that ledger card), so quoting its — possibly
 * different-strike — setup contract would overlay a mismatched mark on that card. A
 * setup with no plan OCC can't be quoted and is dropped. Lazy dynamic import (RELATIVE
 * specifier — the tsx ESM loader can't resolve the "@/" alias in dynamic import, same
 * as attachLiveMarkMeta) + best-effort: an unavailable lane just leaves "—", as before.
 */
async function registerSetupQuotes(
  setups: EnrichedZeroDteSetup[],
  ledgerRows: ZeroDteSetupLogRow[]
): Promise<void> {
  try {
    const { setZeroDteSetupQuotes } = await import("../zerodte/live-marks");
    const ledgerTickers = new Set(ledgerRows.map((r) => r.ticker.toUpperCase()));
    const quotes: ZeroDteSetupQuote[] = setups
      .filter(
        (s) =>
          !ledgerTickers.has(s.ticker.toUpperCase()) &&
          typeof s.plan?.occ === "string" &&
          s.plan.occ.length > 0
      )
      .map((s) => ({
        ticker: s.ticker.toUpperCase(),
        direction: s.direction,
        strike: s.top_strike,
        occ: s.plan!.occ,
      }));
    setZeroDteSetupQuotes(quotes);
  } catch {
    // Live lane unavailable — watch setups simply show "—", exactly as before this wiring.
  }
}

/** Uncached board assembly — the exact pipeline the member route used before extraction. */
export async function buildZeroDteBoardPayload(): Promise<ZeroDteBoardPayload> {
  const today = todayEt();
  const tradingDay = isTradingDayEt(today);
  const { hour, minute } = etNowParts();
  const heat = sessionHeat(hour * 60 + minute, tradingDay);

  const [news, earningsSnap, ledgerRead, sessionCtx] = await Promise.all([
    serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15)).catch(() => []),
    readGridEarnings().catch(() => null),
    readZeroDteLedgerChecked(),
    fetchZeroDteSessionContext().catch(() => null),
  ]);
  const rawLedger = ledgerRead.rows;

  const ledgerRows = await syncLedgerLiveState(rawLedger).catch(() => rawLedger);
  const nowEtMinutes = hour * 60 + minute;
  const [nighthawkEcho, liveMarks, governor, discovery_funnel, spx_slayer_badge] = await Promise.all([
    fetchNighthawkEchoForTickers(ledgerRows.map((r) => r.ticker)),
    attachLiveMarkMeta(ledgerRows),
    // PR-D governor strip: same ledger + recorded-stop snapshot the gate stack's
    // G-5 judges (governor.ts). Best-effort: an unreadable Redis record degrades to
    // ledger-only stops (untimed but still counted); a hard failure serves null,
    // which the pane renders as "unavailable" — never fabricated risk state.
    loadRecordedGovernorStops(today)
      .catch(() => [])
      .then((recorded) =>
        summarizeGovernorForBoard(ledgerRows, recorded, {
          etMinutes: nowEtMinutes,
          shortGammaOpen: countShortGammaOpen(ledgerRows),
        })
      )
      .catch((): ZeroDteGovernorSummary | null => null),
    fetchDiscoveryFunnelHint(today).catch((): DiscoveryFunnelHint | null => null),
    // Read-only display badge — never throws (getSpxSlayerBadgeSnapshot already catches
    // internally), but a belt-and-suspenders .catch keeps a hard failure here from ever
    // taking down the rest of the board payload. Dynamic import: see the note by the
    // top-of-file import for why this can't be a static import.
    import("@/features/spx/lib/spx-slayer-badge")
      .then((m) => m.getSpxSlayerBadgeSnapshot())
      .catch((): SpxSlayerBadge => unavailableSpxSlayerBadge("SPX Slayer desk unavailable — retrying")),
  ]);

  const nextDay = nextTradingDayEt(today);
  const earningsFlags = matchEarnings(earningsSnap?.items ?? [], { today, nextDay });
  const newsFlags = matchHotNews(news, Date.now());

  const { setups, nighthawk_covered, upstream_ok, market_state, discovery_health } = await scanZeroDteBoard({
    earnings: earningsFlags,
    news: newsFlags,
  });

  void gradeZeroDteLedger().catch(() => {});

  // One-way commit door, presentation half (P0): when the committed set is
  // UNKNOWABLE this build (ledger read failed with no same-session fallback), no
  // fresh find may render — a committed play's ticker usually still ranks in the
  // scan, and serving it as a "fresh find" demotes a member's OPEN position to a
  // watch card. Same fail-closed rule persistZeroDteScan applies to commits
  // ("can't tell fresh from committed → nothing new may print"), applied to
  // display. upstream_ok goes false so the pane's freshness badge says degraded
  // instead of impersonating a live-but-empty board.
  const committedKnown = ledgerRead.committed_known;
  const displaySetups = committedKnown ? setups : [];

  // Feed the watch-only setups' contracts to the 1s live-marks lane so their terminals
  // stream live greeks + mark (fire-and-forget — the lane reads the registry on its own
  // cadence; never block or fail the board on it). Uses displaySetups so a fail-closed
  // build (committed set unknowable → []) also clears any stale setup quotes.
  void registerSetupQuotes(displaySetups, ledgerRows);

  // Portfolio Allocation Engine (advisory): rank today's setups cross-sectionally, collapse duplicate theses,
  // and price opportunity cost against the currently-open book. Additive — attached alongside the setups; it
  // does not gate the engine. Fail-soft: any error yields an empty allocation, never a broken board.
  let allocation: AllocationDecision[] = [];
  try {
    allocation = allocateBoard(displaySetups, openPositionsFromLedger(ledgerRows)).decisions;
  } catch (err) {
    console.warn("[zerodte-service] allocation failed (advisory, empty):", err);
  }

  const setupByTicker = new Map(displaySetups.map((s) => [s.ticker.toUpperCase(), s]));

  const payload = roundFloats({
    available: true,
    as_of: new Date().toISOString(),
    upstream_ok: upstream_ok && committedKnown,
    session: { date: today, trading_day: tradingDay, heat },
    setups: displaySetups,
    discovery_health,
    ledger: ledgerRows.map((r) => {
      const row = mapLedgerRow(r, nighthawkEcho, liveMarks.get(r.ticker.toUpperCase()) ?? null);
      const setup = setupByTicker.get(r.ticker.toUpperCase()) ?? null;
      const thesis_health = computeThesisHealth(
        r.entry_context,
        r.feature_vector,
        {
          direction: r.direction,
          setup,
          spyBias: sessionCtx?.spy_bias ?? null,
          nowEtMinutes,
          computedAtEt: formatComputedEt(Date.now()),
        },
        { status: r.status },
      );
      return { ...row, thesis_health };
    }),
    covered_elsewhere: nighthawk_covered,
    governor,
    allocation,
    market_state,
    discovery_funnel,
    spx_slayer_badge,
  }) as ZeroDteBoardPayload;

  // roundFloats() rounds entry_premium/last_mark independently; recompute PnL from the
  // member-visible rounded premiums so live_pnl_pct always matches its structure's formula —
  // seller-framed (entry−mark)/entry for a condor, long-framed (mark−entry)/entry otherwise,
  // except a directional stopped play, whose result is PINNED to the stop P&L (D-1 fix; matches
  // what gradePlanFromBars will stamp after the session). Same single derivation as mapLedgerRow.
  return {
    ...payload,
    ledger: payload.ledger.map((row) => ({
      ...row,
      live_pnl_pct: reconcileLedgerLivePnlPct(row),
      // Re-price the executable P&L off the member-visible ROUNDED bid/entry (same reason the
      // mid live_pnl_pct is recomputed here) so the two exit lanes stay directly comparable.
      live_pnl_pct_exec: executableFill(row.bid, row.ask, row.entry_premium).pnl_pct,
      // Re-derive the ladder fired-state off the rounded entry/peak so a tranche's rendered
      // premium level and its FIRED flag agree with the numbers shown elsewhere on the row.
      exit_policy: row.exit_policy
        ? buildTerminalExitLadder(row.exit_policy, row.entry_premium, row.peak_premium)
        : null,
    })),
  };
}

/** A shared snapshot read + its age (ms since the payload's own `as_of`). */
type SharedBoardRead = { value: ZeroDteBoardPayload; ageMs: number };

/**
 * Per-replica last good board — served on never-block timeout when Redis is cold.
 *
 * Bounded by age on READ (see readLastGoodBoardLocal). It carried no age check at all, which
 * made it a second, independent source of the `as_of` regression above: a replica whose Redis
 * read failed served whatever board it happened to build last — minutes or hours earlier, with
 * a completely different setup roster — and the member's next poll walked backwards in time.
 * A stale board is a reasonable last resort; an UNBOUNDEDLY stale one presented as current is
 * not, which is exactly the distinction every other lane in this file already draws.
 */
let lastGoodBoardLocal: ZeroDteBoardPayload | null = null;

/** Read the per-replica fallback, but only while it is inside the same staleness ceiling the
 *  shared-snapshot path uses. Past that, return null so the caller falls through to the
 *  structurally-valid empty board (`upstream_ok: false`), which tells the truth — "no current
 *  board" — instead of quietly serving an old session's plays as live. */
function readLastGoodBoardLocal(): ZeroDteBoardPayload | null {
  if (!lastGoodBoardLocal) return null;
  return localBoardIsServable(lastGoodBoardLocal.as_of, Date.now()) ? lastGoodBoardLocal : null;
}

/** Is a per-replica fallback board still inside the staleness ceiling? Pure + exported so the
 *  bound is testable directly — the module-level `lastGoodBoardLocal` has no setter, and a guard
 *  that only fires on an unreachable code path is a guard nobody can prove works. */
export function localBoardIsServable(
  asOf: string | null | undefined,
  nowMs: number,
  maxAgeMs: number = BOARD_STALE_SERVE_MAX_AGE_MS
): boolean {
  const asOfMs = Date.parse(String(asOf ?? ""));
  if (!Number.isFinite(asOfMs)) return false; // undateable board → cannot be shown to be current
  return nowMs - asOfMs <= maxAgeMs;
}

/** Read the shared board snapshot from Redis (in-memory fallback when Redis is
 *  unavailable), returning it with its age. Fail-soft: any store error → null, so the
 *  caller falls through to a local build (never a blank board). */
async function readSharedBoardSnapshot(): Promise<SharedBoardRead | null> {
  try {
    const snap = await sharedCacheGet<ZeroDteBoardPayload>(BOARD_SNAPSHOT_KEY);
    if (!snap || snap.available !== true || typeof snap.as_of !== "string") return null;
    const asOfMs = Date.parse(snap.as_of);
    if (!Number.isFinite(asOfMs)) return null;
    const read = { value: snap, ageMs: Math.max(0, Date.now() - asOfMs) };
    lastGoodBoardLocal = snap;
    return read;
  } catch {
    return null;
  }
}

function rememberGoodBoard(board: ZeroDteBoardPayload): ZeroDteBoardPayload {
  if (board.available && board.upstream_ok !== false) {
    lastGoodBoardLocal = board;
  }
  return board;
}

// Intra-replica single-flight for the COLD/blocking rebuild path — collapses this
// replica's concurrent polls (many tabs / rapid re-polls) into one build+publish.
let coldBuildInflight: Promise<ZeroDteBoardPayload> | null = null;
// Intra-replica guard so a replica fires at most ONE background SWR refresh at a time.
let backgroundRefreshInflight = false;

/**
 * Is a freshly built board actually NEWER than what is already published?
 *
 * The publish used to be an unconditional `sharedCacheSet`, which is only safe if builds
 * finish in the order they start. They do not. A board build takes seconds to tens of
 * seconds (documented live: 20–43s member polls, cold builds past the CF origin timeout),
 * and THREE unsynchronised publishers race:
 *   1. `refreshSharedBoardInBackground` — holds BOARD_BUILD_LOCK_KEY
 *   2. `runColdBoardBuild` (cold miss / soft-stale kick) — takes NO lock
 *   3. `refreshZeroDteBoardSnapshot` (the 1–5min cron warmer) — takes NO lock
 * The lock on (1) buys nothing while (2) and (3) publish around it. So a build that STARTED
 * at T and finished slowly at T+45s would overwrite a snapshot published at T+40s, and the
 * shared `as_of` walked BACKWARD by the build's duration. Observed live 2026-08-17: `as_of`
 * regressed 8m16s and the setup count flipped between 7 and 147 across consecutive polls —
 * two builds from different discovery phases, the older one landing last.
 *
 * Comparing `as_of` (each build stamps its own) makes publish order irrelevant: a slow build
 * that lost the race simply doesn't publish. Ties are refused too — an equal `as_of` carries
 * no new information and rewriting it only re-opens the window.
 *
 * Guarding at the payload level rather than by extending the lock is deliberate: a lock makes
 * publishes mutually exclusive, but exclusion is not ordering — the lock winner can still be
 * the stale builder. Monotonicity is the property actually wanted, and it holds no matter how
 * many publishers exist or which of them takes a lock.
 */
export function boardSnapshotIsNewer(
  builtAsOf: string | null | undefined,
  existingAsOf: string | null | undefined
): boolean {
  const built = Date.parse(String(builtAsOf ?? ""));
  if (!Number.isFinite(built)) return false; // an unstamped build can never displace a stamped one
  const existing = Date.parse(String(existingAsOf ?? ""));
  if (!Number.isFinite(existing)) return true; // nothing valid published yet → publish
  return built > existing;
}

/**
 * Publish a built board as the shared snapshot, but only if it is newer than what is there
 * (see boardSnapshotIsNewer). Returns the board that should be SERVED — the newly published
 * one, or the fresher incumbent when this build lost the race, so a slow builder's own caller
 * still gets the best available board rather than the stale one it just finished computing.
 *
 * Residual race, stated honestly: this is a read-then-write, not an atomic compare-and-set
 * (the shared-cache layer exposes GET / SET / SETNX / DEL — no Lua eval — and adding one for
 * this would widen the blast radius well past the bug). Two publishers can still both read the
 * same incumbent and both write. What that costs is bounded: the window shrinks from the
 * BUILD DURATION (5–45s, and multi-minute once the cron warmer overlaps a stalled cold build)
 * to a single Redis round-trip, and two writers inside that window carry `as_of` values ~1ms
 * apart — so the worst surviving regression is milliseconds, not minutes. That is the
 * difference between an operator seeing the board jump backwards and nobody being able to
 * perceive it.
 */
async function publishBoardSnapshot(built: ZeroDteBoardPayload): Promise<ZeroDteBoardPayload> {
  try {
    const existing = await sharedCacheGet<ZeroDteBoardPayload>(BOARD_SNAPSHOT_KEY);
    if (existing && !boardSnapshotIsNewer(built.as_of, existing.as_of)) {
      // A fresher snapshot already exists — this build finished late. Serve theirs, publish nothing.
      return existing;
    }
  } catch {
    // Read failed → fall through and publish. A publish that might race is strictly better than
    // a snapshot lane that stops advancing whenever the read path is flaky.
  }
  await sharedCacheSet(BOARD_SNAPSHOT_KEY, built, BOARD_SNAPSHOT_TTL_SEC).catch(() => {});
  return built;
}

/** Build ONE board and publish it as the shared snapshot every replica reads. Used by
 *  the cold/blocking path and by the cron warmer (proactive publish). Best-effort
 *  publish: a failed Redis write still returns a valid board — the fix degrades to the
 *  pre-fix per-replica behaviour, never to a blank board. */
async function buildAndPublishBoard(): Promise<ZeroDteBoardPayload> {
  const built = await buildZeroDteBoardPayload();
  return publishBoardSnapshot(built);
}

/** Single-writer background refresh: only the NX-lock winner rebuilds+publishes this
 *  cycle; every other replica keeps serving the shared snapshot it already read (so the
 *  served board never diverges). Fire-and-forget — errors are swallowed because the
 *  caller already returned a valid (slightly stale) snapshot. */
function refreshSharedBoardInBackground(): void {
  if (backgroundRefreshInflight) return;
  backgroundRefreshInflight = true;
  void (async () => {
    let won = false;
    try {
      won = await sharedCacheSetNx(BOARD_BUILD_LOCK_KEY, Date.now(), BOARD_BUILD_LOCK_TTL_SEC);
    } catch {
      won = false; // lock store unavailable → skip; a fresh reader will cold-build if needed
    }
    if (!won) return; // a peer replica owns this cycle's rebuild
    try {
      await buildAndPublishBoard();
    } catch {
      // Rebuild failed — the previous snapshot stands until the next cycle retries.
    } finally {
      // Free the lock so the NEXT cycle can advance (don't wait out the 20s TTL).
      await sharedCacheDel(BOARD_BUILD_LOCK_KEY).catch(() => {});
    }
  })().finally(() => {
    backgroundRefreshInflight = false;
  });
}

/**
 * Board read — shared by the member route and Largo/BIE consumers.
 *
 * Convergence contract (fix/zerodte-board-convergence): every replica READS the SAME
 * shared Redis snapshot, so any two reads across any two replicas within a cycle return
 * the identical board (mirrors the `nw:optmark:` marks lane). Liveness is preserved by a
 * stale-while-revalidate refresh: a fresh-enough snapshot is served immediately; once it
 * ages past the soft window a single-writer background rebuild advances it. Only a cold
 * miss (or a snapshot too stale to serve) blocks on a build — and that build publishes,
 * so peers converge onto it. Fail-soft throughout: a Redis outage degrades to a local
 * build, never a blank board.
 */
export async function getZeroDteBoardPayload(): Promise<ZeroDteBoardPayload> {
  const shared = await readSharedBoardSnapshot();
  if (shared && shared.ageMs <= BOARD_SNAPSHOT_SERVE_MAX_AGE_MS) {
    // Serve the shared, converged snapshot NOW. Past the soft window, kick a
    // single-writer background rebuild so the next cycle advances — never block on it.
    if (shared.ageMs > BOARD_SNAPSHOT_REFRESH_MS) refreshSharedBoardInBackground();
    return rememberGoodBoard(shared.value);
  }

  // Soft-stale snapshot still in Redis — serve immediately, rebuild in background.
  if (shared && shared.ageMs <= BOARD_STALE_SERVE_MAX_AGE_MS) {
    kickColdBoardBuild();
    return rememberGoodBoard(shared.value);
  }

  if (!coldBuildInflight) {
    coldBuildInflight = runColdBoardBuild().finally(() => {
      coldBuildInflight = null;
    });
  }

  const build = coldBuildInflight;
  const blockMs = zerodteBoardMaxBlockMs();
  return Promise.race([
    build.then(rememberGoodBoard),
    new Promise<ZeroDteBoardPayload>((resolve) => {
      setTimeout(() => {
        void (async () => {
          const snap = await readSharedBoardSnapshot();
          if (snap) {
            resolve(rememberGoodBoard(snap.value));
            return;
          }
          const local = readLastGoodBoardLocal();
          if (local) {
            resolve(local);
            return;
          }
          // Never await the cold build here — that defeats maxBlockMs under load (live: 20–43s
          // member polls). Return a structurally valid empty board immediately; coldBuildInflight
          // keeps running and publishes to Redis for the next poll.
          resolve(buildMinimalBoardFallback());
        })();
      }, blockMs);
    }),
  ]);
}

function kickColdBoardBuild(): void {
  if (coldBuildInflight) return;
  coldBuildInflight = runColdBoardBuild().finally(() => {
    coldBuildInflight = null;
  });
  void coldBuildInflight;
}

async function runColdBoardBuild(): Promise<ZeroDteBoardPayload> {
  const raced = await readSharedBoardSnapshot();
  if (raced && raced.ageMs <= BOARD_SNAPSHOT_SERVE_MAX_AGE_MS) return raced.value;
  return buildAndPublishBoard();
}

/** Last-resort empty board when Redis and build both unavailable (route still 200). */
function buildMinimalBoardFallback(): ZeroDteBoardPayload {
  const today = todayEt();
  const tradingDay = isTradingDayEt(today);
  const { hour, minute } = etNowParts();
  const heat = sessionHeat(hour * 60 + minute, tradingDay);
  const now = new Date().toISOString();
  return {
    available: true,
    as_of: now,
    upstream_ok: false,
    session: { date: today, trading_day: tradingDay, heat },
    setups: [],
    // No scan ran on this path at all, so no lane has a market read to report — the all-`disabled`
    // initial value is the honest one (paired with upstream_ok:false, which is what marks the board
    // itself degraded). Reporting `ok` here would claim two lanes looked and saw nothing.
    discovery_health: initialDiscoveryHealth(),
    ledger: [],
    covered_elsewhere: [],
    governor: null,
    allocation: [],
    market_state: null,
    discovery_funnel: null,
    spx_slayer_badge: null,
  };
}

/** Proactively rebuild + publish the shared board snapshot. Called by the ~1-5 min
 *  cron warmer so the shared snapshot stays live even with no member traffic (mirrors
 *  "the scan/cron builds the board once → writes the shared store"). Blocking on purpose
 *  — the cron awaits it so the publish actually completes before the function returns. */
export async function refreshZeroDteBoardSnapshot(): Promise<ZeroDteBoardPayload> {
  return buildAndPublishBoard();
}

/** Test-only: clear the shared board snapshot + rebuild latches between cases. */
export async function _resetZeroDteBoardSnapshotForTest(): Promise<void> {
  coldBuildInflight = null;
  backgroundRefreshInflight = false;
  lastGoodBoardLocal = null;
  await sharedCacheDel(BOARD_SNAPSHOT_KEY).catch(() => {});
  await sharedCacheDel(BOARD_BUILD_LOCK_KEY).catch(() => {});
}

/** Largo / BIE tool shape — derived from the same board payload the UI polls. */
export async function zeroDtePlaysForLargo(): Promise<Record<string, unknown>> {
  const board = await getZeroDteBoardPayload();
  const { hour, minute } = etNowParts();
  const nowEtMinutes = hour * 60 + minute;
  const byTicker = new Map(board.setups.map((s) => [s.ticker, s]));

  const plays = board.ledger.map((r) => {
    const setup = byTicker.get(r.ticker) ?? null;
    const status = (["OPEN", "HOLD", "TRIM", "CLOSED"].includes(r.status ?? "") ? r.status : "HOLD") as
      | "OPEN"
      | "HOLD"
      | "TRIM"
      | "CLOSED";
    const intel = buildIntelNote({
      status,
      setup,
      plan: setup?.plan ?? null,
      entryPremium: r.entry_premium,
      livePnlPct: r.live_pnl_pct,
      planOutcome: r.plan_outcome,
      planPnlPct: r.plan_pnl_pct,
      nowEtMinutes,
      lastMark: r.last_mark,
    });
    return {
      ticker: r.ticker,
      direction: r.direction,
      strike: r.top_strike,
      status,
      entry_premium: r.entry_premium,
      last_mark: r.last_mark,
      live_pnl_pct: r.live_pnl_pct,
      peak_score: r.score_max,
      action: intel.action,
      intel: intel.reason,
      // Commit-time merit tier (PR-F) — the pinned {tier, factors} blob riding the
      // board row (entry_context passthrough, already read: zero extra IO). Null on
      // pre-wiring rows; Largo cites the letter, never invents one.
      tier: r.tier,
      graded: r.plan_outcome ? { outcome: r.plan_outcome, pnl_pct: r.plan_pnl_pct } : null,
    };
  });

  // Same time-of-day gate ZeroDteBoard.tsx's mergePlays() applies to fresh (not-
  // yet-ledgered) finds — without it, a find surfacing during POWER_HOUR/LATE_SESSION
  // (or after CLOSED, before the ledger sync catches up) got told to Largo as an
  // actionable play even though the product rule (this function's own `rules` string
  // below) is "no new directional plays after 14:00 ET" and the board itself would show it as
  // SKIP/watch-only. A COMMITTED ticker never re-enters this lane (one-way commit
  // door): the ledger row above is the only presentation of that ticker, and the
  // dedupe is case-insensitive so a casing drift can never double-present a play.
  const heatState = board.session.heat.state;
  const sessionClosed = heatState === "CLOSED";
  const committedTickers = new Set(board.ledger.map((row) => row.ticker.toUpperCase()));
  const fresh = sessionClosed
    ? []
    : board.setups
        .filter((s) => !committedTickers.has(s.ticker.toUpperCase()))
        .slice(0, 5)
        .map((s) => {
          const moved = s.plan?.entry_status === "MOVED";
          // Hard-gate-blocked finds are SKIP regardless of clock/liquidity — the gate
          // stack (src/lib/zerodte/gates.ts) already decided this is not committable.
          // Everything else is at most WATCH (never "OPEN" — resolveFreshFindStatus,
          // board.ts): an uncommitted find is a candidate, not a position.
          const status =
            s.gate?.verdict === "BLOCKED"
              ? ("SKIP" as const)
              : resolveFreshFindStatus(heatState, moved, Boolean(s.plan?.illiquid));
          return {
            ticker: s.ticker,
            // Presentation status for the fresh lane — WATCH (candidate) or SKIP
            // (refused). Explicit so Largo never has to infer commitment from the
            // absence of ledger fields.
            status,
            direction: s.direction,
            strike: s.top_strike,
            score: s.score,
            gross_premium: s.gross_premium,
            aggression: s.aggression,
            plan: s.plan,
            // Machine code + human sentence per failing gate (null = clear/ungated) —
            // the same copy the board's SKIP cards render.
            gate_blocks: s.gate?.verdict === "BLOCKED" ? s.gate.blocks : null,
            // Merit tier (PR-F): a refused find IS a decision, so a SKIP carries the
            // F assignment with each failing gate as a "down" factor (gate blocks
            // when hard-gated; tierForSkip's generic factor for chase/liquidity/late
            // refusals). A WATCH candidate is NOT a decision yet — no tier, ever:
            // inventing a provisional grade for an uncommitted find would be exactly
            // the asserted-not-earned labeling the tier engine exists to kill.
            tier: status === "SKIP" ? tierForSkip(s.gate?.verdict === "BLOCKED" ? s.gate.blocks : null) : null,
            // Night Hawk Cortex verdict summary (design §2 "the full evidence table
            // on every card — including SKIPs"): committed finds carry score/
            // conviction + top supports; Cortex-blocked SKIPs carry the veto /
            // net-negative evidence. Null = Cortex never ran (gate-blocked first).
            cortex: cortexSummaryFor(s.cortex),
            intel: buildIntelNote({
              status,
              setup: s,
              plan: s.plan,
              entryPremium: s.plan?.entry_max ?? s.top_strike_avg_fill,
              livePnlPct: null,
              planOutcome: null,
              planPnlPct: null,
              nowEtMinutes,
              lastMark: s.plan?.mark ?? null,
            }).reason,
          };
        });

  return {
    source: "0DTE Command (always-on scanner, /grid)",
    session_date: board.session.date,
    plays,
    fresh_finds: fresh,
    excluded_covered_elsewhere: board.covered_elsewhere,
    rules: "0DTE discipline: new directional plays 10:00–15:30 ET; stop -50%, trim +100%, hard exit 15:50 ET.",
  };
}
