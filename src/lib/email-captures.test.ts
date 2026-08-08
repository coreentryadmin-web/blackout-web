import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidEmail } from "./email-captures.ts";
import { readFileSync } from "node:fs";

test("isValidEmail accepts ordinary addresses", () => {
  assert.equal(isValidEmail("trader@example.com"), true);
  assert.equal(isValidEmail("first.last+tag@sub.example.co.uk"), true);
});

test("isValidEmail rejects missing @ or domain dot", () => {
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("trader@localhost"), false);
  assert.equal(isValidEmail("@example.com"), false);
  assert.equal(isValidEmail("trader@"), false);
});

test("isValidEmail rejects whitespace-containing input and overlong addresses", () => {
  assert.equal(isValidEmail("trader @example.com"), false);
  assert.equal(isValidEmail(`${"a".repeat(250)}@example.com`), false);
});

test("isValidEmail tolerates surrounding whitespace (trims before checking)", () => {
  assert.equal(isValidEmail("  trader@example.com  "), true);
});

test("the public capture route gates the SEND on a per-recipient cooldown", () => {
  // Source-scanned rather than behavioural: the route needs Redis, Postgres and Resend, none
  // constructible here — and the defect is a MISSING guard, which a test of the guarded path
  // cannot observe. What must hold is that the cooldown is consulted BEFORE sendEmail, since the
  // whole point is to not send.
  const src = readFileSync("src/app/api/public/email-capture/route.ts", "utf8");
  const guardIdx = src.indexOf("wasLeadMagnetSentRecently(email)");
  const sendIdx = src.indexOf("await sendEmail(");
  assert.ok(guardIdx > -1, "route must consult the per-recipient cooldown");
  assert.ok(sendIdx > -1, "route still sends when not on cooldown");
  assert.ok(guardIdx < sendIdx, "the cooldown must be checked BEFORE the send, not after");
  assert.match(src, /alreadySent: true/, "a suppressed send is reported honestly to the caller");
});

test("the cooldown is per RECIPIENT, not per caller — the IP limit is not a substitute", () => {
  // The IP rate limit bounds how fast an attacker can ask; it does nothing about how much mail
  // one victim receives. Both bounds must exist.
  const src = readFileSync("src/app/api/public/email-capture/route.ts", "utf8");
  assert.match(src, /checkIpRateLimit\(/, "per-caller bound still present");
  assert.match(src, /wasLeadMagnetSentRecently\(/, "per-recipient bound present");
});

test("cooldown failure is fail-OPEN, and deliberately not gated on isNew", () => {
  // recordEmailCapture returns isNew:false both for a duplicate AND when the DB is down, so
  // gating the send on it would silently stop all sends during a DB blip. The cooldown asks a
  // separate question and answers false when it cannot tell.
  const src = readFileSync("src/lib/email-captures.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function wasLeadMagnetSentRecently"));
  assert.match(fn, /if \(!dbConfigured\(\)\) return false;/, "no DB configured -> do not block sends");
  assert.match(fn, /catch[\s\S]{0,160}return false;/, "a query failure must not block sends");
  assert.ok(!/isNew/.test(fn), "must not be derived from recordEmailCapture's isNew");
});

test("the welcome-sequence cron is registered everywhere the schedule pipeline reads", () => {
  // An unregistered cron is structurally un-alertable: admin-cron-health maps over CRON_JOBS.
  // All three inputs must agree or the EventBridge rule is never provisioned.
  assert.match(readFileSync("scripts/railway-cron-services.mjs", "utf8"), /"welcome-sequence":/);
  assert.match(readFileSync("src/lib/cron-registry.ts", "utf8"), /key: "welcome-sequence"/);
  const toml = readFileSync("railway.welcome-sequence.toml", "utf8");
  assert.match(toml, /hit-cron\.mjs \/api\/cron\/welcome-sequence/, "toml pings the real route");
  assert.match(toml, /cronSchedule\s*=/, "toml carries a schedule");
});
