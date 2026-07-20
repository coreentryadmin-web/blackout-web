#!/usr/bin/env node
/**
 * Immediate @BlackOutTrade growth run — post + engage from VM (OAuth 1.0a).
 *
 * Usage:
 *   node scripts/x-marketing-run.mjs post              # one tweet (live market data)
 *   node scripts/x-marketing-run.mjs engage            # likes/follows/RTs
 *   node scripts/x-marketing-run.mjs all               # post then engage
 *   node scripts/x-marketing-run.mjs post --force        # skip slot check
 *
 * Loads X_* from env or AWS Secrets Manager (blackout-production/app/env).
 */
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const X_USER_ID = "2055511397338087425";
const WHOP = "whop.com/blackout-2d9c";
const TAG = "@BlackOutTrade";
const APP_BASE = "https://blackouttrades.com";

const ENGAGEMENT_TARGETS = [
  "spotgamma", "unusual_whales", "SqueezeMetrics", "VolSignals", "Cheddarflow",
  "OptionsAction", "Tier1Alpha", "DeItaone", "FirstSquawk",
];

function loadSecrets() {
  if (process.env.X_API_KEY?.trim()) return process.env;
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" },
  );
  return { ...process.env, ...JSON.parse(raw) };
}

function creds(env) {
  return {
    ck: env.X_API_KEY.trim(),
    cs: env.X_API_KEY_SECRET.trim(),
    at: env.X_ACCESS_TOKEN.trim(),
    ats: env.X_ACCESS_TOKEN_SECRET.trim(),
  };
}

function pctEnc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauthHeader(method, baseUrl, extra = {}, { ck, cs, at, ats }) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const oauth = {
    oauth_consumer_key: ck,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_token: at,
    oauth_version: "1.0",
  };
  const all = { ...oauth, ...extra };
  const paramStr = Object.keys(all).sort().map((k) => `${pctEnc(k)}=${pctEnc(all[k])}`).join("&");
  const baseStr = `${method}&${pctEnc(baseUrl)}&${pctEnc(paramStr)}`;
  const sigKey = `${pctEnc(cs)}&${pctEnc(ats)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", sigKey).update(baseStr).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${pctEnc(k)}="${pctEnc(oauth[k])}"`).join(", ");
}

async function oauthJson(method, url, body, c) {
  const u = new URL(url);
  const base = `${u.origin}${u.pathname}`;
  const q = {};
  u.searchParams.forEach((v, k) => { q[k] = v; });
  const headers = { Authorization: oauthHeader(method, base, method === "GET" ? q : {}, c) };
  const init = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function fetchMarket() {
  try {
    const [gex, regime] = await Promise.all([
      fetch(`${APP_BASE}/api/vector/gex-ladder?ticker=SPX&dte=0DTE`, { signal: AbortSignal.timeout(12000) }).then((r) => r.ok ? r.json() : null),
      fetch(`${APP_BASE}/api/vector/regime?ticker=SPX`, { signal: AbortSignal.timeout(12000) }).then((r) => r.ok ? r.json() : null),
    ]);
    return {
      spot: gex?.spot ?? regime?.spot,
      regime: regime?.regime ?? "unknown",
      flip: gex?.flipLevel ?? regime?.flipLevel,
      callWall: gex?.topCallWall?.strike,
      putWall: gex?.topPutWall?.strike,
    };
  } catch {
    return { regime: "unknown" };
  }
}

function buildTweet(d) {
  const spot = d.spot ? `$${Math.round(d.spot)}` : "SPX";
  const regime = String(d.regime ?? "unknown").replace(/_/g, " ");
  const flip = d.flip ? `$${d.flip}` : "the flip";
  const templates = [
    `${spot} in ${regime} gamma. Flip ${flip}. Dealers amplify below, dampen above. That's the whole session.\n\nWhat's your read — pin or trend?`,
    `Morning levels don't lie: call wall ${d.callWall ?? "—"}, put wall ${d.putWall ?? "—"}. ${regime} regime at the open.\n\nWe map this live on Vector.`,
    `FREE LEVEL: ${spot} vs flip ${flip}. ${regime} = faster moves through the flip.\n\nPremium desk from $199/mo — Community Discord $75/mo.`,
    `Trading 0DTE without dealer gamma is guessing. ${spot}, ${regime}, walls loaded before the bell.\n\nHelix catches the whales. Vector shows the walls.`,
  ];
  const body = templates[Math.floor(Math.random() * templates.length)];
  return `${body}\n${TAG} ${WHOP}`.slice(0, 280);
}

async function postTweet(text, c) {
  const json = await oauthJson("POST", "https://api.x.com/2/tweets", { text }, c);
  return json.data;
}

async function likeTweet(tweetId, c) {
  const res = await oauthJson("POST", `https://api.x.com/2/users/${X_USER_ID}/likes`, { tweet_id: tweetId }, c);
  return res.data?.liked === true;
}

async function retweet(tweetId, c) {
  const res = await oauthJson("POST", `https://api.x.com/2/users/${X_USER_ID}/retweets`, { tweet_id: tweetId }, c);
  return res.data?.retweeted === true;
}

async function followUser(targetId, c) {
  const res = await oauthJson("POST", `https://api.x.com/2/users/${X_USER_ID}/following`, { target_user_id: targetId }, c);
  return !!res.data?.following;
}

async function lookupUser(username, c) {
  const json = await oauthJson("GET", `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=username`, undefined, c);
  return json.data;
}

async function userTweets(userId, c) {
  const q = new URLSearchParams({ max_results: "5", exclude: "retweets,replies", "tweet.fields": "created_at" });
  const json = await oauthJson("GET", `https://api.x.com/2/users/${userId}/tweets?${q}`, undefined, c);
  return json.data ?? [];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runPost(c) {
  const data = await fetchMarket();
  const text = buildTweet(data);
  console.log("Posting:\n", text, "\n---");
  const tweet = await postTweet(text, c);
  console.log("Posted:", tweet.id, tweet.text?.slice(0, 80));
  return tweet;
}

async function runEngage(c) {
  const stats = { likes: 0, rts: 0, follows: 0 };
  for (const handle of ENGAGEMENT_TARGETS) {
    const user = await lookupUser(handle, c).catch(() => null);
    if (!user) { console.warn("skip", handle); continue; }
    if (await followUser(user.id, c).catch(() => false)) {
      stats.follows++;
      console.log("followed", handle);
    }
    await sleep(1500);
    const tweets = await userTweets(user.id, c).catch(() => []);
    for (const t of tweets) {
      const lower = t.text.toLowerCase();
      if (!/spx|spy|0dte|gamma|gex|options|flow|vix|dealer/.test(lower)) continue;
      if (await likeTweet(t.id, c).catch(() => false)) {
        stats.likes++;
        console.log("liked", handle, t.id);
      }
      await sleep(1500);
      if (stats.rts < 3 && /\$|\d{3,}|million|whale/.test(lower)) {
        if (await retweet(t.id, c).catch(() => false)) {
          stats.rts++;
          console.log("RT", handle, t.id);
        }
        await sleep(1500);
      }
      if (stats.likes >= 20) break;
    }
    if (stats.likes >= 20) break;
  }
  console.log("Engage stats:", stats);
  return stats;
}

const mode = process.argv[2] ?? "all";
const env = loadSecrets();
const c = creds(env);

try {
  if (mode === "post" || mode === "all") await runPost(c);
  if (mode === "engage" || mode === "all") await runEngage(c);
} catch (e) {
  console.error(e.message ?? e);
  process.exit(1);
}
