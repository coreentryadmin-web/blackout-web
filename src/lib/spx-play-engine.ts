import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import {
  computeSpxConfluence,
  type SpxConfluence,
  type SpxPlayAction,
  type SpxPlayDirection,
  type SpxSignalFactor,
} from "@/lib/spx-signals";
import { evaluatePlayGates } from "@/lib/spx-play-gates";
import { evaluatePlayConfirmations } from "@/lib/spx-play-confirmations";
import { buildPlayTechnicals, type PlayTechnicals } from "@/lib/spx-play-technicals";
import type { PlayConfirmationResult } from "@/lib/spx-play-confirmations";
import { evaluateClaudePlayApproval, type ClaudePlayVerdict } from "@/lib/spx-play-claude";
import { pickIdleMessage, watchMessage } from "@/lib/spx-play-idle";
import { gradeRank, playFullMinScore, playThesisBreakScore, playTrimMfePts, playWatchMinScore } from "@/lib/spx-play-config";
import {
  closeOpenPlay,
  loadOpenPlay,
  loadPlaySessionMeta,
  openPlay,
  recordBuy,
  updateOpenPlay,
  type OpenPlayRow,
} from "@/lib/spx-play-store";
import { maybeLogSpxPlay } from "@/lib/providers/spx-signal-log";

export type { SpxPlayAction, SpxPlayDirection } from "@/lib/spx-signals";

export type SpxPlayPayload = {
  available: boolean;
  phase: "SCANNING" | "WATCHING" | "OPEN";
  action: SpxPlayAction;
  direction: SpxPlayDirection | null;
  grade: string;
  score: number;
  confidence: number;
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
    warnings: string[];
    entry_mode: string;
  };
  claude: ClaudePlayVerdict | null;
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
  } | null;
  confirmations: PlayConfirmationResult | null;
  technicals: {
    m5_trend: string;
    m5_rsi: number | null;
    m3_close: number | null;
    breakout: PlayTechnicals["breakout"];
  } | null;
  as_of: string;
};

function scanningPayload(
  desk: SpxDeskPayload,
  confluence: SpxConfluence | null,
  idle: string,
  gates?: SpxPlayPayload["gates"]
): SpxPlayPayload {
  return {
    available: Boolean(desk.available && desk.market_open),
    phase: "SCANNING",
    action: "SCANNING",
    direction: confluence?.direction ?? null,
    grade: confluence?.grade ?? "D",
    score: confluence?.score ?? 0,
    confidence: confluence?.confidence ?? 0,
    headline: idle,
    thesis: gates?.blocks[0] ?? "No A+ setup yet — scanning all lanes.",
    idle_message: idle,
    factors: confluence?.factors ?? [],
    levels: confluence?.levels ?? { entry: null, stop: null, target: null, invalidation: "" },
    gates: gates ?? { passed: false, blocks: [], warnings: [], entry_mode: "none" },
    claude: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    as_of: desk.polled_at ?? desk.as_of ?? new Date().toISOString(),
  };
}

function technicalsSummary(tech: PlayTechnicals | null): SpxPlayPayload["technicals"] {
  if (!tech?.available) return null;
  return {
    m5_trend: tech.m5_trend,
    m5_rsi: tech.m5_rsi,
    m3_close: tech.m3_close,
    breakout: tech.breakout,
  };
}

