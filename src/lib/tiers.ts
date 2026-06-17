export type Tier = "free" | "pro" | "elite";

const TIER_RANK: Record<Tier, number> = {
  free: 0,
  pro: 1,
  elite: 2,
};

export function parseTier(value: unknown): Tier {
  if (value === "pro" || value === "elite") return value;
  return "free";
}

export function tierAtLeast(have: Tier, need: Tier): boolean {
  return TIER_RANK[have] >= TIER_RANK[need];
}

export function maxTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  elite: "Elite",
};
