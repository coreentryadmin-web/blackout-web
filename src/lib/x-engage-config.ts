/** Large FinTwit / flow accounts — follow + engage on their threads. */
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
  "MarketRebellion",
  "PelosiTracker_",
  "OptionsHawk",
  "drayinvests",
  "Fxhedgers",
  "WallStJesus",
] as const;

/** Discovery — find traders posting about our niche (reply = visibility + followers). */
export const SEARCH_QUERIES = [
  "(0DTE OR SPX 0dte) (gamma OR GEX OR dealer) lang:en -is:retweet -from:BlackOutTrade",
  "(SPX OR SPY) (gamma flip OR call wall OR put wall) lang:en -is:retweet -from:BlackOutTrade",
  "(options flow OR whale flow) (SPX OR SPY) lang:en -is:retweet -from:BlackOutTrade",
  "dealer gamma lang:en -is:retweet -from:BlackOutTrade",
] as const;

/** Per cron sweep — Basic tier: no replies on others' threads; likes/follows/RTs + @mention posts. */
export const ENGAGE_LIMITS = {
  likes: 25,
  /** Replies only via x-replies cron (@mentions). Proactive thread replies need elevated API tier. */
  replies: 0,
  follows: 20,
  retweets: 5,
  /** Original tweets tagging accounts — shows in their notifications. */
  mentionPosts: 3,
  delayMs: 2000,
} as const;

/** Skip tweets older than this (hours) — reply on fresh threads only. */
export const MAX_TWEET_AGE_HOURS = 6;

/** Prefer tweets with impressions above this (when metrics available). */
export const MIN_IMPRESSIONS_FOR_REPLY = 20;
