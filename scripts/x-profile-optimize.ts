#!/usr/bin/env node
/**
 * Optimize @BlackOutTrade profile for follower conversion.
 *
 *   npm run x-profile:optimize           # live bio + website
 *   npm run x-profile:optimize -- --dry  # preview only
 *
 * Pinning: X API has no public pin endpoint on Basic tier — after a desk-post,
 * pin the returned tweetId manually in the X app (or use the PIN_CANDIDATE link).
 */
import { execSync } from "node:child_process";

const PROFILE_BIO =
  "SPX 0DTE desk · live GEX, whale flow & AI reads · SPX Slayer · HELIX · Thermal";

const PROFILE_URL =
  "https://blackouttrades.com/pricing?utm_source=x&utm_medium=social&utm_campaign=profile";

function loadEnv(): void {
  if (process.env.X_API_KEY?.trim()) return;
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" },
  );
  for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
    if (typeof v === "string") process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry");
  const { fetchOwnProfile, updateAccountProfile } = await import(
    "../src/lib/x-api"
  );

  const before = await fetchOwnProfile();
  console.log("Before:", {
    description: before?.description?.slice(0, 80),
    url: before?.url,
    pinned_tweet_id: before?.pinned_tweet_id,
  });

  if (dryRun) {
    console.log("\nWould set:");
    console.log("  bio:", PROFILE_BIO);
    console.log("  url:", PROFILE_URL);
    return;
  }

  await updateAccountProfile({
    description: PROFILE_BIO,
    url: PROFILE_URL,
  });

  const after = await fetchOwnProfile();
  console.log("\nAfter:", {
    description: after?.description,
    url: after?.url,
    pinned_tweet_id: after?.pinned_tweet_id,
  });
  console.log(
    "\nPin step: post a desk card (npm run x-marketing:run desk-post) then pin that tweet in the X app.",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
