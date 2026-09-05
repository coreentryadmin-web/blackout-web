/**
 * Swing Engine V2 feature flags and env knobs.
 *
 * LIVE by default — member-facing cron runs dynamic recall, multi-origin Tier-0,
 * and commit gates unless explicitly opted out (`SWING_ENGINE_V2_DISABLED=1`).
 */

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSEY = new Set(["0", "false", "off", "no"]);

function norm(v: string | undefined): string | null {
  const t = v?.trim().toLowerCase();
  return t ? t : null;
}

function envTriState(
  env: Record<string, string | undefined>,
  key: string,
  defaultWhenEnabled: boolean,
): boolean {
  const v = norm(env[key]);
  if (v == null) return defaultWhenEnabled;
  if (FALSEY.has(v)) return false;
  if (TRUTHY.has(v)) return true;
  return defaultWhenEnabled;
}

/** Master flag — dynamic tier-1 cap, rejection ledger, multi-origin merge, commit gates. ON unless disabled. */
export function isSwingEngineV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  if (envTriState(env, "SWING_ENGINE_V2_DISABLED", false)) return false;
  return envTriState(env, "SWING_ENGINE_V2", true);
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

/** P3 — G-S6 confluence at COMMIT. LIVE when V2 is on; opt out with SWING_ENGINE_V2_ENFORCE_CONFLUENCE=0. */
export function isSwingConfluenceEnforced(env: Record<string, string | undefined> = process.env): boolean {
  if (!isSwingEngineV2Enabled(env)) return false;
  return envTriState(env, "SWING_ENGINE_V2_ENFORCE_CONFLUENCE", true);
}

/** P3 — G-S14 Cortex veto at COMMIT. LIVE when V2 is on; opt out with SWING_ENGINE_V2_ENFORCE_CORTEX=0. */
export function isSwingCortexEnforced(env: Record<string, string | undefined> = process.env): boolean {
  if (!isSwingEngineV2Enabled(env)) return false;
  return envTriState(env, "SWING_ENGINE_V2_ENFORCE_CORTEX", true);
}

/** P3 — G-S3 earnings binary at COMMIT. LIVE when V2 is on; opt out with SWING_ENGINE_V2_ENFORCE_EARNINGS=0. */
export function isSwingEarningsGateEnforced(env: Record<string, string | undefined> = process.env): boolean {
  if (!isSwingEngineV2Enabled(env)) return false;
  return envTriState(env, "SWING_ENGINE_V2_ENFORCE_EARNINGS", true);
}

/** Max watch candidates to Cortex-preflight per scan (provider budget). */
export function swingCortexPreflightCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_CORTEX_PREFLIGHT_CAP ?? 12);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 25) : 12;
}

export function swingLegacyFlowMinPremium(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_FLOW_MIN_PREMIUM ?? 250_000);
  return Number.isFinite(n) && n > 0 ? n : 250_000;
}
