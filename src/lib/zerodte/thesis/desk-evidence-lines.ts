import { ARCHETYPE_LABEL } from "./archetype";
import type { LegacyBridgeExtras } from "./rails/legacy-bridge";
import type { MergedThesis, ThesisPipelineResult, ThesisRankTier, ThesisRail } from "./types";

export type DeskProduct = "HELIX" | "THERMAL" | "VECTOR" | "NIGHTHAWK" | "MERIDIAN";

export type DeskEvidenceStatus = "aligned" | "neutral" | "opposed" | "unavailable";

/**
 * Display label for a desk's evidence chip. `"neutral"` covers several real, distinct causes
 * here (an explicit upstream "mixed" bias reading, a below-threshold-but-not-opposing rail
 * score, a structurally-non-confirming-non-opposing read) — none of which is "the desk saw
 * conflicting bullish and bearish evidence." Labeling it "mixed" overstates the one case that
 * actually is a mixed reading and mislabels the other two, which is exactly the NO DATA /
 * NEUTRAL / OPPOSED conflation `docs/audit/NIGHTHAWK-3RAIL-REDESIGN.md` §1 explicitly calls out
 * as a fabricated distinction the desk-evidence display must not make (found 2026-08-31: two
 * components, `DeskEvidenceStack.tsx` and `ThesisRankCard.tsx`, both independently mapped
 * `"neutral"` → the string `"mixed"`).
 */
export function deskEvidenceStatusLabel(status: DeskEvidenceStatus): string {
  switch (status) {
    case "aligned":
      return "aligned";
    case "opposed":
      return "opp";
    case "neutral":
      return "neutral";
    default:
      return "—";
  }
}

export type DeskEvidenceLine = {
  desk: DeskProduct;
  status: DeskEvidenceStatus;
  text: string;
};

export type BuildDeskEvidenceInput = {
  thesis: MergedThesis;
  rank_tier?: ThesisRankTier;
  extras?: LegacyBridgeExtras;
};

const DESK_ORDER: readonly DeskProduct[] = [
  "HELIX",
  "THERMAL",
  "VECTOR",
  "NIGHTHAWK",
  "MERIDIAN",
];

// BUG FIX (round 530 DISCOVERY sweep): this was a drifted, un-exported local copy of the
// shared money-formatter shape (see `fmt-money.ts`'s own `fmtPremium` and its many siblings:
// `thermal-discord-card.ts`'s `fmtCompactHeatMoney`, `zerodte-board-format.ts`'s `fmtMoney`,
// `vector-crosshair-format.ts`'s `fmtGex`, etc) with TWO real defects.
//
// (1) No billions tier at all. `formatHelixLine` feeds this `extras.helix_gross_premium` —
//     `aggregateHelixTapeByTicker`'s per-ticker SUM of every flow_alerts premium in the scan
//     window (helix-tape-extras.ts), uncapped above its own $200K display floor — so a busy
//     ticker's aggregate tape routinely clears $1B. That rendered a literal four-digit
//     overflow like "$1500.0M" instead of "$1.5B" in the real "HELIX" desk-evidence line a
//     member reads on the 0DTE thesis stack.
// (2) No round-first-then-promote guard at the K->M boundary either: `Math.round(n / 1_000)`
//     picked the K unit off the RAW value, then rounded the quotient — so a value that rounds
//     UP to 1000 of the smaller unit (e.g. 999_600 -> round(999.6) = 1000) rendered "$1000K"
//     instead of promoting to "$1.0M". Same root defect shape, one tier down.
//
// Fix: compute each candidate unit's ROUNDED magnitude BEFORE deciding whether it crossed into
// the next tier, promoting when it did — the same pattern already shipped across the repo's
// other money formatters (e.g. `zerodte-board-format.ts`'s `fmtMoney`, directly adjacent to
// this module in the Night Hawk feature tree).
function fmtPrem(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) {
    const m = Math.round((n / 1_000_000) * 10) / 10;
    if (m >= 1000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    return `$${m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = Math.round(n / 1_000);
    if (k >= 1000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${k}K`;
  }
  return `$${Math.round(n)}`;
}

