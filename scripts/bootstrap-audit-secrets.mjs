#!/usr/bin/env node
/**
 * Bootstrap prod audit secrets from AWS Secrets Manager into the current process.
 * Writes audit-output/.env.audit (gitignored) for shell sourcing.
 *
 * Requires AWS credentials (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION).
 * Cursor Cloud Agent: ensure these are injected from team secrets.
 *
 * Usage:
 *   eval "$(node scripts/bootstrap-audit-secrets.mjs --export)"
 *   source <(node scripts/bootstrap-audit-secrets.mjs --export)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadProdSecretsFromAws } from "./audit/lib/prod-secrets.mjs";

const OUT = join(process.cwd(), "audit-output");
const ENV_FILE = join(OUT, ".env.audit");
const KEYS = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CRON_SECRET",
  "POLYGON_API_KEY",
  "UW_API_KEY",
  "DATABASE_URL",
  "DATABASE_PUBLIC_URL",
];

const secrets = loadProdSecretsFromAws();
const found = KEYS.filter((k) => secrets[k]?.trim());
const missing = KEYS.filter((k) => !secrets[k]?.trim());

mkdirSync(OUT, { recursive: true });

const lines = found.map((k) => `${k}=${JSON.stringify(secrets[k].trim())}`);
writeFileSync(ENV_FILE, lines.join("\n") + "\n", { mode: 0o600 });

if (process.argv.includes("--export")) {
  for (const k of found) {
    console.log(`export ${k}=${JSON.stringify(secrets[k].trim())}`);
  }
  if (missing.length) {
    console.error(`# missing: ${missing.join(", ")}`);
  }
  process.exit(found.length > 0 ? 0 : 1);
}

console.log(`Bootstrap: ${found.length}/${KEYS.length} secrets loaded → ${ENV_FILE}`);
if (missing.length) console.log(`Missing: ${missing.join(", ")}`);
process.exit(found.length > 0 ? 0 : 1);
