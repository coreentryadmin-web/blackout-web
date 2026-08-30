import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import {
  pinPlayAlignmentHint,
  resolveSpxPlayContractChip,
} from "@/features/spx/lib/spx-play-contract-label";
import type { SpxPinForecast } from "@/features/spx/lib/spx-pin";
import {
  categorizeGateBlocks,
  type CategorizedGateBlocks,
} from "@/features/spx/lib/playbook-gate-categories";

export type PlayVerdictMode = "loading" | "closed" | "open" | "watch" | "hunting";

export type PlayVerdictBarModel = {
  mode: PlayVerdictMode;
  badge: string;
  direction: "long" | "short" | null;
  contract: string | null;
  grade: string | null;
  score: number | null;
  pnlLabel: string | null;
  pnlTone: "up" | "down" | "flat";
  levelsLine: string | null;
  statusLine: string;
  detailLine: string | null;
  gateLine: string | null;
  gateCategories: CategorizedGateBlocks | null;
  trimHint: string | null;
  signalCommitted: boolean;
  /** When pin magnet drift and structure play direction diverge. */
  alignHint: string | null;
};

const fmt = (n: number | null | undefined, d = 0) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function contractLabel(play: SpxPlayPayload): string | null {
  return resolveSpxPlayContractChip(play);
}

function levelsLine(play: SpxPlayPayload): string | null {
  const entry = play.open_play?.entry_price ?? play.levels?.entry;
  const stop = play.open_play?.stop ?? play.levels?.stop;
  const target = play.open_play?.target ?? play.levels?.target;
  if (entry == null && stop == null && target == null) return null;
  const parts: string[] = [];
  if (entry != null) parts.push(`entry ${fmt(entry, 2)}`);
  if (stop != null) parts.push(`stop ${fmt(stop, 2)}`);
  if (target != null) parts.push(`tgt ${fmt(target, 2)}`);
  return parts.join(" · ");
}

function pnlFromPlay(play: SpxPlayPayload): { label: string | null; tone: "up" | "down" | "flat" } {
  const est = play.open_play?.option_pnl_est;
  if (est && Number.isFinite(est.net_premium_pnl)) {
    const n = est.net_premium_pnl;
    return {
      label: `${n >= 0 ? "+" : ""}$${n.toFixed(2)} est Δ`,
      tone: n > 0.05 ? "up" : n < -0.05 ? "down" : "flat",
    };
  }
  const mfe = play.open_play?.mfe_pts;
  if (mfe != null && Number.isFinite(mfe) && mfe > 0) {
    return { label: `MFE +${mfe.toFixed(1)} pts`, tone: "up" };
  }
  return { label: null, tone: "flat" };
}

function actionBadge(play: SpxPlayPayload): string {
  if (play.phase === "OPEN" || play.open_play) {
    if (play.action === "TRIM") return "TRIM";
    if (play.action === "SELL") return "EXIT";
    if (play.action === "HOLD") return "OPEN";
    if (play.action === "BUY") return play.signal_committed ? "OPEN" : "SIGNAL";
    return "OPEN";
  }
  if (play.phase === "WATCHING" || play.action === "WATCHING" || play.watch?.active) return "WATCH";
  return "HUNTING";
}

function resolveMode(play: SpxPlayPayload | null, sessionActive: boolean, loading: boolean): PlayVerdictMode {
  if (loading && !play) return "loading";
  if (!sessionActive || play?.session_phase === "closed") return "closed";
  if (!play?.available) return "hunting";
  if (play.phase === "OPEN" || play.open_play) return "open";
  if (play.phase === "WATCHING" || play.watch?.active || play.action === "WATCHING") return "watch";
  return "hunting";
}

/** Pure view-model for the compact SPX Play Verdict Bar under the EOD Pin Forecaster. */
export function buildPlayVerdictBarModel(
  play: SpxPlayPayload | null,
  opts: { sessionActive: boolean; loading: boolean; pin?: SpxPinForecast | null }
): PlayVerdictBarModel {
  const mode = resolveMode(play, opts.sessionActive, opts.loading);
  const emptyAlign = { alignHint: null as string | null };

  if (mode === "loading") {
    return {
      mode,
      badge: "…",
      direction: null,
      contract: null,
      grade: null,
      score: null,
      pnlLabel: null,
      pnlTone: "flat",
      levelsLine: null,
      statusLine: "Loading Slayer play…",
      detailLine: null,
      gateLine: null,
      gateCategories: null,
      trimHint: null,
      signalCommitted: false,
      ...emptyAlign,
    };
  }

  if (mode === "closed") {
    return {
      mode,
      badge: "CLOSED",
      direction: null,
      contract: null,
      grade: null,
      score: null,
      pnlLabel: null,
      pnlTone: "flat",
      levelsLine: null,
      statusLine: "Session closed — play engine idle until next RTH.",
      detailLine: null,
      gateLine: null,
      gateCategories: null,
      trimHint: null,
      signalCommitted: false,
      ...emptyAlign,
    };
  }

  if (!play) {
    return {
      mode: "hunting",
      badge: "HUNTING",
      direction: null,
      contract: null,
      grade: null,
      score: null,
      pnlLabel: null,
      pnlTone: "flat",
      levelsLine: null,
      statusLine: "Desk warming — waiting for live play state.",
      detailLine: null,
      gateLine: null,
      gateCategories: null,
      trimHint: null,
      signalCommitted: false,
      ...emptyAlign,
    };
  }

  const badge = actionBadge(play);
  const contract = contractLabel(play);
  const levels = levelsLine(play);
  const pnl = mode === "open" ? pnlFromPlay(play) : { label: null as string | null, tone: "flat" as const };
  const gateLine =
    !play.gates.passed && play.gates.blocks[0]
      ? play.gates.blocks[0]
      : play.gates.warnings[0] ?? null;

  const gateCategories =
    play.gates.passed && play.gates.warnings.length === 0
      ? null
      : categorizeGateBlocks([...play.gates.blocks, ...play.gates.warnings]);

  let statusLine = play.headline || play.thesis || play.idle_message || "Scanning all lanes.";
  if (mode === "watch" && play.watch?.reason) statusLine = play.watch.reason;
  if (mode === "open" && play.thesis) statusLine = play.thesis;

  const detailLine =
    mode === "hunting" || mode === "watch"
      ? play.gates.play_idea ?? play.thesis ?? null
      : null;

  const trimHint =
    play.open_play?.trim_done
      ? "Trim logged — runner on trail"
      : play.action === "TRIM"
        ? "Trim zone — scale partial"
        : null;

  // `assessed === false` means the payload carries the placeholder "D"/0 literals because no
  // confluence was computed at all (see SpxPlayPayload.assessed). "D" is truthy and 0 is finite,
  // so both sail straight through the fallthrough below and the bar renders "Grade D · 0" — a
  // measurement the desk never made. Publish absence instead; the status line still explains why.
  const assessed = play.assessed !== false;

  const playDirection = play.direction ?? play.open_play?.direction ?? null;
  const alignHint = pinPlayAlignmentHint(playDirection, opts.pin?.magnet?.direction);

  return {
    mode,
    badge,
    direction: playDirection,
    contract,
    grade: assessed ? play.grade || play.open_play?.grade || null : play.open_play?.grade ?? null,
    score: assessed && Number.isFinite(play.score) ? play.score : null,
    pnlLabel: pnl.label,
    pnlTone: pnl.tone,
    levelsLine: levels,
    statusLine,
    detailLine,
    gateLine,
    gateCategories,
    trimHint,
    signalCommitted: play.signal_committed,
    alignHint,
  };
}
