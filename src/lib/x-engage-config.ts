/** FinTwit / market giants — silent engagement (like/follow/RT). Never cold @tag on our timeline. */
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
  "TrendSpider",
  "InvestingVisual",
  "LiveSquawk",
  "Fxhedgers",
  "MichaelBolling",
  "OptionsHawk",
  "StockMKTNewz",
  "PelosiTracker",
  "WallStJesus",
  "MarketWatch",
] as const;

/** Lowercase handles we follow — Enterprise API only for programmatic quote/reply. */
export const ENGAGEMENT_TARGET_SET = new Set(
  ENGAGEMENT_TARGETS.map((h) => h.toLowerCase()),
);

export function isEngagementTarget(username: string | undefined): boolean {
  if (!username) return false;
  return ENGAGEMENT_TARGET_SET.has(username.replace(/^@/, "").toLowerCase());
}

export const SEARCH_QUERIES = [
  "(0DTE OR SPX 0dte) (gamma OR GEX OR dealer) lang:en -is:retweet -from:BlackOutTrade",
  "(SPX OR SPY) (gamma flip OR call wall OR put wall) lang:en -is:retweet -from:BlackOutTrade",
  "(options flow OR whale flow) (SPX OR SPY) lang:en -is:retweet -from:BlackOutTrade",
] as const;

/** Legacy export — prefer x-rate-budget.ts caps. */
export const ENGAGE_LIMITS = {
  likes: 8,
  follows: 3,
  retweets: 1,
  mentionReplies: 5,
  delayMs: 3000,
  rateLimitBackoffMs: 45_000,
} as const;

/** @deprecated use X_CRON_RUN_CAPS in x-rate-budget.ts */
export const ENGAGE_LIMITS_CRON = {
  likes: 3,
  follows: 1,
  retweets: 0,
  mentionReplies: 2,
  delayMs: 2500,
  rateLimitBackoffMs: 30_000,
  targetBatchSize: 2,
  searchHits: 4,
} as const;

export const MAX_TWEET_AGE_HOURS = 6;
export const MIN_IMPRESSIONS_FOR_RT = 500;
/** Intensive growth mode — RT giant desk posts with moderate reach. */
export const MIN_IMPRESSIONS_FOR_RT_INTENSIVE = 200;