async function evaluateOpenPlay(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  row: OpenPlayRow,
  technicals: PlayTechnicals | null,
  confirmations: PlayConfirmationResult | null
): Promise<SpxPlayPayload> {
  const price = desk.price;
  const dir = row.direction;
  const mfe = Math.max(row.mfe_pts, dir === "long" ? price - row.entry_price : row.entry_price - price);
  const mae = Math.max(row.mae_pts, dir === "long" ? row.entry_price - price : price - row.entry_price);
  await updateOpenPlay(row.id, { mfe_pts: mfe, mae_pts: mae });

  let action: SpxPlayAction = "HOLD";
  let headline = `${row.grade} ${dir === "long" ? "CALL" : "PUT"} working`;
  let thesis = `Managing open ${dir} from ${row.entry_price.toFixed(2)} — thesis intact.`;

  const stop = row.stop;
  const target = row.target;

  const stopHit =
    stop != null &&
    (dir === "long" ? price <= stop : price >= stop);
  const targetHit =
    target != null &&
    (dir === "long" ? price >= target : price <= target);

  const thesisBreak =
    dir === "long"
      ? confluence.score <= -playThesisBreakScore()
      : confluence.score >= playThesisBreakScore();

  const trimZone =
    !row.trim_done &&
    mfe >= playTrimMfePts() &&
    target != null &&
    (dir === "long"
      ? target - price <= Math.max(4, (target - row.entry_price) * 0.2)
      : price - target <= Math.max(4, (row.entry_price - target) * 0.2));

  if (stopHit || thesisBreak || !desk.market_open) {
    action = "SELL";
    headline = stopHit
      ? "STOP — structure broken"
      : !desk.market_open
        ? "SESSION FLAT — close 0DTE"
        : "THESIS BREAK — exit";
    thesis = stopHit
      ? `Price ${price.toFixed(2)} through stop ${stop?.toFixed(0)}. Flatten.`
      : thesisBreak
        ? `Confluence flipped against ${dir} position (score ${confluence.score}).`
        : "Cash session closed — flatten runners.";
    await closeOpenPlay(row.id, {
      was_loss: stopHit || thesisBreak,
      direction: dir,
    });
    void maybeLogSpxPlay(
      { price: desk.price, market_open: desk.market_open },
      {
      action: "SELL",
      direction: dir,
      grade: row.grade,
      score: confluence.score,
      confidence: confluence.confidence,
      headline,
      thesis,
      factors: confluence.factors,
      levels: { entry: row.entry_price, stop: row.stop, target: row.target, invalidation: confluence.levels.invalidation },
    }).catch(() => undefined);
  } else if (targetHit) {
    action = "SELL";
    headline = "TARGET — take profit";
    thesis = `Hit target zone ${target?.toFixed(0)} from ${row.entry_price.toFixed(2)}.`;
    await closeOpenPlay(row.id, { was_loss: false, direction: dir });
    void maybeLogSpxPlay(
      { price: desk.price, market_open: desk.market_open },
      {
      action: "SELL",
      direction: dir,
      grade: row.grade,
      score: confluence.score,
      confidence: confluence.confidence,
      headline,
      thesis,
      factors: confluence.factors,
      levels: { entry: row.entry_price, stop: row.stop, target: row.target, invalidation: confluence.levels.invalidation },
    }).catch(() => undefined);
  } else if (trimZone) {
    action = "TRIM";
    headline = "TRIM — bank partial, trail runner";
    thesis = `+${mfe.toFixed(1)} pts MFE into target — trim ~50%, hold runner.`;
    await updateOpenPlay(row.id, { trim_done: true });
    void maybeLogSpxPlay(
      { price: desk.price, market_open: desk.market_open },
      {
      action: "TRIM",
      direction: dir,
      grade: row.grade,
      score: confluence.score,
      confidence: confluence.confidence,
      headline,
      thesis,
      factors: confluence.factors,
      levels: { entry: row.entry_price, stop: row.stop, target: row.target, invalidation: confluence.levels.invalidation },
    }).catch(() => undefined);
  }

  return {
    available: true,
    phase: action === "SELL" ? "SCANNING" : "OPEN",
    action,
    direction: dir,
    grade: row.grade,
    score: confluence.score,
    confidence: confluence.confidence,
    headline,
    thesis,
    idle_message: null,
    factors: confluence.factors,
    levels: {
      entry: row.entry_price,
      stop: row.stop,
      target: row.target,
      invalidation: confluence.levels.invalidation,
    },
    gates: { passed: false, blocks: [], warnings: [], entry_mode: "none" },
    claude: null,
    open_play:
      action === "SELL"
        ? null
        : {
            id: row.id,
            direction: dir,
            entry_price: row.entry_price,
            stop: row.stop,
            target: row.target,
            grade: row.grade,
            opened_at: row.opened_at,
            mfe_pts: mfe,
            trim_done: row.trim_done || action === "TRIM",
          },
    confirmations,
    technicals: technicalsSummary(technicals),
    as_of: confluence.as_of,
  };
}

