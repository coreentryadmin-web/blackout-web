/**
 * Competitor-style contextual follow-ups — strike/ticker-specific chips derived from
 * the structured answer (envelope levels, compare card), not generic templates.
 */

import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { LargoCompareCard } from "@/lib/largo/compare-card-types";

function fmtStrike(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function levelPrice(level: { price?: unknown }): number | null {
  const p = level.price;
  if (typeof p === "number" && Number.isFinite(p)) return p;
  if (typeof p === "string") {
    const n = Number(p.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Build 2–3 hyper-specific next questions from THIS answer's levels and cards. */
export function contextualFollowupsFromAnswer(input: {
  envelope?: BieAnswerEnvelope | null;
  compareCard?: LargoCompareCard | null;
  ticker?: string | null;
}): string[] {
  const chips: string[] = [];
  const t = (input.ticker ?? "SPX").toUpperCase();
  const seen = new Set<string>();

  const push = (q: string) => {
    const c = q.trim();
    if (!c || seen.has(c.toLowerCase())) return;
    seen.add(c.toLowerCase());
    chips.push(c);
  };

  for (const level of input.envelope?.levels ?? []) {
    const label = String(level.label ?? "");
    const strike = levelPrice(level);
    if (strike == null) continue;
    const s = fmtStrike(strike);

    if (/call wall/i.test(label)) {
      push(`What's the flow at the ${s} call wall?`);
    } else if (/put wall/i.test(label)) {
      push(`Who's defending the ${s} put wall?`);
    } else if (/flip|gamma flip|zero.?vanna/i.test(label)) {
      push(`What happens if ${t} breaks ${s} flip?`);
    } else if (/magnet|king/i.test(label)) {
      push(`Where is the king node near ${s}?`);
    } else if (/spot/i.test(label)) {
      push(`Who's buying/selling at ${t} ${s}?`);
    } else if (/vwap/i.test(label)) {
      push(`Does ${t} hold above VWAP at ${s}?`);
    } else if (/max pain/i.test(label)) {
      push(`Is price pinning toward max pain at ${s}?`);
    }
    if (chips.length >= 4) break;
  }

  const card = input.compareCard;
  if (card?.kind === "helix_thermal") {
    const ct = card.ticker ?? t;
    if (card.conflict) {
      push(`Is tape shifting toward flow or gamma on ${ct}?`);
    } else {
      push(`Where are ${ct}'s gamma walls exactly?`);
    }
    if (card.helix?.summary) {
      push(`Who's buying the aggressive calls on ${ct}?`);
    }
  }

  if (card?.kind === "peer_tickers" && card.rows.length >= 2) {
    const names = card.rows.slice(0, 3).map((r) => r.ticker);
    push(`Compare ${names.join(" vs ")} — flow and gamma side by side`);
  }

  if (input.envelope?.bias) {
    push(`What invalidates this ${input.envelope.bias} read?`);
  } else if (input.envelope?.tradeDecision?.actionLabel) {
    push(`What invalidates the ${input.envelope.tradeDecision.actionLabel} setup?`);
  }

  return chips.slice(0, 3);
}
