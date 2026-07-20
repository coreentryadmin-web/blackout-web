const VIRAL_MENTION_HOOKS = [
  (u: string, topic: string) =>
    `${u} This ${topic} take is underrated — flip + dealer gamma usually confirm or nuke it. What's your level?`,
  (u: string) =>
    `${u} Real ones check positioning before the chart. SPX flip or trend today — which camp are you in?`,
  (u: string) =>
    `${u} Saving this — walls + flow together beat either alone. What ticker are you running tomorrow?`,
  (u: string) =>
    `${u} Hot thread. Negative gamma below flip = dealers amplify every move. You seeing the same on SPX?`,
  (u: string) =>
    `${u} Respect — most traders skip dealer hedging entirely. What's your go-to 0DTE filter?`,
  (u: string) =>
    `${u} This is the convo more of FinTwit should be having. Call wall or put wall pinning your ticker?`,
];

function detectTopic(text: string): string {
  const lower = text.toLowerCase();
  if (/0dte|zero.?day/.test(lower)) return "0DTE";
  if (/gamma|gex/.test(lower)) return "gamma";
  if (/flow|whale/.test(lower)) return "flow";
  if (/spx|spy/.test(lower)) return "SPX";
  return "setup";
}

/** Original @mention tweet — lands in their notifications (Basic tier safe). */
export function buildMentionOutreachTweet(
  username: string,
  tweetText: string,
): string {
  const u = `@${username.replace(/^@/, "")}`;
  const topic = detectTopic(tweetText);
  const hook =
    VIRAL_MENTION_HOOKS[
      Math.floor(Math.random() * VIRAL_MENTION_HOOKS.length)
    ];
  return hook(u, topic).slice(0, 280);
}
