#!/usr/bin/env node
/**
 * Set `ITSAppUsesNonExemptEncryption = false` on the generated Info.plist.
 *
 * Reason: on first TestFlight upload, Apple otherwise silently withholds
 * the build behind a "Missing Compliance" flag in ASC — the build sits
 * invisible to TestFlight testers until someone answers the encryption
 * question manually in the dashboard. That's 30 seconds of clicking per
 * upload, and — critically — Apple does NOT email you that the build is
 * waiting, so a build sits stuck without any signal.
 *
 * Answering upfront in Info.plist with
 *   `ITSAppUsesNonExemptEncryption = false`
 * tells Apple "this app uses only standard iOS TLS / HTTPS (which is
 * exempt from export compliance)" so the question never appears and the
 * build flows straight through to TestFlight testers.
 *
 * We use `false` because the Capacitor WKWebView shell only uses
 * standard iOS HTTPS/TLS via WKWebView and URLSession — no custom
 * cryptography, no VPN, no ProtonMail-style E2EE. If we ever add real
 * custom crypto, this needs to become `true` + a compliance narrative.
 *
 * Runs AFTER `npx cap sync ios` because that's when Capacitor generates
 * the Info.plist. Idempotent — re-running is a no-op.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const plistPath = join(appRoot, "ios/App/App/Info.plist");

if (!existsSync(plistPath)) {
  console.error(`Missing ${plistPath} — run npx cap sync ios first`);
  process.exit(1);
}

let plist = readFileSync(plistPath, "utf8");
const KEY = "ITSAppUsesNonExemptEncryption";
const alreadyPresent = plist.includes(`<key>${KEY}</key>`);

if (alreadyPresent) {
  // Idempotent — flip to false if it was somehow set to true, else no-op.
  const before = plist;
  plist = plist.replace(
    new RegExp(`(<key>${KEY}</key>\\s*<)(true|false)(/>)`),
    "$1false$3",
  );
  if (plist === before) {
    console.log(`Info.plist already has ${KEY} = false — no change`);
  } else {
    writeFileSync(plistPath, plist, "utf8");
    console.log(`Info.plist: normalised ${KEY} → false`);
  }
} else {
  // Inject right before </dict> at the end of the top-level plist dict.
  // A plist has exactly ONE closing </dict> followed by </plist>; match
  // the last </dict> to be safe against nested dicts (there shouldn't be
  // any in a Capacitor Info.plist, but defensive).
  const insertion = `    <key>${KEY}</key>\n    <false/>\n`;
  const idx = plist.lastIndexOf("</dict>");
  if (idx < 0) {
    console.error(`Info.plist has no </dict> — malformed`);
    process.exit(1);
  }
  plist = plist.slice(0, idx) + insertion + plist.slice(idx);
  writeFileSync(plistPath, plist, "utf8");
  console.log(`Info.plist: added ${KEY} = false`);
}
