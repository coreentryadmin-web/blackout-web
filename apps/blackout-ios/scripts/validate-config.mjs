#!/usr/bin/env node
/**
 * Lint Capacitor + Codemagic config before a cloud Mac build.
 * Runs on Linux/Windows — no Xcode required.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const cap = read("capacitor.config.ts");
const cm = read("codemagic.yaml");

const expected = {
  appId: "com.blackout-trades.app",
  appleId: "6787797476",
  teamId: "ZA32C782N5",
  ua: "BlackOutiOSApp",
  url: "https://blackouttrades.com",
};

if (!cap.includes(`appId: "${expected.appId}"`)) fail.push(`capacitor appId must be ${expected.appId}`);
if (!cap.includes(`appendUserAgent: "${expected.ua}"`)) fail.push(`appendUserAgent must be ${expected.ua}`);
if (!cap.includes(`url: "${expected.url}"`)) fail.push(`server.url must be ${expected.url}`);

if (!cm.includes(`APP_STORE_APPLE_ID: ${expected.appleId}`)) fail.push(`codemagic APP_STORE_APPLE_ID must be ${expected.appleId}`);
if (!cm.includes(`BUNDLE_ID: "${expected.appId}"`)) fail.push(`codemagic BUNDLE_ID must match appId`);
if (!cm.includes(`APPLE_TEAM_ID: "${expected.teamId}"`)) fail.push(`codemagic APPLE_TEAM_ID must be ${expected.teamId}`);
if (!cm.includes("BlackOut ASC")) fail.push('Codemagic integration must be named "BlackOut ASC"');

console.log("\n=== BlackOut iOS config validation ===\n");
if (fail.length) {
  for (const f of fail) console.log(`  ✗ ${f}`);
  console.log(`\nFAILED (${fail.length})\n`);
  process.exit(1);
}

console.log("  ✓ appId / bundle ID");
console.log("  ✓ Apple ID + Team ID in codemagic.yaml");
console.log("  ✓ BlackOutiOSApp user-agent token");
console.log("  ✓ Production server.url");
console.log("\nGREEN — ready for Codemagic ios-release workflow.\n");
