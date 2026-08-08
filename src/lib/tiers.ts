export type Tier = "free" | "community" | "premium";

export const TIER_RANK: Record<Tier, number> = {
  free: 0,
  community: 1,
  premium: 2,
};

export function parseTier(value: unknown): Tier {
  if (value === "premium" || value === "pro" || value === "elite") return "premium";
  if (value === "community") return "community";
  return "free";
}

export function tierAtLeast(have: Tier, need: Tier): boolean {
  return TIER_RANK[have] >= TIER_RANK[need];
}

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  community: "SPX Slayer",
  premium: "Premium",
};
