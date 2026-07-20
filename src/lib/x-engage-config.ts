/** FinTwit accounts — silent engagement only (like/follow/RT). Never @tag on our timeline. */
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
  "drayinvests",
] as const;

export const SEARCH_QUERIES = [
  "(0DTE OR SPX 0dte) (gamma OR GEX OR dealer) lang:en -is:retweet -from:BlackOutTrade",
  "(SPX OR SPY) (gamma flip OR call wall OR put wall) lang:en -is:retweet -from:BlackOutTrade",
  "(options flow OR whale flow) (SPX OR SPY) lang:en -is:retweet -from:BlackOutTrade",
] as const;

/** Silent engagement — nothing new on our profile except scheduled desk posts. */
export const ENGAGE_LIMITS = {
  likes: 20,
  follows: 10,
  /** RT sparingly — only truly high-signal posts. */
  retweets: 3,
  mentionReplies: 15,
  delayMs: 3000,
  rateLimitBackoffMs: 45_000,
} as const;

export const MAX_TWEET_AGE_HOURS = 6;
export const MIN_IMPRESSIONS_FOR_RT = 100;
