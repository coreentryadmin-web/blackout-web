/** Human-readable SPX 0DTE contract labels for desk Open/Watch/Closed chips. */

import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { OptionTicket } from "@/features/spx/lib/spx-play-options";

export type ParsedSpxContract = { strike: number; side: "call" | "put" };

const STRIKE_MIN = 1000;
const STRIKE_MAX = 99_999;

function validStrike(n: number): boolean {
  return Number.isFinite(n) && n >= STRIKE_MIN && n <= STRIKE_MAX;
}

/**
 * Parse compact or OCC-style SPXW labels without confusing the expiry date for strike.
 * Examples: `7550C`, `SPXW 260710 C6071`, `SPXW 260710C6071`, `7450 Put`
 */
export function parseSpxContractLabel(raw: string): ParsedSpxContract | null {
  const s = raw.trim();
  if (!s) return null;

  const occTail = s.match(/([CP])\s*(\d{4,5})\s*$/i);
  if (occTail) {
    const strike = Number(occTail[2]);
    if (validStrike(strike)) {
      return { strike, side: occTail[1]!.toUpperCase() === "C" ? "call" : "put" };
    }
  }

  const compact = s.match(/(\d{4,5})\s*([CP])\b/i);
  if (compact) {
    const strike = Number(compact[1]);
    if (validStrike(strike)) {
      return { strike, side: compact[2]!.toUpperCase() === "C" ? "call" : "put" };
    }
  }

  const words = s.match(/(\d{4,5})\s*(Call|Put)\b/i);
  if (words) {
    const strike = Number(words[1]);
    if (validStrike(strike)) {
      return { strike, side: words[2]!.toLowerCase() === "call" ? "call" : "put" };
    }
  }

  return null;
}

export function formatSpxContractLabel(
  raw: string | null | undefined,
  fallback?: { strike: number; direction?: string | null }
): string {
  if (raw) {
    const parsed = parseSpxContractLabel(raw);
    if (parsed) {
      return `${parsed.strike} ${parsed.side === "call" ? "Call" : "Put"}`;
    }
  }

  if (fallback && validStrike(Math.round(fallback.strike))) {
    const strike = Math.round(fallback.strike);
    const side = fallback.direction === "short" ? "Put" : "Call";
    return `${strike} ${side}`;
  }

  return raw?.trim() || "—";
}

/** Desk chip copy — e.g. `7400C @ 5.2` */
export function formatPremiumAt(premium: string | null | undefined): string | null {
  if (!premium?.trim() || premium.trim() === "—") return null;
  const s = premium.trim().replace(/^~?\$/, "");
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return ((a + b) / 2).toFixed(1);
  }
  const single = s.match(/(\d+(?:\.\d+)?)/);
  if (single) return Number(single[1]).toFixed(1);
  return null;
}

export function formatSpxContractChipLabel(
  raw: string | null | undefined,
  fallback?: { strike: number; direction?: string | null },
  premium?: string | null
): string {
  const grounded = resolveGroundedSpxContractChip({
    rawLabel: raw,
    ticketStrike: fallback?.strike,
    ticketType:
      fallback?.direction === "short" ? "put" : fallback?.direction === "long" ? "call" : null,
    ticketBlocked: false,
    premium,
  });
  if (grounded) return grounded;
  return formatSpxContractLabel(raw, fallback);
}

/** Inputs for a chain-grounded contract chip — never pass SPX index entry as `ticketStrike`. */
export type GroundedContractChipInput = {
  rawLabel?: string | null;
  ticketStrike?: number | null;
  ticketType?: "call" | "put" | null;
  /** Blocked / index-plan tickets must not render as liquid strikes. */
  ticketBlocked?: boolean;
  premium?: string | null;
  /** When set, reject labels whose C/P side disagrees with the play direction. */
  playDirection?: "long" | "short" | null;
};

function sideMatchesPlayDirection(side: "call" | "put", direction?: "long" | "short" | null): boolean {
  if (!direction) return true;
  return direction === "long" ? side === "call" : side === "put";
}

/**
 * Return a compact desk chip (`7550C @ 5.0`) ONLY when the strike is grounded in a parsed
 * OCC/compact label or a live option ticket — never fabricate from the SPX index entry level.
 */
export function resolveGroundedSpxContractChip(input: GroundedContractChipInput): string | null {
  const prem = formatPremiumAt(input.premium);

  if (input.rawLabel?.trim()) {
    const parsed = parseSpxContractLabel(input.rawLabel);
    if (parsed && sideMatchesPlayDirection(parsed.side, input.playDirection ?? null)) {
      const compact = `${parsed.strike}${parsed.side === "call" ? "C" : "P"}`;
      return prem ? `${compact} @ ${prem}` : compact;
    }
  }

  if (
    !input.ticketBlocked &&
    input.ticketStrike != null &&
    input.ticketType &&
    validStrike(Math.round(input.ticketStrike)) &&
    sideMatchesPlayDirection(input.ticketType, input.playDirection ?? null)
  ) {
    const compact = `${Math.round(input.ticketStrike)}${input.ticketType === "call" ? "C" : "P"}`;
    return prem ? `${compact} @ ${prem}` : compact;
  }

  return null;
}

function chipInputFromTicket(
  ticket: OptionTicket | null | undefined,
  premium?: string | null,
  playDirection?: "long" | "short" | null
): GroundedContractChipInput {
  return {
    rawLabel: ticket?.contract_label,
    ticketStrike: ticket?.strike ?? null,
    ticketType: ticket?.option_type ?? null,
    ticketBlocked: ticket?.blocked === true,
    premium,
    playDirection,
  };
}

/** Resolve a grounded contract chip from the play payload (shared by verdict bar + kanban). */
export function resolveSpxPlayContractChip(play: SpxPlayPayload): string | null {
  const direction = (play.direction ?? play.open_play?.direction ?? null) as "long" | "short" | null;
  const premium =
    play.open_play?.option_premium ?? play.option_ticket?.premium_range ?? null;
  const raw = play.open_play?.option_label ?? play.option_ticket?.contract_label ?? null;

  const fromLabel = resolveGroundedSpxContractChip({
    rawLabel: raw,
    premium,
    playDirection: direction,
  });
  if (fromLabel) return fromLabel;

  return resolveGroundedSpxContractChip(chipInputFromTicket(play.option_ticket, premium, direction));
}

/** Human-readable contract label for trade alerts — index entry never substitutes for strike. */
export function resolveSpxPlayContractHumanLabel(play: SpxPlayPayload): string {
  const chip = resolveSpxPlayContractChip(play);
  if (chip) {
    const parsed = parseSpxContractLabel(chip.split("@")[0]?.trim() ?? chip);
    if (parsed) {
      return `${parsed.strike} ${parsed.side === "call" ? "Call" : "Put"}`;
    }
  }
  return "—";
}

/** Pin drift vs structure play direction — independent systems; surface when they diverge. */
export function pinPlayAlignmentHint(
  playDirection: "long" | "short" | null,
  pinDriftPts: number | null | undefined
): string | null {
  if (!playDirection || pinDriftPts == null || !Number.isFinite(pinDriftPts)) return null;
  if (Math.abs(pinDriftPts) <= 0.5) return null;
  const pinImplies = pinDriftPts > 0 ? "long" : "short";
  if (pinImplies === playDirection) return null;
  const pinSide = pinDriftPts > 0 ? "upward pin drift" : "downward pin drift";
  const playSide = playDirection === "long" ? "bullish structure" : "bearish structure";
  return `Pin forecaster shows ${pinSide}; play engine is ${playSide} — thesis is independent of the magnet.`;
}
