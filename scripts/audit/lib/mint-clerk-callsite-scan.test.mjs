import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanMintClerkCallsites } from "./mint-clerk-callsite-scan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_ROOT = join(__dirname, "..");

test("flags a bare call with no arguments", () => {
  const src = `const session = await mintClerkPremiumSession();`;
  const hits = scanMintClerkCallsites(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hasAppUrl, false);
  assert.equal(hits[0].argsText, "");
});

test("does not flag a call passing appUrl inline", () => {
  const src = `const session = await mintClerkPremiumSession({ appUrl: BASE });`;
  const hits = scanMintClerkCallsites(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hasAppUrl, true);
});

test("does not flag a multi-line call that mentions appUrl further down", () => {
  const src = [
    "const session = await mintClerkPremiumSession({",
    "  appUrl: BASE,",
    '  publicMetadata: { role: "admin", tier: "premium" },',
    "});",
  ].join("\n");
  const hits = scanMintClerkCallsites(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hasAppUrl, true);
});

test("ignores the function's own declaration, not a call site", () => {
  const src = [
    "export async function mintClerkPremiumSession({",
    "  appUrl,",
    "  publicMetadata = { role: 'admin' },",
    "}) {",
    "  return null;",
    "}",
  ].join("\n");
  const hits = scanMintClerkCallsites(src);
  assert.equal(hits.length, 0, "the declaration itself must never be reported as a call");
});

test("correctly balances nested parens inside the argument list", () => {
  const src = `const session = await mintClerkPremiumSession({ appUrl: resolve(BASE, "x") });`;
  const hits = scanMintClerkCallsites(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hasAppUrl, true);
  assert.ok(hits[0].argsText.includes("resolve(BASE"));
});

test("does not get confused by a stray paren inside a string literal", () => {
  const src = `const session = await mintClerkPremiumSession({ appUrl: "http://example.com/(weird)" });`;
  const hits = scanMintClerkCallsites(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hasAppUrl, true);
});

test("reports a 1-based line number for the call", () => {
  const src = ["// comment", "", "const s = await mintClerkPremiumSession();"].join("\n");
  const hits = scanMintClerkCallsites(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
});

test("finds multiple call sites in one file", () => {
  const src = [
    "await mintClerkPremiumSession();",
    "await mintClerkPremiumSession({ appUrl: BASE });",
  ].join("\n");
  const hits = scanMintClerkCallsites(src);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].hasAppUrl, false);
  assert.equal(hits[1].hasAppUrl, true);
});

/**
 * REPO-WIDE RATCHET: every real call site under scripts/audit must pass `appUrl`.
 *
 * This is the regression test for the actual bug (2026-10-09): five Largo audit scripts called
 * `mintClerkPremiumSession()` bare and crashed with a TypeError before ever authenticating,
 * silently defeating the standing Ask-Largo deep-dive mandate's own tooling. Like this repo's
 * other "list SHRINKS" ratchets, this walks the REAL files on disk so a future callsite can't
 * reintroduce the same mistake without failing CI.
 */
// This scanner's own implementation file documents the bug/pattern in prose and mentions
// `mintClerkPremiumSession(...)`/`mintClerkPremiumSession()` inside JSDoc comments as EXAMPLES,
// not real call sites — excluded here rather than taught to the scanner, since parsing comments
// out correctly is a much bigger (and separately fallible) job than this lint needs.
const SELF_FILE = "mint-clerk-callsite-scan.mjs";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (
      /\.(mjs|cjs|mts|ts)$/.test(entry) &&
      !/\.test\.(mjs|cjs|mts|ts)$/.test(entry) &&
      entry !== SELF_FILE
    ) {
      out.push(full);
    }
  }
  return out;
}

test("every real mintClerkPremiumSession() call site under scripts/audit passes appUrl", () => {
  const offenders = [];
  for (const file of walk(AUDIT_ROOT)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("mintClerkPremiumSession(")) continue;
    for (const hit of scanMintClerkCallsites(src)) {
      if (!hit.hasAppUrl) offenders.push(`${file}:${hit.line}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `found mintClerkPremiumSession() call site(s) missing appUrl (would crash with a TypeError ` +
      `before ever authenticating): ${offenders.join(", ")}`
  );
});
