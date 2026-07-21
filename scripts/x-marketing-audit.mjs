#!/usr/bin/env node
/**
 * CTO-level @BlackOutTrade X audit — metrics, recent posts, budget, recommendations.
 * Usage: npm run x-marketing:audit
 */
import { execSync } from "node:child_process";

const BASE = process.env.X_AUTOPOST_APP_URL ?? "https://blackouttrades.com";

function loadSecrets() {
  if (process.env.CRON_SECRET?.trim()) return process.env;
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" },
  );
  return { ...process.env, ...JSON.parse(raw) };
}

const env = loadSecrets();
const secret = env.CRON_SECRET?.trim();
if (!secret) {
  console.error("CRON_SECRET missing");
  process.exit(1);
}

async function cron(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(120_000),
  });
  return res.json();
}

const analytics = await cron("/api/cron/x-analytics");
const snap = analytics.snapshot;
if (!snap) {
  console.error("No analytics snapshot", analytics);
  process.exit(1);
}

const tweets = snap.recent_tweets ?? [];
const avgImps =
  tweets.length > 0
    ? Math.round(tweets.reduce((s, t) => s + (t.impressions ?? 0), 0) / tweets.length)
    : 0;
const avgLikes =
  tweets.length > 0
    ? (tweets.reduce((s, t) => s + (t.likes ?? 0), 0) / tweets.length).toFixed(1)
    : "0";

console.log("\n=== @BlackOutTrade X AUDIT ===");
console.log(`At: ${snap.at}`);
console.log(`Followers: ${snap.followers} · Following: ${snap.following} · Tweets: ${snap.tweet_count}`);
console.log(`Recent avg impressions: ${avgImps} · avg likes: ${avgLikes}`);

console.log("\n--- Recent posts (engagement) ---");
for (const t of tweets.slice(0, 8)) {
  console.log(
    `  ${t.impressions ?? 0} imp · ${t.likes ?? 0}♥ · ${t.replies ?? 0}💬 | ${(t.text ?? "").slice(0, 70).replace(/\n/g, " ")}`,
  );
}

const redFlags = [];
if (avgImps < 100) redFlags.push("CRITICAL: avg impressions <100 — algorithm cold / content penalty");
if (Number(avgLikes) < 1) redFlags.push("CRITICAL: near-zero likes on recent posts");
if (snap.followers > 1500 && avgImps < 50) {
  redFlags.push("Follower/impression mismatch — legacy spam may be suppressing reach");
}
const placeholder = tweets.filter((t) => /flip\s*—|put\s*—|call\s*—/i.test(t.text ?? ""));
if (placeholder.length) redFlags.push(`${placeholder.length} recent posts contain placeholder dashes`);
const tickerSpam = tweets.filter((t) =>
  /tightest gamma|record sitting at|isn't moving on vibes/i.test(t.text ?? ""),
);
if (tickerSpam.length) redFlags.push(`${tickerSpam.length} generic ticker/showcase spam posts`);

console.log("\n--- Red flags ---");
if (!redFlags.length) console.log("  (none detected in snapshot)");
else for (const f of redFlags) console.log(`  • ${f}`);

console.log("\n--- P0 actions ---");
console.log("  1. Timeline cleanup: npm run x-cleanup -- --dry");
console.log("  2. PPU growth = desk posts + likes; FinTwit quotes manual or Enterprise API");
console.log("  3. Profile bio URL (not in-tweet) saves $0.185/post on pay-per-use");
console.log("  4. RTH desk posts with live desk card PNG + question hook");
console.log("  5. Reply when @mentioned: npm run x-marketing:run engage-all");

const dryPost = await cron("/api/cron/x-autopost?dry=1&type=desk_midday");
console.log("\n--- Next desk post preview ---");
console.log(dryPost.content ?? dryPost.reason ?? JSON.stringify(dryPost));
