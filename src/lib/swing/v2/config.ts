/**
 * Swing Engine V2 feature flags and env knobs.
 *
 * Shadow mode: SWING_ENGINE_V2=1 enables dynamic recall + rejection ledger without
 * changing commit authorization until P3 gates graduate.
 */

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSEY = new Set(["0", "false", "off", "no"]);

function norm(v: string | undefined): string | null {
  const t = v?.trim().toLowerCase();
  return t ? t : null;
}

/** Master flag — dynamic tier-1 cap, rejection ledger, lowered corroborated flow floor. */
export function isSwingEngineV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  const kill = norm(env.SWING_ENGINE_V2_DISABLED);
  if (kill != null && TRUTHY.has(kill)) return false;
  const on = norm(env.SWING_ENGINE_V2);
  return on != null && TRUTHY.has(on);
}

export function swingTier1CapFloor(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_TIER1_CAP_MIN ?? env.SWING_TIER1_CAP_FLOOR ?? 80);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 80;
}

export function swingTier1CapCeiling(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_TIER1_CAP_MAX ?? env.SWING_TIER1_CAP_CEILING ?? 200);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

export function swingTier1CapPoolPct(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_TIER1_CAP_POOL_PCT ?? 0.35);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.35;
}

/** FLOW premium floor when corroborated (FLOW+STRUCTURE). Default $150k vs legacy $250k. */
export function swingCorroboratedFlowMinPremium(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_CORROBORATED_FLOW_MIN_PREMIUM ?? 150_000);
  return Number.isFinite(n) && n > 0 ? n : 150_000;
}

export function swingLegacyFlowMinPremium(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_FLOW_MIN_PREMIUM ?? 250_000);
  return Number.isFinite(n) && n > 0 ? n : 250_000;
}
