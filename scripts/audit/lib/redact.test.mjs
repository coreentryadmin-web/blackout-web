/**
 * Tests for the secret-safe subprocess error text.
 *
 * The first test is the REPRODUCTION: it runs a real failing `execFileSync` with a fake secret in
 * the argv, exactly as every curl-based harness does, and asserts (a) the old one-liner leaked it
 * and (b) the new helper does not. If someone reverts to `String(e.message).split("\n")[0]`, the
 * assertion that the helper's output excludes the secret fails.
 *
 * Run: node --test scripts/audit/lib/redact.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { redactSecrets, subprocessErrorMessage, REDACTED } from "./redact.mjs";

// Assembled at runtime, never written as a literal: a literal `sk_live_...` in the tree trips
// GitHub push protection (it reads as a Stripe key), and committing a secret-SHAPED string to
// prove we redact secrets would be its own small joke at this module's expense.
const FAKE_SECRET = ["sk", "live", "NOTAREALSECRET0123456789abcdef"].join("_");

test("REPRODUCTION: a failed curl carries the Authorization header into e.message", () => {
  let err;
  try {
    execFileSync(
      "curl",
      ["-sS", "--max-time", "2", "-o", "/dev/null", "-H", `Authorization: Bearer ${FAKE_SECRET}`, "http://127.0.0.1:9/nope"],
      { encoding: "utf8" }
    );
  } catch (e) {
    err = e;
  }
  assert.ok(err, "curl to a closed port must fail");

  // This is what the harnesses used to capture. It leaks.
  const legacy = String(err.message || err).split("\n")[0];
  assert.ok(
    legacy.includes(FAKE_SECRET),
    "precondition: Node's `Command failed:` line contains the argv, including the secret. " +
      "If this ever stops being true the leak is gone, but so is the reason for this module."
  );

  // This is what they capture now.
  const safe = subprocessErrorMessage(err);
  assert.ok(!safe.includes(FAKE_SECRET), `subprocessErrorMessage leaked the secret: ${safe}`);
  assert.ok(!/^Command failed:/i.test(safe), "must never return the argv line");
  assert.ok(safe.length > 0, "must still return a usable diagnostic");
});

test("subprocessErrorMessage prefers the child's own stderr", () => {
  const e = { stderr: "curl: (7) Failed to connect to 127.0.0.1 port 9\n", message: `Command failed: curl -H Authorization: Bearer ${FAKE_SECRET}` };
  const out = subprocessErrorMessage(e);
  assert.match(out, /Failed to connect/);
  assert.ok(!out.includes(FAKE_SECRET));
});

test("subprocessErrorMessage drops the argv line when there is no stderr", () => {
  const e = { message: `Command failed: curl -H Authorization: Bearer ${FAKE_SECRET}\ncurl: (7) refused` };
  const out = subprocessErrorMessage(e);
  assert.equal(out, "curl: (7) refused");
});

test("subprocessErrorMessage still returns something when the argv line is all there is", () => {
  const e = { message: `Command failed: curl -H Authorization: Bearer ${FAKE_SECRET}` };
  const out = subprocessErrorMessage(e);
  assert.ok(!out.includes(FAKE_SECRET), `leaked: ${out}`);
  assert.ok(out.length > 0);
});

test("redactSecrets removes env values under secret-shaped names", () => {
  const env = {
    CLERK_SECRET_KEY: ["sk", "live", "abcdefghijklmnop"].join("_"),
    SOME_API_TOKEN: "tok_zzzzzzzzzzzzzzzz",
    NEXT_PUBLIC_BASE_URL: "https://blackouttrades.com",
  };
  const out = redactSecrets(
    `auth failed for ${env.CLERK_SECRET_KEY} and ${env.SOME_API_TOKEN} at https://blackouttrades.com`,
    env
  );
  assert.ok(!out.includes(env.CLERK_SECRET_KEY));
  assert.ok(!out.includes(env.SOME_API_TOKEN));
  // A non-secret env value must survive — over-redaction destroys the diagnostic.
  assert.match(out, /https:\/\/blackouttrades\.com/);
});

test("redactSecrets catches secret SHAPES never present in env", () => {
  const cases = [
    ["Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc", /Bearer \[REDACTED\]/],
    [`key ${["sk","test","9f8e7d6c5b4a3210zzzz"].join("_")} here`, /sk_test_\[REDACTED\]/],
    ["--data-urlencode ticket=abcd1234efgh5678", /ticket=\[REDACTED\]/],
    [`user ${"AKIA" + "IOSFODNN7EXAMPLE"} done`, /\[REDACTED\]/],
  ];
  for (const [input, expected] of cases) {
    assert.match(redactSecrets(input, {}), expected, `not redacted: ${input}`);
  }
});

test("redactSecrets does not blanket-replace short env values", () => {
  // A secret-named var set to something tiny must not turn every "1" in the text into [REDACTED].
  const out = redactSecrets("curl: (7) connection refused after 1 ms", { SOME_TOKEN: "1" });
  assert.match(out, /after 1 ms/);
  assert.ok(!out.includes(REDACTED));
});

test("redactSecrets is total — null/undefined/objects do not throw", () => {
  assert.equal(redactSecrets(null, {}), "");
  assert.equal(redactSecrets(undefined, {}), "");
  assert.equal(typeof redactSecrets({ a: 1 }, {}), "string");
});

// ── Repo-wide guard ──────────────────────────────────────────────────────────────────
// The per-call fix is only durable if the PATTERN cannot come back. Every curl-based
// harness in this repo was written by copying the one before it, which is how a single
// leaky catch block reached 16 files. This test makes the 17th copy fail CI.

test("no harness captures a subprocess error by taking the FIRST line", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  async function walk(dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(full)));
      // redact.mjs itself both documents the bad pattern and implements the safe fallback.
      else if (/\.(mjs|cjs|mts)$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== "redact.mjs") out.push(full);
    }
    return out;
  }

  const root = new URL("../../", import.meta.url).pathname; // repo/scripts
  const offenders = [];
  for (const file of await walk(root)) {
    const src = await readFile(file, "utf8");
    src.split("\n").forEach((line, i) => {
      // `String(e.message || e).split("\n")[0]` is Node's `Command failed: <argv>` line,
      // and every curl harness puts `Authorization: Bearer $CLERK_SECRET_KEY` in that argv.
      if (/String\(\s*e(?:rr)?\??\.message\s*\|\|\s*e(?:rr)?\s*\)\s*\.split\((["'])\\n\1\)\[0\]/.test(line)) {
        if (!/redactSecrets\(/.test(line)) offenders.push(`${file.replace(root, "scripts/")}:${i + 1}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "These take the first line of a subprocess error, which is Node's `Command failed: <argv>` — " +
      "for a curl harness that argv contains the Clerk secret key and the sign-in ticket. " +
      "Use subprocessErrorMessage(e) from scripts/audit/lib/redact.mjs instead."
  );
});
