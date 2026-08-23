import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type {
  SpxConfluence,
  SpxPlayAction,
  SpxPlayDirection,
  SpxSignalFactor,
} from "@/features/spx/lib/spx-signals";
import type { PlayGateResult } from "@/features/spx/lib/spx-play-gates";
import { emptyCategorizedGateBlocks } from "@/features/spx/lib/playbook-gate-categories";
import { isBeforeCashOpen, isPremarketPlanningWindow } from "@/features/spx/lib/spx-play-session-guards";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-play-lotto";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import type { PlayConfirmationResult } from "@/features/spx/lib/spx-play-confirmations";
import type { ClaudePlayVerdict } from "@/features/spx/lib/spx-play-claude";
import type { ZeroDteCortexSummary } from "@/lib/zerodte/cortex-gate";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import { buildPlayIdeaIntel, humanizeGateBlock, humanizeGateBlocks } from "@/features/spx/lib/spx-play-intel";
import type { MtfHybrid } from "@/features/spx/lib/spx-play-mtf";
import type { loadAdaptivePlayGates } from "@/features/spx/lib/spx-play-telemetry";
import type { OptionTicket } from "@/features/spx/lib/spx-play-options";
import type { SpxPlayDeskContext } from "@/features/spx/lib/spx-play-context";

export type SpxPlayPayload = {
  available: boolean;
  phase: "SCANNING" | "WATCHING" | "OPEN";
  action: SpxPlayAction;
  direction: SpxPlayDirection | null;
  grade: string;
  score: number;
  rawScore: number;
  headline: string;
  thesis: string;
  idle_message: string | null;
  factors: SpxSignalFactor[];
  levels: {
    entry: number | null;
    stop: number | null;
    target: number | null;
    invalidation: string;
  };
  gates: {
    passed: boolean;
    blocks: string[];
    blocks_by_category?: PlayGateResult["blocks_by_category"];
    first_block_category?: PlayGateResult["first_block_category"];
    warnings: string[];
    entry_mode: string;
    play_idea: string | null;
  };
  claude: ClaudePlayVerdict | null;
  cortex: ZeroDteCortexSummary | null;
  open_play: {
    id: number;
    direction: SpxPlayDirection;
    entry_price: number;
    stop: number | null;
    target: number | null;
    grade: string;
    opened_at: string;
    mfe_pts: number;
    trim_done: boolean;
    option_label?: string | null;
    option_premium?: string | null;
    option_pnl_est?: import("@/features/spx/lib/playbook-option-pnl").OptionPnlEstimate | null;
  } | null;
  confirmations: PlayConfirmationResult | null;
  technicals: {
    m5_trend: string;
    m5_rsi: number | null;
    m5_rsi_warning: string | null;
    m3_close: number | null;
    breakout: PlayTechnicals["breakout"];
    mtf_summary: string | null;
  } | null;
  mtf: MtfHybrid | null;
  option_ticket: OptionTicket | null;
  watch: {
    active: boolean;
    promote_ready: boolean;
    reason: string;
    since: string | null;
  } | null;
  telemetry: {
    adaptive_active: boolean;
    summary: string;
    cold_buy_win_rate: number | null;
    promote_win_rate: number | null;
    global_score_boost: number;
    promote_score_boost: number;
    total_closed: number;
  } | null;
  lotto_play: LottoPlayPayload | null;
  power_play: PowerHourPlayPayload | null;
  session_phase: "premarket" | "cash" | "closed";
  /**
   * True only when the system has committed a play to the DB in this evaluation cycle.
   * False on the read-only (mutate:false) member snapshot path — even when action:"BUY"
   * is returned, the system has not yet opened the position. Members should wait for a
   * true signal_committed BUY before acting, not the snapshot signal alone.
   */
  signal_committed: boolean;
  /**
   * False ONLY when no confluence was computed for this payload — i.e. the desk produced no
   * assessment at all (engine timeout/error, or computeSpxConfluence() returned null). In that
   * case `grade`/`score`/`rawScore` are placeholder literals ("D"/0/0), NOT a measurement: a
   * "D" here means "nothing was graded", not "graded and it's a D". Absent (undefined) means the
   * payload predates this flag or was built from a real confluence — readers must treat only an
   * explicit `false` as absence, so no existing producer is retroactively marked unassessed.
   *
   * Exists because the two states are otherwise indistinguishable downstream: the verdict bar was
   * rendering "Grade D · 0" to a member on a desk that had assessed nothing (Largo product
   * contract, point 3 — absence must be representable, never published as a measurement).
   */
  assessed?: boolean;
  /** Phase-1 playbook matcher — shadow telemetry surfaced for staging validation only. */
  playbook_shadow?: PlaybookShadowPanel | null;
  desk_context?: SpxPlayDeskContext;
  as_of: string;
};

export function pnlPts(direction: SpxPlayDirection, entry: number, exit: number): number {
  return direction === "long" ? exit - entry : entry - exit;
}

export function currentSessionPhase(desk: SpxDeskPayload): SpxPlayPayload["session_phase"] {
  if (isPremarketPlanningWindow() && isBeforeCashOpen()) return "premarket";
  if (desk.market_open) return "cash";
  return "closed";
}

