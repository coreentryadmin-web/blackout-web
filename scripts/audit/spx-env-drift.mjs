#!/usr/bin/env node
/**
 * SPX env-drift audit — which deployed env vars OVERRIDE their code default, and by how much.
 *
 * THE QUESTION THIS ANSWERS. "How fresh is the desk lane?" / "is the playbook live gate on?" are
 * behaviour questions, and reading them out of `src/lib/providers/config.ts` can be flatly wrong,
 * because the deployed value is what runs and NOTHING IN THE REPO RECORDS WHICH KEYS ARE SET.
 *
 * Both failure modes were measured on this lane on 2026-08-22, within an hour of each other:
 *   - `SPX_DESK_CACHE_SEC` is 30 in production against a code default of 20, so a freshness table
 *     built from the source was wrong by 50% on the slowest lane — the one the header tiles ride.
 *   - `PLAYBOOK_LIVE_GATE` is "1" against a default of `false`. That was the whole difference
 *     between "a latent landmine" and "two playbooks cannot produce an entry today", i.e. between
 *     a P2 and a P1.
 *
 * A snapshot of the answer in a markdown file would rot exactly the way the documents this lane
 * spent a day reconciling had rotted. So the answer is a script.
 *
 * WHAT IT DOES. Scans the SPX surface for `process.env.X` references, extracts each one's code
 * default from the source, reads the deployed values from the `blackout-production/app/env`
 * secret, and classifies every key as unset / no-op / override / unknown.
 *
 * SAFETY. Read-only — it never writes a secret. Values are redacted BY KEY NAME (never by
 * inspecting the value), so a short secret cannot slip through on length. Only the names and
 * non-secret values are ever printed.
 *
 * NO CREDS = SKIPPED, NEVER RED. Same contract as zerodte-e2e-suite's INFRA section: this must be
 * safe to run in CI or a credential-less sandbox. "I could not look" must never render as "clean".
 *
 * Usage:
 *   node scripts/audit/spx-env-drift.mjs [--json] [--all] [--secret=<id>]
 *     --all   also list the unset keys (default: counts only — there are ~130 of them)
 *
 * Exit codes: 0 = ran (overrides are INFORMATION, not failure); 1 = could not read the source
 * surface at all, which would otherwise report "no drift" from having looked at nothing.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyKey, summarize, displayValue } from "./lib/env-drift-eval.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const showAll = args.includes("--all");
const secretId =
  args.find((a) => a.startsWith("--secret="))?.slice("--secret=".length) ??
  "blackout-production/app/env";

const ROOTS = ["src/features/spx", "src/lib/providers/config.ts"];

function walk(p, out = []) {
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) return out;
  if (st.isFile()) {
    if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
    return out;
  }
  for (const e of readdirSync(p)) walk(join(p, e), out);
  return out;
}

/**
 * Extract `process.env.NAME` and, where the very same expression states one, its fallback.
 *
 * Deliberately conservative: it reads the default only from the three shapes this repo actually
 * uses next to the reference (`?? X`, `: X` in a ternary, `, X)` as a helper's 2nd arg). Anything
 * else reports the default as UNKNOWN rather than guessing — a wrong "default" would manufacture
 * phantom overrides, which is worse than admitting the gap.
 */
