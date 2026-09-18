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

// 2026-09-08 (operator directive, whole-market volume complaint — "feels like gates/architecture
// itself is fucked up, we should be getting more plays"): ceiling raised 200→300 and pool pct
// 0.35→0.45. This is the single biggest lever in the swing pipeline — it directly controls how
// many merged Tier-0 names ever reach Tier-1 scoring/dossier-building, upstream of every other
// floor (persistence, confluence, Cortex). No specific negative-EV evidence is tied to raising
// it (unlike the 0DTE score bands in zerodte/gates.ts) — it is pure candidate-pool breadth, not
// a quality bar being bypassed.
export function swingTier1CapCeiling(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_TIER1_CAP_MAX ?? env.SWING_TIER1_CAP_CEILING ?? 300);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}

export function swingTier1CapPoolPct(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_TIER1_CAP_POOL_PCT ?? 0.45);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.45;
}

/** FLOW premium floor when corroborated (FLOW+STRUCTURE). Default $100k (lowered from $150k on
 *  2026-09-08, operator directive) vs legacy $250k (also lowered, see below). */
export function swingCorroboratedFlowMinPremium(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_CORROBORATED_FLOW_MIN_PREMIUM ?? 100_000);
  return Number.isFinite(n) && n > 0 ? n : 100_000;
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

/** P3 — G-S12 halt/LULD at COMMIT. LIVE when V2 is on; opt out with SWING_ENGINE_V2_ENFORCE_HALT=0. */
export function isSwingHaltGateEnforced(env: Record<string, string | undefined> = process.env): boolean {
  if (!isSwingEngineV2Enabled(env)) return false;
  return envTriState(env, "SWING_ENGINE_V2_ENFORCE_HALT", true);
}

/** P3 — G-S4 regime blind at COMMIT. LIVE when V2 is on; opt out with SWING_ENGINE_V2_ENFORCE_REGIME=0. */
export function isSwingRegimeGateEnforced(env: Record<string, string | undefined> = process.env): boolean {
  if (!isSwingEngineV2Enabled(env)) return false;
  return envTriState(env, "SWING_ENGINE_V2_ENFORCE_REGIME", true);
}

/** P4 — quote staleness at COMMIT (legacy quote_stale). LIVE when V2 is on; opt out with SWING_ENGINE_V2_ENFORCE_QUOTE_STALE=0. */
export function isSwingQuoteStaleGateEnforced(env: Record<string, string | undefined> = process.env): boolean {
  if (!isSwingEngineV2Enabled(env)) return false;
  return envTriState(env, "SWING_ENGINE_V2_ENFORCE_QUOTE_STALE", true);
}

/** P4 — daily bar completeness at COMMIT (legacy daily_bar_incomplete).
 *  OFF by default until reference-bar availability is wired (not the cash-RTH clock).
 *  Opt in with SWING_ENGINE_V2_ENFORCE_DAILY_BAR=1. */
export function isSwingDailyBarGateEnforced(env: Record<string, string | undefined> = process.env): boolean {
  if (!isSwingEngineV2Enabled(env)) return false;
  return envTriState(env, "SWING_ENGINE_V2_ENFORCE_DAILY_BAR", false);
}

/** Max watch candidates to Cortex-preflight per scan (provider budget). Raised 12→20 (still
 *  hard-capped at 25) on 2026-09-08 — more candidates get a Cortex-informed commit read instead
 *  of going without one. */
export function swingCortexPreflightCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_CORTEX_PREFLIGHT_CAP ?? 20);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 25) : 20;
}

/** 2026-09-08: lowered $250k→$175k (operator directive) — same reasoning as the corroborated
 *  floor above. */
export function swingLegacyFlowMinPremium(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWING_FLOW_MIN_PREMIUM ?? 175_000);
  return Number.isFinite(n) && n > 0 ? n : 175_000;
}
