/** Env toggles for @BlackOutTrade growth ops (ECS task env / Secrets Manager). */

/** X API billing tier — see docs/ops/X-MARKETING-AUDIT.md § Pay-per-use. */
export type XApiAccessTier = "ppu" | "enterprise";

export function xApiAccessTier(): XApiAccessTier {
  const v = process.env.X_API_ACCESS_TIER?.trim().toLowerCase();
  return v === "enterprise" ? "enterprise" : "ppu";
}

/** Enterprise only: programmatic quote-posts + cold replies on FinTwit threads. */
export function xApiEnterpriseAccess(): boolean {
  return xApiAccessTier() === "enterprise";
}

export function xMarketingPostsPaused(): boolean {
  const v = process.env.X_MARKETING_POSTS_PAUSED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Likes + follows only — no quote/reply on our profile (RT still OK). */
export function xMarketingSilentOnly(): boolean {
  const v = process.env.X_GROWTH_SILENT_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Desk autopost footer includes pricing URL ($0.20/post on PPU).
 * Default off — bio carries blackouttrades.com/pricing ($0.015/post body).
 */
export function xDeskPostIncludeUrl(): boolean {
  const v = process.env.X_DESK_POST_INCLUDE_URL?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return xApiEnterpriseAccess();
}

/** User-requested burst mode: 30-min cron, larger batches, RT on giants (until X_GROWTH_INTENSIVE=0). */
export function xGrowthIntensive(): boolean {
  const v = process.env.X_GROWTH_INTENSIVE?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return v === "1" || v === "true" || v === "yes";
}
