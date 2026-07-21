/** Env toggles for @BlackOutTrade growth ops (ECS task env / Secrets Manager). */

export function xMarketingPostsPaused(): boolean {
  const v = process.env.X_MARKETING_POSTS_PAUSED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Likes + follows only — no quote/reply/RT on our profile. */
export function xMarketingSilentOnly(): boolean {
  const v = process.env.X_GROWTH_SILENT_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
