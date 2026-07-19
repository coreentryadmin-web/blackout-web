#!/usr/bin/env node
/**
 * Apply Clerk dashboard recommendations (idempotent):
 * - Prod redirect URLs via Backend API
 * - Prints session-token claim JSON for Dashboard → Sessions → Customize session token
 *
 * Usage:
 *   npm run clerk:recommendations-apply
 *   CLERK_SECRET_KEY=sk_... node scripts/clerk-recommendations-apply.mjs
 */
const API = "https://api.clerk.com/v1";

const PROD_REDIRECTS = [
  "https://blackouttrades.com",
  "https://blackouttrades.com/dashboard",
  "https://www.blackouttrades.com",
  "https://www.blackouttrades.com/dashboard",
];

const SESSION_CLAIMS_JSON = {
  tier: "{{user.public_metadata.tier}}",
  role: "{{user.public_metadata.role}}",
};

async function clerkFetch(secret, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    console.error("CLERK_SECRET_KEY required");
    process.exit(1);
  }

  console.log("\n=== Clerk recommendations apply ===\n");

  const instance = await clerkFetch(secret, "GET", "/instance");
  if (instance.status !== 200) {
    console.error("Failed to read instance:", instance.status, instance.json);
    process.exit(1);
  }
  console.log("Instance:", instance.json?.id, instance.json?.environment_type);
  console.log("Allowed origins:", (instance.json?.allowed_origins ?? []).join(", "));

  const existing = await clerkFetch(secret, "GET", "/redirect_urls");
  const have = new Set(
    (Array.isArray(existing.json) ? existing.json : []).map((r) => r.url)
  );

  for (const url of PROD_REDIRECTS) {
    if (have.has(url)) {
      console.log(`  ✓ redirect URL already set: ${url}`);
      continue;
    }
    const created = await clerkFetch(secret, "POST", "/redirect_urls", { url });
    if (created.status === 200 || created.status === 201) {
      console.log(`  ✓ added redirect URL: ${url}`);
      have.add(url);
    } else {
      console.warn(`  ✗ failed redirect URL ${url}:`, created.status, created.json);
    }
  }

  console.log("\n--- Session token claims (manual Dashboard step) ---\n");
  console.log("Clerk Dashboard → Configure → Sessions → Customize session token");
  console.log("Paste this JSON (merge with any existing claims):\n");
  console.log(JSON.stringify(SESSION_CLAIMS_JSON, null, 2));
  console.log(
    "\nAfter saving, existing sessions refresh within ~60s (or use session.reload() after tier changes)."
  );
  console.log("\nValidate with: npm run validate:clerk-config\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