async function evaluateFlatPlay(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  technicals: PlayTechnicals,
  confirmations: PlayConfirmationResult
): Promise<SpxPlayPayload> {
  const session = await loadPlaySessionMeta();
  const gates = evaluatePlayGates(desk, confluence, session, confirmations);
  const abs = Math.abs(confluence.score);
  const techSum = technicalsSummary(technicals);

  const nearMiss =
    gradeRank(confluence.grade) >= 3 &&
    abs >= playFullMinScore() - 8 &&
    confirmations.passed_count >= confirmations.total - 2 &&
    !gates.passed;

  if (nearMiss) {
    const dirLabel = confluence.direction === "long" ? "bullish" : "bearish";
    return {
      ...scanningPayload(desk, confluence, watchMessage(confluence.grade, dirLabel), {
        passed: false,
        blocks: gates.blocks,
        warnings: gates.warnings,
        entry_mode: gates.entry_mode,
      }),
      phase: "WATCHING",
      action: "WATCHING",
      headline: `${confluence.grade} ${dirLabel} — almost there`,
      thesis: gates.blocks[0] ?? `High-quality setup building (${confirmations.passed_count}/${confirmations.total} checks).`,
      idle_message: null,
      claude: null,
      confirmations,
      technicals: techSum,
    };
  }

  if (!gates.passed) {
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), {
        passed: false,
        blocks: gates.blocks,
        warnings: gates.warnings,
        entry_mode: gates.entry_mode,
      }),
      confirmations,
      technicals: techSum,
    };
  }

  const claude = await evaluateClaudePlayApproval(desk, confluence, gates, confirmations, technicals);

  if (!claude.approved || !confluence.direction) {
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), {
        passed: false,
        blocks: claude.verdict === "VETO" ? [`Claude veto: ${claude.headline}`] : gates.blocks,
        warnings: gates.warnings,
        entry_mode: gates.entry_mode,
      }),
      phase: "SCANNING",
      action: "SCANNING",
      headline: claude.headline,
      thesis: claude.thesis,
      claude,
      confirmations,
      technicals: techSum,
    };
  }

  const direction = confluence.direction;
  const existingBeforeOpen = await loadOpenPlay();
  if (existingBeforeOpen) {
    return evaluateOpenPlay(desk, confluence, existingBeforeOpen, technicals, confirmations);
  }

  const sessionDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());

  const opened = await openPlay({
    session_date: sessionDate,
    direction,
    entry_price: desk.price,
    stop: confluence.levels.stop,
    target: confluence.levels.target,
    grade: confluence.grade,
    headline: claude.headline,
    opened_at: new Date().toISOString(),
  });

  await recordBuy(direction);

  void maybeLogSpxPlay(
    { price: desk.price, market_open: desk.market_open },
    {
      action: "BUY",
      direction,
      grade: confluence.grade,
      score: confluence.score,
      confidence: confluence.confidence,
      headline: claude.headline,
      thesis: claude.thesis,
      factors: confluence.factors,
      levels: confluence.levels,
    }
  ).catch(() => undefined);

  return {
    available: true,
    phase: "OPEN",
    action: "BUY",
    direction,
    grade: confluence.grade,
    score: confluence.score,
    confidence: confluence.confidence,
    headline: claude.headline,
    thesis: claude.thesis,
    idle_message: null,
    factors: confluence.factors,
    levels: confluence.levels,
    gates: {
      passed: true,
      blocks: [],
      warnings: gates.warnings,
      entry_mode: gates.entry_mode,
    },
    claude,
    open_play: {
      id: opened.id,
      direction,
      entry_price: opened.entry_price,
      stop: opened.stop,
      target: opened.target,
      grade: opened.grade,
      opened_at: opened.opened_at,
      mfe_pts: 0,
      trim_done: false,
    },
    confirmations,
    technicals: techSum,
    as_of: confluence.as_of,
  };
}

export async function evaluateSpxPlay(
  desk: SpxDeskPayload,
  prefetchedTechnicals?: PlayTechnicals | null
): Promise<SpxPlayPayload> {
  if (!desk.market_open) {
    return {
      available: false,
      phase: "SCANNING",
      action: "SCANNING",
      direction: null,
      grade: "D",
      score: 0,
      confidence: 0,
      headline: "Session closed",
      thesis: `Desk offline · ${desk.market_label ?? "CLOSED"} · resumes 6:30 AM PT`,
      idle_message: null,
      factors: [],
      levels: { entry: null, stop: null, target: null, invalidation: "" },
      gates: { passed: false, blocks: ["Session closed"], warnings: [], entry_mode: "none" },
      claude: null,
      open_play: null,
      confirmations: null,
      technicals: null,
      as_of: desk.polled_at ?? desk.as_of ?? new Date().toISOString(),
    };
  }

  const technicals =
    prefetchedTechnicals ??
    (await buildPlayTechnicals(desk.price, {
      vwap: desk.vwap,
      pdh: desk.pdh,
      pdl: desk.pdl,
      hod: desk.hod,
      lod: desk.lod,
    }));

  const confluence = computeSpxConfluence(desk);
  if (!confluence) {
    return scanningPayload(desk, null, pickIdleMessage());
  }

  const confirmations = evaluatePlayConfirmations(desk, confluence, technicals);

  const open = await loadOpenPlay();
  if (open) {
    return evaluateOpenPlay(desk, confluence, open, technicals, confirmations);
  }

  return evaluateFlatPlay(desk, confluence, technicals, confirmations);
}
