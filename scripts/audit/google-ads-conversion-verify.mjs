#!/usr/bin/env node
/**
 * PRE-LAUNCH CONVERSION VERIFIER.
 *
 * "Verify each fires a real event before launch — optimizing toward an event Google never receives
 * is dead on arrival."
 *
 * This checks the three things that are checkable from here, in the order they fail in practice:
 *
 *   1. CONFIG   — are the id and all three labels present and real (not placeholders)?
 *   2. TAG      — does the DEPLOYED page actually carry the AW- config? An env var set in the repo
 *                 but missing from the ECS task definition is the classic gap: local checks pass,
 *                 production ships an untagged page, and nobody notices until the account is still
 *                 at zero two weeks later.
 *   3. PAYLOAD  — for each action, what EXACTLY would be sent? Printed in full, because a payload
 *                 that is well-formed but wrong (flat value, missing currency, reused
 *                 transaction_id) passes every automated check and corrupts bidding.
 *
 * WHAT IT CANNOT DO, STATED PLAINLY: it cannot confirm Google ACCEPTED anything. Egress proves the
 * request left; only the Ads UI ("Conversions → the action shows Recording conversions") or Tag
 * Assistant proves receipt. Treat a green run here as necessary, never sufficient — the final
 * gate is a real test conversion visible in the account.
 *
 * Usage:
 *   node --import tsx scripts/audit/google-ads-conversion-verify.mjs [--base=…] [--json]
 *
 * Exits non-zero when any REQUIRED check fails, so it can gate a launch.
 */

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const BASE = ((args.find((a) => a.startsWith("--base=")) || "").split("=")[1] || "https://blackouttrades.com").replace(/\/$/, "");

// Imported from the SHIPPING module, never reimplemented. A verifier carrying its own copy of the
// validation would eventually disagree with the code it verifies — and it would disagree in the
// direction that matters, passing a config production rejects (or vice versa).
import {
  conversionStatus,
  googleAdsConversionId,
  googleAdsLabel,
  buildConversionPayload,
} from "../../src/lib/analytics/google-ads.ts";

const ACTIONS = [
  { key: "signup", env: "NEXT_PUBLIC_GOOGLE_ADS_LABEL_SIGNUP", primary: true, valued: false,
    fires: "session cookie present on /upgrade after a pending sign-up" },
  { key: "purchase", env: "NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE", primary: true, valued: true,
    fires: "tier flips free → paid after the Whop round-trip" },
  { key: "pricing_view", env: "NEXT_PUBLIC_GOOGLE_ADS_LABEL_PRICING_VIEW", primary: false, valued: false,
    fires: "first /pricing view per browser session" },
];

const results = [];
function record(check, verdict, detail) {
  results.push({ check, verdict, detail });
  if (!JSON_OUT) {
    const mark = verdict === "PASS" ? "PASS" : verdict === "WARN" ? "WARN" : "FAIL";
    console.log(`[${mark}] ${check} — ${detail}`);
  }
}

// ── 1. CONFIG ─────────────────────────────────────────────────────────────────────────────────
const status = conversionStatus();
const rawId = googleAdsConversionId();
const idOk = rawId != null;

if (!idOk) {
  // Never print the raw value — ids are account-identifying. The module's own problem string
  // already distinguishes "not set" from "set but a placeholder".
  record("config.conversion_id", "FAIL", status.problems[0] ?? "no usable conversion id");
} else {
  record("config.conversion_id", "PASS", "a well-formed AW- conversion id is configured");
}

for (const a of ACTIONS) {
  const tier = a.primary ? "PRIMARY" : "secondary";
  if (googleAdsLabel(a.key) == null) {
    record(
      `config.label.${a.key}`,
      a.primary ? "FAIL" : "WARN",
      `${a.env} is missing or a placeholder — the ${tier} "${a.key}" action cannot fire`
    );
  } else {
    record("config.label." + a.key, "PASS", `${tier} "${a.key}" has a label (fires when: ${a.fires})`);
  }
}

