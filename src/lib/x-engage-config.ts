// FinTwit accounts to engage with (follow, like recent posts, occasional RT).
export const ENGAGEMENT_TARGETS = [
  "spotgamma",
  "unusual_whales",
  "SqueezeMetrics",
  "VolSignals",
  "Cheddarflow",
  "OptionsAction",
  "Tier1Alpha",
  "DeItaone",
  "FirstSquawk",
] as const;

/** Max engagement actions per cron sweep (rate-limit safe). */
export const ENGAGE_LIMITS = {
  likes: 15,
  retweets: 3,
  follows: 8,
  delayMs: 1500,
} as const;
