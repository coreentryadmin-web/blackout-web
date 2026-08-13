/**
 * Member-specific context for Largo turns — tier, recent thread questions (no full re-prefetch).
 */

import type { AnthropicMessage } from "@/lib/providers/anthropic";

export function formatMemberContextBlock(input: {
  tier?: string | null;
  isAdmin?: boolean;
  recentQuestions?: string[];
  watchlist?: string[];
}): string {
  const lines: string[] = ["\n\n## Member context"];
  if (input.tier) lines.push(`Tier: ${input.tier}${input.isAdmin ? " (admin)" : ""}`);
  if (input.watchlist?.length) {
    lines.push(`Watchlist: ${input.watchlist.join(", ")}`);
  }
  const qs = (input.recentQuestions ?? []).filter(Boolean).slice(-3);
  if (qs.length) {
    lines.push("Recent questions in this thread:");
    qs.forEach((q, i) => lines.push(`${i + 1}. ${q.slice(0, 200)}`));
  }
  if (lines.length <= 1) return "";
  return lines.join("\n") + "\n";
}

export function recentUserQuestions(history: AnthropicMessage[], limit = 3): string[] {
  return history
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .slice(-limit);
}

export function formatRegimePersonalityBlock(marketPhase: string): string {
  const open = marketPhase === "OPEN" || marketPhase === "PRE-MARKET";
  if (open) {
    return `\n\n## Session voice\nRTH desk voice: full synthesis, levels, and play context when grounded. State invalidation.\n`;
  }
  return `\n\n## Session voice\nOff-hours: shorter answers, no new play recommendations. Summarize structure and what to watch at the open.\n`;
}

export function formatCalibrationBlock(): string {
  return `\n\n## Win-rate calibration\nWhen citing win rates or setup statistics, call get_setup_stats with an explicit grade filter. Do NOT blend platform-wide stats unless the member explicitly asks for blended performance.\n`;
}
