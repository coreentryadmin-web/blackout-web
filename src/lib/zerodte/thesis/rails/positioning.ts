import type { PositioningArchetype, RailHit } from "../types";

export type PositioningRailInput = {
  ticker: string;
  direction: "long" | "short";
  gamma_posture?: "long" | "short" | null;
  call_wall?: number | null;
  put_wall?: number | null;
  spot?: number | null;
  /** Legacy PIN score 0–100. */
  pin_score?: number | null;
};

export function detectPositioningArchetype(input: PositioningRailInput): PositioningArchetype | null {
  const { spot, call_wall, put_wall, gamma_posture } = input;
  if (spot == null || !Number.isFinite(spot)) return null;

  if (call_wall != null && spot >= call_wall * 0.995) return "WALL_BREAK";
  if (put_wall != null && spot <= put_wall * 1.005) return "WALL_BREAK";

  if (gamma_posture === "long" && call_wall != null && put_wall != null && spot > put_wall && spot < call_wall) {
    return "PIN";
  }

  if (call_wall != null && put_wall != null) {
    const gapUp = call_wall - spot;
    const gapDown = spot - put_wall;
    const pctUp = spot > 0 ? (gapUp / spot) * 100 : 0;
    if (pctUp >= 1 && pctUp <= 4 && input.direction === "long") return "VACUUM";
    if (gapDown >= 0 && gapDown / spot < 0.01 && input.direction === "long") return "WALL_REJECTION";
  }

  if (gamma_posture === "short") return "GAMMA_FLIP";

  return null;
}

export function scorePositioningRail(input: PositioningRailInput): RailHit | null {
  const archetype = detectPositioningArchetype(input);
  let score = input.pin_score ?? 50;
  if (archetype === "VACUUM") score = Math.max(score, 74);
  if (archetype === "PIN") score = Math.max(score, 70);
  if (archetype === "WALL_BREAK") score = Math.max(score, 76);
  if (archetype === "WALL_REJECTION") score = Math.max(score, 68);

  if (input.gamma_posture === "short" && input.direction === "long") score += 4;

  score = Math.min(100, Math.round(score));
  if (score < 52 && !archetype) return null;

  return {
    rail: "POSITIONING",
    ticker: input.ticker.toUpperCase(),
    direction: input.direction,
    score,
    positioning_archetype: archetype,
    summary: archetype ? `${archetype} · γ ${input.gamma_posture ?? "?"}` : "dealer positioning",
  };
}
