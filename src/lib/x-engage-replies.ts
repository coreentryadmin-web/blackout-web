const TICKER_RE = /\$?(SPX|SPY|QQQ|IWM|TSLA|NVDA|META|AAPL)\b/i;

/** Contextual reply — no Whop spam; questions drive comments back. */
export function pickEngagementReply(
  username: string,
  tweetText: string,
): string {
  const handle = username.replace(/^@/, "");
  const u = `@${handle}`;
  const lower = tweetText.toLowerCase();
  const ticker = tweetText.match(TICKER_RE)?.[1]?.toUpperCase() ?? "SPX";

  if (/0dte|zero.?day|zeroday/.test(lower)) {
    return `${u} 0DTE lives or dies on dealer gamma + flip. Are you trading ${ticker} above or below flip today?`;
  }
  if (/gamma flip|flip level/.test(lower)) {
    return `${u} Flip is the line — above it dealers tend to buy dips, below they sell rips. Where's ${ticker} sitting vs yours?`;
  }
  if (/call wall|put wall|max pain/.test(lower)) {
    return `${u} Walls are magnets until they break. Which strike on ${ticker} are you watching as the pin?`;
  }
  if (/gex|gamma exposure|dealer/.test(lower)) {
    return `${u} Dealer hedging flow is the tape underneath the tape. Negative or positive gamma on ${ticker} for you?`;
  }
  if (/flow|whale|unusual|premium/.test(lower)) {
    return `${u} Flow without structure is noise — gamma tells you if dealers fight or fuel the move. What's the setup?`;
  }
  if (/vix|volatility|vol crush/.test(lower)) {
    return `${u} Vol regime flips dealer behavior fast. Are you sizing ${ticker} for expansion or mean-revert here?`;
  }
  if (/\?/.test(tweetText)) {
    return `${u} Good question — we lean on flip + walls first, then flow confirms. What's your bias on ${ticker}?`;
  }

  return `${u} Solid take. Positioning (flip + walls) usually confirms or kills these ${ticker} setups — what's your level?`;
}

/** Quote-tweet commentary — no leading @ (quoted tweet provides context). */
export function pickEngagementQuote(
  username: string,
  tweetText: string,
): string {
  const withHandle = pickEngagementReply(username, tweetText);
  return withHandle.replace(/^@\w+\s+/, "").trim().slice(0, 280);
}

/** X's hard per-tweet character limit. */
const TWEET_CHAR_LIMIT = 280;

/** Warm closer appended to a mention reply when there's room for it. */
const MENTION_WARMTH_SUFFIX = " Always good to connect with traders in the space.";

/**
 * Reply when someone @mentions us — warmer, still one question.
 *
 * Only appends MENTION_WARMTH_SUFFIX when the combined length still fits under
 * TWEET_CHAR_LIMIT. The budget check must be `base.length + suffix.length`, not a bare
 * constant: a fixed "<= 240" guess (this function's prior form) silently assumed the
 * suffix was <=40 chars when it is actually 50, so any base in [231,240] produced a
 * reply up to 290 chars — 10 over the limit. The caller (x-mention-replies.ts) slices
 * to 280 before posting, so this never broke the live API call, but it did mean that
 * specific band of replies lost their closing period/word to a mid-sentence cut instead
 * of degrading cleanly to the base-only fallback this function already has for exactly
 * that situation.
 */
export function pickMentionReply(username: string, mentionText: string): string {
  const base = pickEngagementReply(username, mentionText);
  if (base.length + MENTION_WARMTH_SUFFIX.length <= TWEET_CHAR_LIMIT) {
    return `${base}${MENTION_WARMTH_SUFFIX}`;
  }
  return base.slice(0, TWEET_CHAR_LIMIT - 1);
}

export function isReplyableTweet(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("@blackouttrade")) return false;
  if (/promo|giveaway|discord\.gg|http/i.test(text) && text.length < 80) {
    return false;
  }
  return /spx|spy|qqq|0dte|gamma|gex|dealer|options|flow|vix|wall|flip|regime|put|call|vol/.test(
    lower,
  );
}
