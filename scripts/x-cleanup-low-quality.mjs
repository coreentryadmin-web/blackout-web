#!/usr/bin/env node
/**
 * Remove low-quality timeline posts hurting reach (placeholders, bot threads, generic spam).
 *
 *   node scripts/x-cleanup-low-quality.mjs --dry
 *   node scripts/x-cleanup-low-quality.mjs
 */
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

const DRY = process.argv.includes("--dry");

const LOW_QUALITY = [
  /flip\s*—/i,
  /put\s*—/i,
  /call\s*—/i,
  /Live read: flip/i,
  /^@\w/i,
  /isn't moving on vibes/i,
  /Six tools\. One desk/i,
  /record sitting at \d+\/\d+/i,
  /tightest gamma structure in mega-cap/i,
  // Generic ticker showcase spam (no desk card / hurts reach)
  /\$\d+M call premium on \$/i,
  /Whales REPEAT-printing/i,
  /sitting in \+\$[\d.]+M positive gamma/i,
  /gamma structure is loaded/i,
  /dealers are the shock absorber/i,
  /Semis are about to RIP/i,
  /Tomorrow's playbook is live/i,
  /Top plays ranked before the bell/i,
  /net GEX\. gamma flip at/i,
];

const { fetchUserTweets, deleteTweet, X_ACCOUNT_USER_ID } = await import(
  "../src/lib/x-api.ts"
);

const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 100);
const bad = tweets.filter((t) => {
  const text = t.text ?? "";
  return LOW_QUALITY.some((re) => re.test(text));
});

console.log(`Found ${bad.length} low-quality posts (of ${tweets.length} scanned)`);
for (const t of bad) {
  const preview = t.text?.slice(0, 72).replace(/\n/g, " ");
  if (DRY) {
    console.log("[dry]", t.id, preview);
    continue;
  }
  const ok = await deleteTweet(t.id);
  console.log(ok ? "deleted" : "fail", t.id, preview);
  await new Promise((r) => setTimeout(r, 2000));
}
