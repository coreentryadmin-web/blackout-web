/**
 * Swing play brief — "what changed" diff engine.
 * Pure, deterministic: compares successive brief snapshots on refresh.
 */
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { thesisHealthUncalibrated } from "./thesis-health";

export type BriefSnapshot = {
  headline: string;
  recommendation: string | null;
  thesisHealth: number | null;
  pnlPct: number | null;
  mark: number | null;
  spot: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  flowCallPremium: number | null;
  flowPutPremium: number | null;
  trimsFired: number | null;
  sectionTitles: string[];
};

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function fmtDelta(prev: number, next: number, suffix = ""): string {
  const d = next - prev;
  const sign = d > 0 ? "+" : "";
  return `${prev}${suffix} → ${next}${suffix} (${sign}${d.toFixed(1)}${suffix})`;
}

function narrateThesisShift(prev: number, next: number): string {
  const d = next - prev;
  const verb = d < 0 ? "fading" : "improving";
  return `**Thesis ${verb}** — health moved **${d >= 0 ? "+" : ""}${d.toFixed(0)} pts** to **${next}%**`;
}

function narratePnlShift(prev: number, next: number): string {
  const d = next - prev;
  const tone = d >= 0 ? "building" : "slipping";
  return `**P&L ${tone}** — **${fmtDelta(prev, next, "%")}** since last refresh`;
}

function narrateSpotShift(prev: number, next: number): string {
  const d = next - prev;
  const dir = d > 0 ? "higher" : "lower";
  return `**Spot drifted ${dir}** — **$${next.toFixed(2)}** (${d >= 0 ? "+" : ""}${d.toFixed(2)} vs prior read)`;
}

/**
 * Derive the diff engine's raw inputs from a play-brief API response.
 *
 * spot/gammaFlip/callWall/putWall come from `envelope.levels` by label — those are
 * `BieLevel` price levels the envelope already carries for chart annotation, so re-deriving
 * them here (rather than duplicating the field) keeps one source of truth. HELIX flow premiums
 * are NOT price levels (a `BieLevel.price` means "a level on the chart"; a premium total is a
 * dollar sum), so they ride the response's own explicit `flowSnapshot` field instead of being
 * shoehorned into `levels` or string-matched out of rendered text.
 */
export function extrasFromBriefResponse(response: {
  envelope?: BieAnswerEnvelope;
  flowSnapshot?: { callPremium: number | null; putPremium: number | null } | null;
  trimsFired?: number | null;
}) {
  const levels = response.envelope?.levels ?? [];
  const price = (substr: string) =>
    levels.find((l) => l.label.toLowerCase().includes(substr))?.price ?? null;
  return {
    spot: price("spot"),
    gammaFlip: price("gamma flip"),
    callWall: price("call wall"),
    putWall: price("put wall"),
    flowCallPremium: response.flowSnapshot?.callPremium ?? null,
    flowPutPremium: response.flowSnapshot?.putPremium ?? null,
    trimsFired: response.trimsFired ?? null,
  };
}

/** Build a comparable snapshot from API response + live play overlay. */
export function snapshotFromBrief(
  envelope: BieAnswerEnvelope,
  play: TerminalPlay | null,
  extras?: {
    spot?: number | null;
    gammaFlip?: number | null;
    callWall?: number | null;
    putWall?: number | null;
    flowCallPremium?: number | null;
    flowPutPremium?: number | null;
    trimsFired?: number | null;
  },
): BriefSnapshot {
  return {
    headline: envelope.headline,
    recommendation: play?.recommendation ?? null,
    thesisHealth:
      play?.thesisHealth && !thesisHealthUncalibrated(play.thesisHealth)
        ? fin(play.thesisHealth.health)
        : null,
    pnlPct: fin(play?.pnlPct),
    mark: fin(play?.mark),
    spot: fin(extras?.spot),
    gammaFlip: fin(extras?.gammaFlip),
    callWall: fin(extras?.callWall),
    putWall: fin(extras?.putWall),
    flowCallPremium: fin(extras?.flowCallPremium),
    flowPutPremium: fin(extras?.flowPutPremium),
    trimsFired: fin(extras?.trimsFired),
    sectionTitles: envelope.sections.map((s) => s.title),
  };
}

