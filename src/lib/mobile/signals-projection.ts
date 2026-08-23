import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { NightHawkEdition, PlaybookPlay } from "@/features/nighthawk/lib/types";

/**
 * SignalLifecycle enum from apps/blackout-ios-native/BlackOut/Features/Signals/
 * SignalLifecycle.swift — mirrored verbatim so the app never invents a stage.
 */
export type SignalPhase =
  | "detected"
  | "confirming"
  | "active"
  | "managing"
  | "closed"
  | "invalidated"
  | "graded";

export type SignalSource = "SPX_SLAYER" | "NIGHT_HAWK";

export type Signal = {
  id: string;
  source: SignalSource;
  ticker: string;
  direction: string | null;
  action: string;
  grade: string | null;
  score: number | null;
  rawScore: number | null;
  phase: SignalPhase;
  headline: string;
  thesis: string;
  entry: number | string | null;
  stop: number | string | null;
  target: number | string | null;
  invalidation: string | null;
  factors: string[];
  asOf: string | null;
  meta: {
    conviction?: string;
    optionsPlay?: string;
    rank?: number;
    pulled?: boolean;
    pulledReason?: string;
    gatePromoted?: boolean;
    ivRank?: number;
    flowStreakDays?: number;
    editionFor?: string;
    entryMode?: string;
  };
};

/**
 * Map an SPX Slayer play snapshot to a lifecycle stage. The SPX engine emits
 * three "phases" today (SCANNING / WATCHING / OPEN) plus an action verb; we
 * translate to the app's 7-stage lifecycle so filter chips work identically
 * across sources.
 */
export function spxPhaseFor(play: SpxPlayPayload): SignalPhase {
  if (play.open_play) return "active";
  if (play.phase === "OPEN") return "active";
  if (play.phase === "WATCHING") return "confirming";
  return "detected";
}

/**
 * Night Hawk plays: PULLED → invalidated, otherwise active until the session
 * closes. A `stale` edition (yesterday's, served because tonight's isn't
 * published yet) stays `detected` — the app must not paint yesterday's plays
 * as "active today".
 */
export function nighthawkPhaseFor(play: PlaybookPlay, editionStale: boolean): SignalPhase {
  if (play.pulled) return "invalidated";
  if (editionStale) return "detected";
  return "active";
}

export function spxToSignal(play: SpxPlayPayload): Signal | null {
  if (!play.available && play.phase === "SCANNING" && !play.headline && !play.thesis) return null;
  const asOf = play.as_of ?? null;
  const id = play.open_play
    ? `spx-open-${play.open_play.id}`
    : `spx-${play.phase}-${asOf ?? "unknown"}`;
  return {
    id,
    source: "SPX_SLAYER",
    ticker: "SPX",
    direction: play.direction,
    action: play.action,
    grade: play.grade ?? null,
    score: Number.isFinite(play.score) ? play.score : null,
    rawScore: Number.isFinite(play.rawScore) ? play.rawScore : null,
    phase: spxPhaseFor(play),
    headline: play.headline || play.idle_message || "SPX desk",
    thesis: play.thesis || play.headline || "",
    entry: play.open_play?.entry_price ?? play.levels.entry ?? null,
    stop: play.open_play?.stop ?? play.levels.stop ?? null,
    target: play.open_play?.target ?? play.levels.target ?? null,
    invalidation: play.levels.invalidation || null,
    factors: (play.factors ?? []).map((f) => f.label).filter(Boolean),
    asOf,
    meta: {
      entryMode: play.gates.entry_mode,
      optionsPlay: play.option_ticket?.contract_label || undefined,
    },
  };
}

export function nighthawkToSignals(edition: NightHawkEdition): Signal[] {
  if (!edition.available || !edition.plays.length) return [];
  const stale = Boolean(edition.stale);
  return edition.plays.map((play) => ({
    id: `nh-${edition.edition_for ?? "unknown"}-${play.rank}-${play.ticker}`,
    source: "NIGHT_HAWK" as const,
    ticker: play.ticker,
    direction: play.direction,
    action: play.pulled ? "PULLED" : "OPEN",
    grade: play.conviction || null,
    score:
      typeof play.score === "number" && Number.isFinite(play.score) ? play.score : null,
    rawScore: null,
    phase: nighthawkPhaseFor(play, stale),
    headline: `${play.ticker} ${play.direction}`,
    thesis: play.thesis || play.key_signal || "",
    entry: play.entry_range || null,
    stop: play.stop || null,
    target: play.target || null,
    invalidation: play.stop || null,
    factors: play.key_signal ? [play.key_signal] : [],
    asOf: edition.published_at,
    meta: {
      conviction: play.conviction || undefined,
      optionsPlay: play.options_play || undefined,
      rank: play.rank,
      pulled: play.pulled,
      pulledReason: play.pulled_reason,
      gatePromoted: play.gate_promoted,
      ivRank: typeof play.iv_rank === "number" ? play.iv_rank : undefined,
      flowStreakDays:
        typeof play.flow_streak_days === "number" ? play.flow_streak_days : undefined,
      editionFor: edition.edition_for ?? undefined,
    },
  }));
}

/**
 * Ordering rule for the feed: active first, then confirming, then detected,
 * then managing/closed/invalidated/graded. Within a stage the higher score
 * wins; ties broken by asOf (newest first). This is the order the app
 * renders when the filter chip is "All".
 */
const STAGE_WEIGHT: Record<SignalPhase, number> = {
  active: 0,
  managing: 1,
  confirming: 2,
  detected: 3,
  closed: 4,
  invalidated: 5,
  graded: 6,
};

export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => {
    const s = STAGE_WEIGHT[a.phase] - STAGE_WEIGHT[b.phase];
    if (s !== 0) return s;
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sa !== sb) return sb - sa;
    const ta = a.asOf ? Date.parse(a.asOf) : 0;
    const tb = b.asOf ? Date.parse(b.asOf) : 0;
    return tb - ta;
  });
}
