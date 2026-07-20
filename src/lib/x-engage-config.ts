// FinTwit accounts to engage with (follow, like recent posts, occasional RT).
export const ENGAGEMENT_TARGETS = [
  "spotgamma",
  "unusual_whales",
  "SqueezeMetrics",
  "VolSignals",
  "Cheddarflow",
  "OptionsAction",
  "MarketRebellion",
  "Tier1Alpha",
  "WallStJesus",
  "OptionsHawk",
  "PelosiTracker_",
  "JavierBlas",
  "zerohedge",
  "DeItaone",
  "FirstSquawk",
] as const;

export const X_SEARCH_QUERIES = [
  "#0DTE lang:en -is:retweet",
  "#SPX gamma lang:en -is:retweet",
  "dealer gamma lang:en -is:retweet",
  "GEX walls lang:en -is:retweet",
] as const;

/** Max engagement actions per cron sweep (rate-limit safe). */
export const ENGAGE_LIMITS = {
  likes: 25,
  retweets: 5,
  follows: 20,
  delayMs: 1500,
} as const;
