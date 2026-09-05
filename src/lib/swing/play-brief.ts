/**
 * Swing Play Intelligence Engine — deterministic, real-time play brief composer.
 * No Anthropic calls. Every claim traces to platform data with null-honesty.
 */
import type { BieAnswerEnvelope, BieBias, BieEvidence, BieLevel } from "@/lib/bie/answer-envelope";
import { buildRichEnvelope, type RichSection } from "@/lib/bie/rich-narrative";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { playContractHeadline } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import { playGradeLabel, playQualityPct } from "@/features/nighthawk/command-deck/play-card-display";
import { swingActionDisplay } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import { thesisStrengthPct } from "@/features/nighthawk/command-deck/terminal-display";
import type { SwingPlayBriefContext, SwingPlayBriefResult } from "./play-brief-types";

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function biasFromDirection(dir: string): BieBias {
  return dir === "SHORT" ? "bearish" : dir === "LONG" ? "bullish" : "neutral";
}

function statusBucket(play: TerminalPlay): "watch" | "open" | "closed" {
  if (play.status === "CLOSED") return "closed";
  if (play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM") return "open";
  return "watch";
}

function pillarLines(play: TerminalPlay): string {
  if (!play.factors.length) return "No pillar breakdown on this row.";
  return play.factors
    .slice(0, 7)
    .map((f) => `• **${f.label}** — ${f.points >= 0 ? "+" : ""}${f.points}`)
    .join("\n");
}

function thesisHealthSection(play: TerminalPlay): RichSection | null {
  const h = play.thesisHealth;
  if (!h) return null;
  const rows = h.pillars
    .map((p) => {
      const deltaStr = p.deltaPts != null ? ` (Δ ${p.deltaPts >= 0 ? "+" : ""}${p.deltaPts.toFixed(1)} pts)` : "";
      return `• **${p.label}** — ${p.currentLabel ?? "unknown"}${deltaStr}`;
    })
    .join("\n");
  return {
    title: "Thesis health",
    body: `**${h.health}%** · ${h.rungLabel}\n\n${rows || "Pillars not wired on this row."}`,
    bias: h.health >= 65 ? "bullish" : h.health < 45 ? "bearish" : "neutral",
  };
}

function managementSection(play: TerminalPlay): RichSection {
  const action = swingActionDisplay(play);
  const lines: string[] = [];
  lines.push(`**Recommended:** ${play.recommendation ?? action?.label ?? "HOLD"}`);
  if (play.recNote) lines.push(play.recNote);
  if (play.manageAction) {
    lines.push(`Manage engine: **${play.manageAction}**`);
  }
  if (play.exitPolicy) {
    const ep = play.exitPolicy;
    const trims = ep.trim_levels
      .map((t) => `+${t.trigger_pct}%${t.fired ? " ✓" : ""}`)
      .join(" · ");
    if (trims) lines.push(`Trim ladder: ${trims}`);
    if (ep.stop_premium != null || ep.target_premium != null) {
      lines.push(`Rails: stop ${fmtUsd(ep.stop_premium)} · target ${fmtUsd(ep.target_premium)}`);
    }
  }
  if (play.progress != null && Number.isFinite(play.progress)) {
    lines.push(`Trim progress: **${Math.round(play.progress * 100)}%**`);
  }
  return { title: "Management", body: lines.join("\n\n") };
}

function pnlSection(play: TerminalPlay): RichSection {
  const lines = [
    `Entry: **${fmtUsd(play.entry)}**`,
    `Mark: **${fmtUsd(play.mark)}**${play.markAsOf ? ` (${play.markAsOf})` : ""}`,
    `P&L: **${fmtPct(play.pnlPct)}**`,
    `Peak: **${fmtPct(play.peak)}**`,
  ];
  if (play.execPnlPct != null) lines.push(`Exec P&L: **${fmtPct(play.execPnlPct)}**`);
  if (play.trackPct != null) lines.push(`Since flag: **${fmtPct(play.trackPct)}**`);
  return { title: "Position", body: lines.join("\n") };
}

function watchEntrySection(play: TerminalPlay): RichSection {
  const lines: string[] = [];
  const label = play.swingEntryAction ? play.swingEntryAction.toUpperCase() : play.recommendation ?? "WAIT";
  lines.push(`**Entry stance:** ${label}`);
  if (play.servingSection) lines.push(`Serving section: **${play.servingSection.replace(/_/g, " ")}**`);
  if (play.setupState) lines.push(`Setup: **${play.setupState}**`);
  if (play.entryStatus) lines.push(`Entry geometry: **${play.entryStatus}**`);
  if (play.gateBlocks?.length) {
    lines.push(
      "**Gates blocking entry:**\n" +
        play.gateBlocks.map((g) => `• ${g.code}: ${g.reason}`).join("\n"),
    );
  } else if (play.recommendation === "BUY") {
    lines.push("No mechanical gates blocking entry on this read.");
  }
  return { title: "Entry", body: lines.join("\n\n") };
}

function crossMarketSection(ctx: SwingPlayBriefContext): RichSection | null {
  const { ecosystem: eco, vector, play } = ctx;
  const lines: string[] = [];
  const vec = vector ?? eco?.vector_full_state ?? null;
  if (vec?.regime?.posture) lines.push(`Vector regime: **${vec.regime.posture}**`);
  if (vec?.spot != null) lines.push(`Spot: **${vec.spot.toFixed(2)}**`);
  if (eco?.recent_flow) {
    const f = eco.recent_flow;
    lines.push(
      `HELIX flow (${f.window_hours}h): calls **${fmtUsd(f.call_premium)}** · puts **${fmtUsd(f.put_premium)}** · ${f.print_count} prints`,
    );
  }
  const gex = eco?.gex_positioning;
  if (gex?.flip != null) {
    lines.push(`GEX gamma flip: **${gex.flip.toFixed(2)}**`);
  }
  if (vec?.play?.grade) {
    lines.push(`Vector play grade: **${vec.play.grade}**`);
  }
  if (eco?.zerodte_today) {
    lines.push(`0DTE desk: **${eco.zerodte_today.direction}** · ${eco.zerodte_today.conviction ?? "—"} conviction`);
  }
  if (!lines.length) return null;
  return { title: "Cross-market", body: lines.join("\n"), bias: biasFromDirection(play.direction) };
}

function closedSection(play: TerminalPlay): RichSection {
  const lines = [
    `Exit P&L: **${fmtPct(play.exitPnlPct)}**`,
    play.closedReason ? `Reason: **${play.closedReason}**` : null,
    play.mfeCapturePct != null ? `MFE capture: **${fmtPct(play.mfeCapturePct)}**` : null,
    play.exitAt ? `Closed: **${play.exitAt}**` : null,
  ].filter(Boolean);
  return { title: "Outcome", body: lines.join("\n") };
}

function levelsFromContext(ctx: SwingPlayBriefContext): BieLevel[] {
  const levels: BieLevel[] = [];
  const gex = ctx.ecosystem?.gex_positioning;
  if (gex?.call_wall != null) {
    levels.push({ label: "call wall", price: gex.call_wall, provenance: { source: "GEX", freshness: "recent" } });
  }
  if (gex?.put_wall != null) {
    levels.push({ label: "put wall", price: gex.put_wall, provenance: { source: "GEX", freshness: "recent" } });
  }
  if (gex?.flip != null) {
    levels.push({ label: "gamma flip", price: gex.flip, provenance: { source: "GEX", freshness: "recent" } });
  }
  const spot = ctx.vector?.spot ?? ctx.ecosystem?.vector_full_state?.spot;
  if (spot != null) {
    levels.push({ label: "spot", price: spot, provenance: { source: "Vector", freshness: "live" } });
  }
  return levels;
}

function evidenceFromContext(ctx: SwingPlayBriefContext): BieEvidence[] {
  const out: BieEvidence[] = [];
  if (ctx.scanAsOf) {
    out.push({
      kind: "fact",
      text: `Swing discovery scan as of ${ctx.scanAsOf}.`,
      provenance: { source: "Swing lane", asOf: ctx.scanAsOf, freshness: "recent" },
    });
  }
  if (ctx.play.markAsOf) {
    out.push({
      kind: "fact",
      text: `Option mark as of ${ctx.play.markAsOf}.`,
      provenance: { source: "Swing ledger", asOf: ctx.play.markAsOf, freshness: "recent" },
    });
  }
  return out;
}

function followupsFor(play: TerminalPlay): string[] {
  const t = play.ticker;
  return [
    `What changed on ${t} since entry?`,
    `Show ${t} GEX walls`,
    `HELIX flow on ${t}`,
    `Open full Largo for ${t}`,
  ];
}

/** Compose a full BieAnswerEnvelope for the selected swing play. */
export function composeSwingPlayBrief(ctx: SwingPlayBriefContext): SwingPlayBriefResult {
  const { play } = ctx;
  const bucket = statusBucket(play);
  const headline = playContractHeadline(play);
  const grade = playGradeLabel(play);
  const quality = playQualityPct(play);
  const strength = thesisStrengthPct(play);

  const verdictLines: string[] = [];
  const action = swingActionDisplay(play);
  verdictLines.push(`**${headline}** · ${play.direction} · ${action?.label ?? play.status}`);
  if (grade) verdictLines.push(`Grade **${grade}**${quality != null ? ` · score ${quality}` : ""}`);
  if (strength != null) verdictLines.push(`Thesis strength **${strength}%**`);
  if (play.regime) verdictLines.push(play.regime);
  if (play.archetype) verdictLines.push(`Archetype: ${play.archetype}`);
  if (play.recNote && bucket !== "open") verdictLines.push(play.recNote);

  const sections: RichSection[] = [{ title: "Verdict", body: verdictLines.join("\n\n") }];

  if (bucket === "watch") {
    sections.push(watchEntrySection(play));
    sections.push({ title: "Score pillars", body: pillarLines(play) });
    const cross = crossMarketSection(ctx);
    if (cross) sections.push(cross);
    if (play.thesisBreak?.note || play.thesisBreak?.level) {
      sections.push({
        title: "Invalidation",
        body: `Thesis **${play.thesisBreak.level ?? "unknown"}**${play.thesisBreak.note ? ` — ${play.thesisBreak.note}` : ""}`,
        bias: play.thesisBreak.level === "break" ? "bearish" : "neutral",
      });
    }
  } else if (bucket === "open") {
    sections.push(managementSection(play));
    const th = thesisHealthSection(play);
    if (th) sections.push(th);
    sections.push(pnlSection(play));
    const cross = crossMarketSection(ctx);
    if (cross) sections.push(cross);
    sections.push({ title: "Score pillars", body: pillarLines(play) });
  } else {
    sections.push(closedSection(play));
    sections.push({ title: "Score pillars", body: pillarLines(play) });
    const cross = crossMarketSection(ctx);
    if (cross) sections.push(cross);
  }

  const invalidation =
    play.thesisBreak?.level === "break"
      ? play.thesisBreak.note ?? "Thesis break — structural invalidation fired."
      : play.gateBlocks?.[0]?.reason ?? null;

  const envelope: BieAnswerEnvelope = buildRichEnvelope({
    headline: `${action?.label ?? play.recommendation ?? play.status} — ${headline}`,
    bias: biasFromDirection(play.direction),
    intent: "swing_play_brief",
    sections,
    evidence: evidenceFromContext(ctx),
    levels: levelsFromContext(ctx),
    invalidation,
    followups: followupsFor(play),
    confidence: {
      level: ctx.play.thesisHealth?.health != null || ctx.play.factors.length > 0 ? "high" : "moderate",
      why: "Deterministic synthesis from swing lane, ledger, Vector, HELIX, and GEX cache readers — no LLM.",
    },
  });

  return {
    playId: play.id,
    ticker: play.ticker,
    envelope,
    asOf: ctx.asOf,
    engine: "swing_play_intelligence",
  };
}