function extractRefs(text) {
  const found = new Map();
  // The trailing window is a LOOKAHEAD, deliberately. Consuming it would advance lastIndex past
  // any other `process.env.X` inside those 240 chars, silently dropping keys — measured: an
  // earlier consuming version reported 97 keys instead of 142 and lost two known overrides.
  const re = /(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*)?process\.env\.([A-Z0-9_]+)(?=([\s\S]{0,240}))/g;
  let m;
  while ((m = re.exec(text))) {
    const boundTo = m[1] ?? null;
    const name = m[2];
    const after = m[3];
    const tail = after.split("\n")[0];
    let def = null;
    let mm;
    if ((mm = /^\s*(?:\?\.trim\(\))?\s*\?\?\s*([^;,)\n]+)/.exec(tail))) def = mm[1].trim();
    // `env === "1"` → the default is `false` by construction, so this branch needs the MATCH but
    // not the capture. `.test()` rather than an assignment CodeQL correctly flagged as dead
    // (code-scanning/757): assigning `mm` here and then never reading it invites the next reader
    // to assume the captured value is what sets `def`, which it is not.
    else if (/^[^\n]*?===\s*"[^"]+"/.test(tail)) def = "false";
    else if ((mm = /^\s*,\s*([^)\n]+)\)/.exec(tail))) def = mm[1].trim();
    // THE SHAPE THIS REPO ACTUALLY USES FOR EVERY CACHE TTL, and the one an earlier version of
    // this scan missed — which mattered, because those three keys are exactly the overrides that
    // motivated writing it:
    //
    //     const raw = process.env.SPX_DESK_CACHE_SEC?.trim();
    //     const sec = raw ? Number(raw) : 20;
    //
    // The default is on a LATER line, in a ternary testing the variable the env was bound to. Only
    // matched when we know that variable name, so this cannot pick up an unrelated ternary.
    if (def == null && boundTo) {
      const esc = boundTo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ternary = new RegExp(`\\b${esc}\\s*\\?[^:\n]{0,60}:\\s*([^;,)\n]+)`);
      if ((mm = ternary.exec(after))) def = mm[1].trim();
    }
    const prev = found.get(name);
    // Prefer the first reference that actually states a default.
    if (!prev || (prev.codeDefault == null && def != null)) {
      found.set(name, { name, codeDefault: def ? def.replace(/^["']|["']$/g, "") : null });
    }
  }
  return found;
}

const files = ROOTS.flatMap((r) => walk(r));
if (files.length === 0) {
  console.error("Refusing to report: found no SPX source files to scan (wrong cwd?).");
  process.exit(1);
}
const refs = new Map();
for (const f of files) {
  for (const [name, ref] of extractRefs(readFileSync(f, "utf8"))) {
    const prev = refs.get(name);
    if (!prev || (prev.codeDefault == null && ref.codeDefault != null)) refs.set(name, ref);
  }
}

let deployed = null;
let skipReason = null;
try {
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    "@aws-sdk/client-secrets-manager"
  );
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  deployed = JSON.parse(res.SecretString);
} catch (err) {
  skipReason = String(err?.name ?? err?.message ?? err).slice(0, 120);
}

if (!deployed) {
  const out = {
    verdict: "SKIPPED",
    reason: `could not read ${secretId}: ${skipReason}`,
    note: "SKIPPED is not GREEN — no conclusion about drift can be drawn from a read that never happened.",
    keys_referenced: refs.size,
  };
  console.log(asJson ? JSON.stringify(out, null, 2) : renderSkip(out));
  process.exit(0);
}

const rows = [...refs.values()].map((r) =>
  classifyKey({ name: r.name, deployed: deployed[r.name], codeDefault: r.codeDefault })
);
const s = summarize(rows);

if (asJson) {
  console.log(JSON.stringify({ verdict: "RAN", secret: secretId, summary: s, rows: showAll ? rows : undefined }, null, 2));
  process.exit(0);
}

console.log(`SPX env drift — ${refs.size} keys referenced across ${files.length} files\n`);
console.log(`  unset (code default governs): ${s.unset}`);
console.log(`  no-op  (set = default):       ${s.no_op}`);
console.log(`  OVERRIDE (set != default):    ${s.override}`);
console.log(`  unknown (no default found):   ${s.unknown}\n`);

if (s.overrides.length) {
  console.log("OVERRIDES — the deployed value is the fact; the code default is a decoy:");
  for (const r of s.overrides) {
    console.log(
      `  ${r.name.padEnd(38)} code=${String(r.codeDefault).padEnd(10)} deployed=${displayValue(r.name, r.deployed)}`
    );
  }
  console.log("");
}
if (s.no_ops.length) {
  console.log("NO-OPS — set, but to the default. Looks deliberate; is not:");
  for (const r of s.no_ops) console.log(`  ${r.name.padEnd(38)} = ${displayValue(r.name, r.deployed)}`);
  console.log("");
}
if (s.unknowns.length) {
  console.log("UNKNOWN default — set in production, code default not determinable by this scan:");
  for (const r of s.unknowns) console.log(`  ${r.name.padEnd(38)} = ${displayValue(r.name, r.deployed)}`);
  console.log("");
}
if (showAll) {
  console.log("UNSET (code default governs):");
  for (const r of rows.filter((x) => x.verdict === "unset")) console.log(`  ${r.name}`);
}

function renderSkip(o) {
  return [
    "SPX env drift — SKIPPED",
    `  ${o.reason}`,
    `  ${o.note}`,
    `  (${o.keys_referenced} keys were found in the source and could have been compared)`,
  ].join("\n");
}
