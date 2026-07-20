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
  "OptionsHawk",
  "drayinvests",
  "Fxhedgers",
  "WallStJesus",
  "JavierBlas",
  "zerohedge",
  "PeterLBrandt",
  "CBOE",
  "MarketWatch",
] as const;

/** Discovery — traders actively posting our niche (follow + like + RT). */
export const SEARCH_QUERIES = [
  "(0DTE OR SPX 0dte) (gamma OR GEX OR dealer) lang:en -is:retweet -from:BlackOutTrade",
  "(SPX OR SPY) (gamma flip OR call wall OR put wall) lang:en -is:retweet -from:BlackOutTrade",
  "(options flow OR whale flow) (SPX OR SPY) lang:en -is:retweet -from:BlackOutTrade",
  "dealer gamma lang:en -is:retweet -from:BlackOutTrade",
  "(0DTE OR zero DTE) (profit OR loss OR setup) lang:en -is:retweet -from:BlackOutTrade",
  "SPX gamma lang:en min_faves:2 -is:retweet -from:BlackOutTrade",
  "options trader SPY lang:en -is:retweet -from:BlackOutTrade",
] as const;

/** Per 30-min growth sweep — max out what Basic tier allows. */
export const ENGAGE_LIMITS = {
  likes: 35,
  follows: 25,
  retweets: 10,
  /** Original @mention tweets — viral surface in their notifications. */
  mentionPosts: 5,
  /** Replies when someone @mentions BlackOutTrade (allowed on Basic). */
  mentionReplies: 20,
  delayMs: 2500,
  /** Back off likes when X returns 429. */
  rateLimitBackoffMs: 45_000,
} as const;

/** Max @mention outreach originals per ET day (engagement, not product spam). */
export const MAX_MENTION_POSTS_PER_DAY = 18;

export const MAX_TWEET_AGE_HOURS = 8;
export const MIN_IMPRESSIONS_FOR_REPLY = 15;
