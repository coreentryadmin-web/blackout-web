import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Lives in src/ so `scripts/run-tests.mjs` — which walks src/ only — actually runs it. Same
// arrangement as src/meridian-audit-poll-count.test.ts, for the same reason.
import {
  isAuthEchoConsoleError,
  splitConsoleErrors,
} from "../scripts/audit/lib/console-error-triage.mjs";

const AUTH_401 = "Failed to load resource: the server responded with a status of 401 (Unauthorized)";
const AUTH_403 = "Failed to load resource: the server responded with a status of 403 (Forbidden)";

test("the tablet pass that manufactured its own P2 now reports it as HARNESS", () => {
  // Measured on the 2026-08-21 RTH run. The audit recorded 3 auth failures as HARNESS ("session
  // lost mid-run, NOT a product verdict") and then counted the browser's console echo of those
  // same three as a product P2. Three, and three, and the same three.
  const { product, authEcho } = splitConsoleErrors([AUTH_401, AUTH_401, AUTH_401], 3);
  assert.deepEqual(product, [], "a lost session must not also be reported as a product defect");
  assert.equal(authEcho.length, 3);
});

test("a real error alongside an expired session still reports", () => {
  // The whole risk of this change is over-absorbing. A 500 and a thrown exception in the same
  // pass as an expiry are product errors and must survive.
  const real = [
    "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
    "TypeError: Cannot read properties of undefined (reading 'strike')",
  ];
  const { product, authEcho } = splitConsoleErrors([AUTH_401, ...real, AUTH_401], 2);
  assert.deepEqual(product, real, "only the auth echo is absorbed");
  assert.equal(authEcho.length, 2);
});

test("an unexplained 401 stays a product error", () => {
  // "I have a theory about this error" is not "this error is accounted for". With no auth
  // RESPONSE recorded to explain it, a 401 in the console is unexplained and keeps its P2.
  const { product, authEcho } = splitConsoleErrors([AUTH_401], 0);
  assert.deepEqual(product, [AUTH_401]);
  assert.deepEqual(authEcho, []);
});

test("more 401 echoes than auth responses — the surplus stays a product error", () => {
  // The count is the evidence. Absorbing beyond it would let a genuine 401 storm hide behind one
  // expired request.
  const { product, authEcho } = splitConsoleErrors([AUTH_401, AUTH_401, AUTH_401], 1);
  assert.equal(authEcho.length, 1, "only as many as the auth failures explain");
  assert.equal(product.length, 2, "the rest are still reported");
});

test("a bad or missing auth count makes the check STRICTER, never looser", () => {
  // Same direction expectedMaxFetches chose for a bad elapsed time (#2552). Unknown evidence is
  // not evidence, and the failure mode to avoid is silently swallowing real errors.
  for (const bad of [null, undefined, Number.NaN, -1, "3"]) {
    const { product, authEcho } = splitConsoleErrors([AUTH_401], bad as unknown as number);
    assert.deepEqual(product, [AUTH_401], `count ${String(bad)} must not absorb anything`);
    assert.deepEqual(authEcho, [], `count ${String(bad)} must not absorb anything`);
  }
});

test("isAuthEchoConsoleError matches only resource-load failures naming 401/403", () => {
  assert.equal(isAuthEchoConsoleError(AUTH_401), true);
  assert.equal(isAuthEchoConsoleError(AUTH_403), true);
  // A 401 in some other kind of message is not the browser echoing a response.
  assert.equal(isAuthEchoConsoleError("Largo replied: error 401 from upstream"), false);
  // Other statuses are never absorbed.
  for (const s of [400, 404, 429, 500, 502]) {
    assert.equal(
      isAuthEchoConsoleError(`Failed to load resource: the server responded with a status of ${s}`),
      false,
      `${s} must stay a product error`
    );
  }
  for (const junk of [null, undefined, "", 42]) {
    assert.equal(isAuthEchoConsoleError(junk as unknown as string), false);
  }
});

test("no console error is ever silently dropped — every input lands in exactly one bucket", () => {
  // The property that makes this safe to trust: triage PARTITIONS, it does not filter.
  const input = [AUTH_401, "boom", AUTH_403, "TypeError: x", AUTH_401];
  for (const n of [0, 1, 2, 3, 99]) {
    const { product, authEcho } = splitConsoleErrors(input, n);
    assert.equal(
      product.length + authEcho.length,
      input.length,
      `count ${n} lost or duplicated an error`
    );
    assert.deepEqual([...product, ...authEcho].sort(), [...input].sort(), `count ${n} altered the set`);
  }
});

test("the audit routes console errors through the triage rather than counting them raw", () => {
  // A guard on the call site: the helper being correct is worth nothing if the audit still
  // reports `consoleErrors.length`. That raw count IS the defect.
  const src = readFileSync(
    join(process.cwd(), "scripts/audit/meridian-interaction-audit.mjs"),
    "utf8"
  );
  assert.match(src, /splitConsoleErrors\(consoleErrors,\s*authFailureCount\)/, "audit must triage");
  assert.doesNotMatch(
    src,
    /issue:\s*`\$\{consoleErrors\.length\} console errors`/,
    "the raw console-error count must no longer be reported as a product finding"
  );
});

/* ── mount deadlines ─────────────────────────────────────────────────────────────────── */

test("the audit's mount deadlines are named, and long enough for the surface it drives", () => {
  // The second way this audit stopped auditing. Raising the REQUEST timeout fixed transport, and
  // the pass then died one step later at waitForSelector with every request having succeeded:
  //
  //   routed: {"ok":217,"fail":0}   [HARNESS] mobile/timeline — earnings tab bar never appeared
  //
  // Three passes on 2026-08-21 (desktop + tablet ~12:25, mobile 12:48). A bare literal cannot
  // carry why it is what it is, so the next person shortens it back.
  const src = readFileSync(
    join(process.cwd(), "scripts/audit/meridian-interaction-audit.mjs"),
    "utf8"
  );

  const block = /const MOUNT_DEADLINE_MS = \{([\s\S]*?)\};/.exec(src)?.[1];
  assert.ok(block, "mount deadlines must be declared together, not inlined at each call site");

  const val = (k: string) => {
    const m = new RegExp(`${k}:\\s*([\\d_]+)`).exec(block!);
    return m ? Number(m[1].replace(/_/g, "")) : null;
  };
  // The event detail is the one that failed: a row click fans out to the pre-earnings pack, a GEX
  // heatmap fetch, fundamentals, vector EM and dark pool. 30s was under it; the probe that reached
  // the panels every time in the same window used 90s.
  assert.ok((val("detail") ?? 0) >= 60_000, `detail deadline ${val("detail")}ms is below the measured mount time`);
  assert.ok((val("timeline") ?? 0) >= 60_000, `timeline deadline ${val("timeline")}ms is below the measured mount time`);
  assert.ok((val("cohortRow") ?? 0) >= 30_000, `cohortRow deadline ${val("cohortRow")}ms is too short`);

  // ...and every selector wait must READ one of them. A literal left behind is the defect.
  const literals = [...src.matchAll(/waitForSelector\([^)]*timeout:\s*(\d[\d_]*)/g)].map((m) => m[1]);
  assert.deepEqual(
    literals,
    [],
    `waitForSelector still carries bare timeout literal(s): ${literals.join(", ")} — ` +
      "route them through MOUNT_DEADLINE_MS so the measurement travels with the number"
  );
});