/** Return human-readable change lines; empty when first load or no material delta. */
export function diffBriefSnapshots(prev: BriefSnapshot | null, next: BriefSnapshot): string[] {
  if (!prev) return [];
  const lines: string[] = [];

  if (prev.recommendation && next.recommendation && prev.recommendation !== next.recommendation) {
    lines.push(`**Desk action shifted** — **${prev.recommendation}** → **${next.recommendation}**`);
  }
  if (
    prev.thesisHealth != null &&
    next.thesisHealth != null &&
    prev.thesisHealth !== next.thesisHealth &&
    Math.abs(prev.thesisHealth - next.thesisHealth) >= 3
  ) {
    lines.push(narrateThesisShift(prev.thesisHealth, next.thesisHealth));
  }
  if (prev.pnlPct != null && next.pnlPct != null && Math.abs(prev.pnlPct - next.pnlPct) >= 0.5) {
    lines.push(narratePnlShift(prev.pnlPct, next.pnlPct));
  }
  if (prev.mark != null && next.mark != null && Math.abs(prev.mark - next.mark) >= 0.05) {
    lines.push(`Option mark $${prev.mark.toFixed(2)} → $${next.mark.toFixed(2)}`);
  }
  if (prev.spot != null && next.spot != null && Math.abs(prev.spot - next.spot) >= 0.01) {
    lines.push(narrateSpotShift(prev.spot, next.spot));
  }
  if (prev.gammaFlip != null && next.gammaFlip != null && Math.abs(prev.gammaFlip - next.gammaFlip) >= 0.05) {
    lines.push(`Gamma flip moved ${fmtDelta(prev.gammaFlip, next.gammaFlip)}`);
  }
  if (prev.callWall != null && next.callWall != null && Math.abs(prev.callWall - next.callWall) >= 0.05) {
    lines.push(`Call wall ${fmtDelta(prev.callWall, next.callWall)}`);
  }
  if (prev.putWall != null && next.putWall != null && Math.abs(prev.putWall - next.putWall) >= 0.05) {
    lines.push(`Put wall ${fmtDelta(prev.putWall, next.putWall)}`);
  }
  const callMoved =
    prev.flowCallPremium != null &&
    next.flowCallPremium != null &&
    Math.abs(next.flowCallPremium - prev.flowCallPremium) > 50_000;
  const putMoved =
    prev.flowPutPremium != null &&
    next.flowPutPremium != null &&
    Math.abs(next.flowPutPremium - prev.flowPutPremium) > 50_000;
  if (callMoved && next.flowCallPremium! > prev.flowCallPremium! * 1.2) {
    lines.push("HELIX tape: call flow building");
  } else if (putMoved && next.flowPutPremium! > (prev.flowPutPremium ?? 0) * 1.2) {
    lines.push("HELIX tape: put flow building");
  } else if (callMoved || putMoved) {
    lines.push("HELIX tape: flow shifted");
  }
  if (
    prev.trimsFired != null &&
    next.trimsFired != null &&
    next.trimsFired > prev.trimsFired
  ) {
    lines.push(`Trim rail **banked** (${prev.trimsFired} → ${next.trimsFired} fired)`);
  }
  if (prev.headline !== next.headline) {
    lines.push(`Verdict headline updated`);
  }

  const newSections = next.sectionTitles.filter((t) => !prev.sectionTitles.includes(t));
  if (newSections.length) {
    lines.push(`New sections: ${newSections.join(", ")}`);
  }

  return lines.slice(0, 8);
}

/** Stable content key for SSE dedupe — excludes time-only fields. */
export function briefContentKey(snap: BriefSnapshot): string {
  return JSON.stringify({
    headline: snap.headline,
    recommendation: snap.recommendation,
    thesisHealth: snap.thesisHealth,
    pnlPct: snap.pnlPct,
    mark: snap.mark,
    spot: snap.spot,
    gammaFlip: snap.gammaFlip,
    callWall: snap.callWall,
    putWall: snap.putWall,
    trimsFired: snap.trimsFired,
    sectionTitles: snap.sectionTitles,
  });
}

/** Inject live refresh pulse into Trade manager read; overflow goes to What changed. */
export function envelopeWithNarrativePulse(
  envelope: BieAnswerEnvelope,
  changes: string[],
): BieAnswerEnvelope {
  if (!changes.length) return envelope;

  const narrativeIdx = envelope.sections.findIndex((s) => s.title === "Trade manager read");
  if (narrativeIdx < 0) return envelopeWithDiffSection(envelope, changes);

  const pulseLines = changes.slice(0, 3).map((c) => `• **Since last read** — ${c}`);
  const overflow = changes.slice(3);

  const sections = [...envelope.sections];
  const narrative = sections[narrativeIdx]!;
  const alreadyHasPulse = narrative.body.includes("Since last read");
  sections[narrativeIdx] = {
    ...narrative,
    body: alreadyHasPulse
      ? narrative.body
      : `${pulseLines.join("\n")}\n${narrative.body}`,
  };

  const base = { ...envelope, sections };
  return overflow.length ? envelopeWithDiffSection(base, overflow) : base;
}

/** Inject a "What changed" section at the top of an envelope when deltas exist. */
export function envelopeWithDiffSection(
  envelope: BieAnswerEnvelope,
  changes: string[],
): BieAnswerEnvelope {
  if (!changes.length) return envelope;
  if (envelope.sections.some((s) => s.title === "What changed")) return envelope;
  return {
    ...envelope,
    sections: [
      {
        title: "What changed",
        body: changes.map((c) => `• ${c}`).join("\n"),
        bias: "neutral",
      },
      ...envelope.sections,
    ],
  };
}