function fmtStrike(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function biasStatus(
  bias: "long" | "short" | "mixed" | null | undefined,
  direction: "long" | "short"
): DeskEvidenceStatus {
  if (!bias) return "unavailable";
  if (bias === "mixed") return "neutral";
  return bias === direction ? "aligned" : "opposed";
}

function railAligned(score: number | undefined, floor = 60): DeskEvidenceStatus {
  if (score == null) return "unavailable";
  if (score >= floor) return "aligned";
  if (score >= floor - 15) return "neutral";
  return "opposed";
}

function pickVectorSummary(thesis: MergedThesis): { summary: string | null; score: number } {
  const rails: ThesisRail[] = ["BREAKOUT", "REVERSAL", "MOMENTUM"];
  let best: { summary: string | null; score: number } = { summary: null, score: 0 };
  for (const rail of rails) {
    const score = thesis.rail_scores[rail] ?? 0;
    if (score > best.score) {
      best = { summary: thesis.summaries[rail] ?? null, score };
    }
  }
  return best;
}

function formatHelixLine(
  thesis: MergedThesis,
  extras?: LegacyBridgeExtras
): DeskEvidenceLine {
  const prem = extras?.helix_gross_premium ?? null;
  const prints = extras?.helix_print_count ?? null;
  const bias = extras?.helix_direction_bias ?? null;
  const flowScore = thesis.rail_scores.FLOW;
  const flowSummary = thesis.summaries.FLOW;
  const breakoutSummary = thesis.summaries.BREAKOUT;

  if ((prem == null || prem < 50_000) && !flowScore && !flowSummary) {
    if (breakoutSummary) {
      return {
        desk: "HELIX",
        status: railAligned(thesis.rail_scores.BREAKOUT),
        text: `structure-led · ${breakoutSummary}`,
      };
    }
    return { desk: "HELIX", status: "unavailable", text: "no flow read in window" };
  }

  const parts: string[] = [];
  if (prem != null && prem >= 200_000) {
    parts.push(`${fmtPrem(prem)} tape`);
    if (prints != null && prints >= 2) parts.push(`${prints} prints`);
  }
  if (bias === "long") parts.push("call-side bias");
  else if (bias === "short") parts.push("put-side bias");
  else if (bias === "mixed") parts.push("mixed premium");

  let text = parts.length ? parts.join(" · ") : (flowSummary ?? "flow lane active");
  if (flowSummary && parts.length && !text.includes(flowSummary.slice(0, 12))) {
    text = `${parts.join(" · ")} · ${flowSummary}`;
  }

  const status =
    bias != null
      ? biasStatus(bias, thesis.direction)
      : railAligned(flowScore);

  return { desk: "HELIX", status, text };
}

function formatThermalLine(
  thesis: MergedThesis,
  extras?: LegacyBridgeExtras
): DeskEvidenceLine {
  const gamma = extras?.gamma_posture ?? null;
  const callWall = extras?.call_wall ?? null;
  const putWall = extras?.put_wall ?? null;
  const posSummary = thesis.summaries.POSITIONING;
  const posScore = thesis.rail_scores.POSITIONING;

  if (!gamma && callWall == null && putWall == null && !posSummary && !posScore) {
    return { desk: "THERMAL", status: "unavailable", text: "no GEX snapshot" };
  }

  const parts: string[] = [];
  if (gamma) parts.push(`${gamma}-gamma`);
  if (thesis.direction === "long" && callWall != null) {
    parts.push(`above ${fmtStrike(callWall)} call wall`);
  } else if (thesis.direction === "short" && putWall != null) {
    parts.push(`below ${fmtStrike(putWall)} put wall`);
  } else if (callWall != null && putWall != null) {
    parts.push(`walls ${fmtStrike(putWall)}–${fmtStrike(callWall)}`);
  }
  if (posSummary && !parts.some((p) => posSummary.includes(p.slice(0, 8)))) {
    parts.push(posSummary);
  }

  const text = parts.length ? parts.join(" · ") : (posSummary ?? "dealer positioning");
  let status = railAligned(posScore);
  if (gamma === "long" && thesis.direction === "long") status = "aligned";
  else if (gamma === "short" && thesis.direction === "short") status = "aligned";
  else if (gamma === "short" && thesis.direction === "long") status = "neutral";

  return { desk: "THERMAL", status, text };
}

function formatVectorLine(
  thesis: MergedThesis,
  extras?: LegacyBridgeExtras
): DeskEvidenceLine {
  const { summary, score } = pickVectorSummary(thesis);
  const dp = extras?.dark_pool_bias ?? null;
  const em = extras?.expected_move_pct ?? null;
  const bead = extras?.bead_wall_near_spot ?? null;
  const resistance = extras?.resistance ?? null;

  if (!summary && score < 52 && !dp && em == null && bead == null) {
    return { desk: "VECTOR", status: "unavailable", text: "no structure read" };
  }

  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (bead != null) parts.push(`bead ${fmtStrike(bead)}`);
  else if (resistance != null && thesis.direction === "long") {
    parts.push(`resistance ${fmtStrike(resistance)}`);
  }
  if (dp === "bullish" && thesis.direction === "long") parts.push("dark pool bid");
  else if (dp === "bearish" && thesis.direction === "short") parts.push("dark pool offer");
  else if (dp === "mixed") parts.push("dark pool mixed");
  if (em != null && Number.isFinite(em) && em > 0) parts.push(`EM ±${em.toFixed(1)}%`);

  const text = parts.length ? parts.join(" · ") : "structure lane active";
  let status = railAligned(score);
  if (dp === "bullish" && thesis.direction === "long") status = "aligned";
  else if (dp === "bearish" && thesis.direction === "short") status = "aligned";
  else if (dp === "bullish" && thesis.direction === "short") status = "opposed";
  else if (dp === "bearish" && thesis.direction === "long") status = "opposed";

  return { desk: "VECTOR", status, text };
}

function formatNightHawkLine(
  thesis: MergedThesis,
  rank_tier?: ThesisRankTier
): DeskEvidenceLine {
  const tier = rank_tier ?? "WATCH";
  const rails = thesis.rails_fired.slice(0, 4).join("+") || "scan";
  const archetype = ARCHETYPE_LABEL[thesis.trade_archetype];
  const text = `${tier} · ${archetype} · ${rails}`;

  let status: DeskEvidenceStatus = "neutral";
  if (tier === "A+" || tier === "A") status = "aligned";
  else if (tier === "REJECT") status = "opposed";
  else if (thesis.systems_aligned >= 3) status = "aligned";

  return { desk: "NIGHTHAWK", status, text };
}

function formatMeridianLine(thesis: MergedThesis): DeskEvidenceLine {
  const score = thesis.rail_scores.CATALYST;
  const summary = thesis.summaries.CATALYST;

  if (!score && !summary) {
    return { desk: "MERIDIAN", status: "unavailable", text: "no catalyst in window" };
  }

  return {
    desk: "MERIDIAN",
    status: railAligned(score, 55),
    text: summary ?? "catalyst lane",
  };
}

/** Product-native evidence rows for Command Deck (cache-backed inputs + merged thesis). */
export function buildDeskEvidenceLines(input: BuildDeskEvidenceInput): DeskEvidenceLine[] {
  const { thesis, rank_tier, extras } = input;
  const lines: DeskEvidenceLine[] = [
    formatHelixLine(thesis, extras),
    formatThermalLine(thesis, extras),
    formatVectorLine(thesis, extras),
    formatNightHawkLine(thesis, rank_tier),
    formatMeridianLine(thesis),
  ];
  return lines.sort(
    (a, b) => DESK_ORDER.indexOf(a.desk) - DESK_ORDER.indexOf(b.desk)
  );
}

export function countDeskAlignment(lines: DeskEvidenceLine[]): {
  aligned: number;
  available: number;
} {
  let aligned = 0;
  let available = 0;
  for (const line of lines) {
    if (line.status === "unavailable") continue;
    available += 1;
    if (line.status === "aligned") aligned += 1;
  }
  return { aligned, available };
}

export function deskEvidenceFromPipeline(
  pipeline: ThesisPipelineResult,
  extras?: LegacyBridgeExtras
): DeskEvidenceLine[] {
  return buildDeskEvidenceLines({
    thesis: pipeline.thesis,
    rank_tier: pipeline.rank_tier,
    extras,
  });
}