export function telemetrySummary(
  adaptive: Awaited<ReturnType<typeof loadAdaptivePlayGates>>
): SpxPlayPayload["telemetry"] {
  const { stats } = adaptive;
  return {
    adaptive_active: adaptive.active,
    summary: adaptive.summary,
    cold_buy_win_rate: stats.cold_buy.count > 0 ? stats.cold_buy.win_rate : null,
    promote_win_rate: stats.watch_promote.count > 0 ? stats.watch_promote.win_rate : null,
    global_score_boost: adaptive.global_min_score_boost,
    promote_score_boost: adaptive.promote_min_score_boost,
    total_closed: stats.total_closed,
  };
}

export function intelGates(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  gates: PlayGateResult
): SpxPlayPayload["gates"] {
  const play_idea = gates.play_idea ?? buildPlayIdeaIntel(desk, confluence);
  return {
    passed: gates.passed,
    // Dedupe exact duplicates so the payload (and every consumer — desk panel,
    // Largo get_spx_play) never carries repeated gate lines. Display-only: the
    // pass/fail decision is computed from the raw blocks in evaluatePlayGates.
    blocks: Array.from(new Set(humanizeGateBlocks(gates.blocks, desk, confluence))),
    blocks_by_category: gates.blocks_by_category,
    first_block_category: gates.first_block_category,
    warnings: gates.warnings,
    entry_mode: gates.entry_mode,
    play_idea,
  };
}

/** Safe fallback when play eval times out or the route errors — must satisfy SpxPlayPayload so UI never crashes on missing `levels`. */
export function degradedPlayPayload(
  extras?: Partial<SpxPlayPayload>
): SpxPlayPayload {
  const asOf = new Date().toISOString();
  return {
    available: false,
    phase: "SCANNING",
    action: "SCANNING",
    direction: null,
    grade: "D",
    score: 0,
    rawScore: 0,
    // Nothing was evaluated on this path — the three literals above are placeholders, not a grade.
    assessed: false,
    headline: "Desk warming — play state unavailable",
    thesis: "Scanning all lanes.",
    idle_message: "Desk warming — play state unavailable",
    factors: [],
    levels: { entry: null, stop: null, target: null, invalidation: "" },
    gates: {
      passed: false,
      blocks: [],
      blocks_by_category: emptyCategorizedGateBlocks(),
      first_block_category: null,
      warnings: [],
      entry_mode: "none",
      play_idea: null,
    },
    claude: null,
    cortex: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
    lotto_play: null,
    power_play: null,
    session_phase: "closed",
    signal_committed: false,
    playbook_shadow: null,
    as_of: asOf,
    degraded: true,
    ...extras,
  } as SpxPlayPayload;
}

/** API contract: SCANNING must not expose confirmation checks (stale-layer guard). */
export function confirmationsForAction(
  action: SpxPlayAction,
  confirmations: PlayConfirmationResult | null
): PlayConfirmationResult | null {
  return action === "SCANNING" ? null : confirmations;
}

export function scanningPayload(
  desk: SpxDeskPayload,
  confluence: SpxConfluence | null,
  idle: string,
  gates?: SpxPlayPayload["gates"],
  extras?: Partial<SpxPlayPayload>
): SpxPlayPayload {
  const playIdea =
    gates?.play_idea ??
    (confluence ? buildPlayIdeaIntel(desk, confluence) : null);
  const thesis =
    playIdea ??
    (confluence ? humanizeGateBlock(gates?.blocks[0] ?? "", desk, confluence) : null) ??
    gates?.blocks[0] ??
    "No A+ setup yet — scanning all lanes.";

  return {
    available: Boolean(desk.available && (desk.market_open || isPremarketPlanningWindow())),
    phase: "SCANNING",
    action: "SCANNING",
    direction: confluence?.direction ?? null,
    grade: confluence?.grade ?? "D",
    score: confluence?.score ?? 0,
    rawScore: confluence?.rawScore ?? 0,
    // Without a confluence the three fields above are the `??` fallbacks, not an assessment.
    assessed: confluence != null,
    headline: idle,
    thesis,
    idle_message: idle,
    factors: confluence?.factors ?? [],
    levels: confluence?.levels ?? { entry: null, stop: null, target: null, invalidation: "" },
    gates: gates ?? {
      passed: false,
      blocks: [],
      blocks_by_category: emptyCategorizedGateBlocks(),
      first_block_category: null,
      warnings: [],
      entry_mode: "none",
      play_idea: null,
    },
    claude: null,
    cortex: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
    lotto_play: null,
    power_play: null,
    session_phase: currentSessionPhase(desk),
    signal_committed: false,
    playbook_shadow: null,
    as_of: desk.polled_at ?? desk.as_of ?? new Date().toISOString(),
    ...extras,
  };
}

export function technicalsSummary(
  tech: PlayTechnicals | null,
  mtf: MtfHybrid | null
): SpxPlayPayload["technicals"] {
  if (!tech?.available) return null;
  return {
    m5_trend: tech.m5_trend,
    m5_rsi: tech.m5_rsi,
    m5_rsi_warning: tech.m5_rsi_warning,
    m3_close: tech.m3_close,
    breakout: tech.breakout,
    mtf_summary: mtf?.summary ?? null,
  };
}
