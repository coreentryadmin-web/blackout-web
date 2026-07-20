#!/usr/bin/env node
/** Delete @tag spam posts from @BlackOutTrade timeline (original tweets starting with @). */
import { execSync } from "node:child_process";

function loadEnv() {
  if (process.env.X_API_KEY?.trim()) return;
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" },
  );
  for (const [k, v] of Object.entries(JSON.parse(raw))) {
    if (typeof v === "string") process.env[k] = v;
  }
}

loadEnv();

const { fetchUserTweets, deleteTweet, X_ACCOUNT_USER_ID } = await import(
  "../src/lib/x-api"
);

const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 40);
const spam = tweets.filter((t) => t.text?.trim().match(/^@\w/i));
console.log(`Found ${spam.length} @tag timeline posts to remove`);
for (const t of spam) {
  const preview = t.text?.slice(0, 60).replace(/\n/g, " ");
  if (process.argv.includes("--dry")) {
    console.log("[dry]", t.id, preview);
    continue;
  }
  const ok = await deleteTweet(t.id);
  console.log(ok ? "deleted" : "fail", t.id, preview);
  await new Promise((r) => setTimeout(r, 1500));
}
