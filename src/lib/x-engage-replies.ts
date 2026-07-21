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

/** Reply when someone @mentions us — warmer, still one question. */
export function pickMentionReply(username: string, mentionText: string): string {
  const base = pickEngagementReply(username, mentionText);
  if (base.length <= 240) {
    return `${base} Always good to connect with traders in the space.`;
  }
  return base.slice(0, 279);
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