// ── 2. TAG ON THE DEPLOYED PAGE ───────────────────────────────────────────────────────────────
// Fetches the real marketing page. An env var set in the repo but absent from the ECS task
// definition produces exactly this: green config locally, untagged HTML in production.
try {
  const res = await fetch(`${BASE}/pricing`, { headers: { "user-agent": "blackout-conversion-verify" } });
  const html = await res.text();
  // NOTE ON WHAT THIS CAN SEE. The tags are Next.js <Script strategy="afterInteractive">, so they
  // are NOT <script src> elements in the served HTML — they are injected by client JS after
  // hydration. Three earlier versions of this check string-matched the gtag.js URL and reported
  // PASS; that was a FALSE pass, matching the URL where it sits as data inside the RSC payload.
  // Parsing script srcs correctly reports it absent, which is also not the answer anyone wants.
  //
  // So the check is now the one thing that is both meaningful and observable from a plain fetch:
  // is the AW- config snippet in the payload we deploy? That is exactly what this repo controls.
  // Whether the browser then executes it is a RUNTIME question, and the honest tool for that is
  // the browser harness (scripts/audit/largo-ui-walkthrough.cjs uses the same tunnel) or Tag
  // Assistant — not a regex over HTML.
  //
  // The inline snippet IS in the payload (it is `<Script id="ga4-init">`'s body, serialized), so
  // matching it is meaningful. It is not a URL and not a trust decision, so there is no host to
  // anchor and nothing to sanitize.
  const awConfigs = [...html.matchAll(/gtag\(\s*['"]config['"]\s*,\s*['"](AW-\d+)['"]\s*\)/g)].map((m) => m[1]);

  if (awConfigs.length === 0) {
    record("tag.aw_config", "FAIL", `no gtag('config','AW-…') in the deployed HTML — the Ads tag is NOT live on ${BASE}`);
  } else if (idOk && !awConfigs.includes(rawId)) {
    record("tag.aw_config", "FAIL", "the deployed page configures a DIFFERENT AW- id than this environment expects");
  } else {
    record("tag.aw_config", "PASS", "the deployed page configures the Ads conversion id");
  }
} catch (err) {
  record("tag.fetch", "FAIL", `could not fetch ${BASE}/pricing: ${err instanceof Error ? err.message : String(err)}`);
}

// ── 3. PAYLOADS ───────────────────────────────────────────────────────────────────────────────
// Printed in full. A payload that is well-formed but wrong passes every automated check and
// quietly corrupts bidding, so a human reads these before launch.
if (!JSON_OUT) console.log("\nPayloads that WOULD be sent (read these — a valid-but-wrong payload is the real risk):");
for (const a of ACTIONS) {
  // Built by the REAL builder, so what is printed here is byte-identical to what ships. A sample
  // value is passed for the valued action because the real one is only known at purchase time.
  const payload = buildConversionPayload(a.key, a.valued ? { value: 1999, transactionId: "<userId>:<tier>" } : {});
  if (!JSON_OUT) {
    console.log(
      payload
        ? `  ${a.key}: ${JSON.stringify(payload)}${a.valued ? "   (value shown is a sample — the real one is the plan clicked)" : ""}`
        : `  ${a.key}: (nothing — unconfigured, correctly sends NOTHING rather than a broken payload)`
    );
  }
}

// ── VERDICT ───────────────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.verdict === "FAIL");
const warned = results.filter((r) => r.verdict === "WARN");

if (JSON_OUT) {
  console.log(JSON.stringify({ base: BASE, results, failed: failed.length, warned: warned.length }, null, 2));
} else {
  console.log("\n" + "=".repeat(90));
  console.log(`${results.length - failed.length - warned.length} pass · ${warned.length} warn · ${failed.length} FAIL`);
  if (failed.length) {
    console.log("\nDO NOT LAUNCH. Conversion tracking is not live; spend during this window is unattributable.");
  } else {
    console.log("\nConfig and tag are live. FINAL GATE, not covered by this script: complete ONE real");
    console.log("test conversion of each action and confirm it appears in Google Ads (Goals →");
    console.log("Conversions → status 'Recording conversions'). Egress proves the request left; only");
    console.log("the account proves Google accepted it.");
  }
}

process.exit(failed.length ? 1 : 0);
