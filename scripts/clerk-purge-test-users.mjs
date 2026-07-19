#!/usr/bin/env node
/**
 * Delete Clerk test/automation users from production (or any instance).
 *
 * Keeps: ADMIN_EMAILS, coreentryadmin@gmail.com, all tier=premium users,
 * and any real email without test patterns.
 *
 *   node scripts/clerk-purge-test-users.mjs --dry-run
 *   node scripts/clerk-purge-test-users.mjs --apply
 *
 * Requires CLERK_SECRET_KEY (prod secret or keyless dev).
 */
import { clerkBackend } from "./audit/lib/keyless-clerk-session.mjs";

const APPLY = process.argv.includes("--apply");

const KEEP = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
KEEP.add("coreentryadmin@gmail.com");

const TEST =
  /(@example\.com$|@blackouttrades\.com$|e2e|audit|probe|sweep|staging|ios-ui|desk-load|exhaustive|debug|pb-probe|live-|jwt|rth-|vector-rth|zerodte|spx-audit|status-probe|local-debug|prod-ui-audit|prod-login|test-|clerk_test|admin-users-|live60-|livechk-|live-validate|vvol|jwt2-)/i;

function primaryEmail(user) {
  const pid = user.primary_email_address_id;
  return user.email_addresses?.find((e) => e.id === pid)?.email_address ?? null;
}

function isBot(email, tier) {
  if (!email) return false;
  const e = email.toLowerCase();
  if (KEEP.has(e)) return false;
  if (tier === "premium") return false;
  return TEST.test(e);
}

async function listAllUsers(backend) {
  const users = [];
  let offset = 0;
  while (true) {
    const res = await backend("GET", `/users?limit=100&offset=${offset}`);
    const batch = Array.isArray(res.json) ? res.json : res.json?.data ?? [];
    if (!batch.length) break;
    users.push(...batch);
    if (batch.length < 100) break;
    offset += batch.length;
  }
  return users;
}

async function main() {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    console.error("CLERK_SECRET_KEY required");
    process.exit(1);
  }

  const backend = await clerkBackend(secret);
  const users = await listAllUsers(backend);
  const toDelete = [];
  const keep = [];

  for (const u of users) {
    const email = primaryEmail(u);
    const tier = String(u.public_metadata?.tier ?? "free");
    if (isBot(email, tier)) toDelete.push({ id: u.id, email });
    else keep.push(email);
  }

  console.log(`Clerk users: ${users.length} | delete: ${toDelete.length} | keep: ${keep.length}`);
  if (toDelete.length) {
    console.log("\nTo delete:");
    for (const row of toDelete) console.log(`  ${row.email} (${row.id})`);
  }

  if (!APPLY) {
    console.log("\nDry run — pass --apply to delete.");
    return;
  }

  let ok = 0;
  for (const row of toDelete) {
    const res = await backend("DELETE", `/users/${row.id}`);
    if (res.status === 200 || res.status === 204) ok++;
    else console.warn(`FAIL ${row.email}: HTTP ${res.status}`, res.json);
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`\nDeleted ${ok}/${toDelete.length}`);
  if (ok !== toDelete.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
