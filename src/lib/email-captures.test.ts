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
  const guardIdx = src.indexOf('checkIpRateLimit(email.toLowerCase()');
  const sendIdx = src.indexOf("await sendEmail(");
  assert.ok(guardIdx > -1, "route must consult a per-RECIPIENT cooldown, keyed by the address");
  assert.ok(sendIdx > -1, "route still sends when not on cooldown");
  assert.ok(guardIdx < sendIdx, "the cooldown must be checked BEFORE the send, not after");
  assert.match(src, /emailSent = result\.ok/, "the response reports whether a send actually happened");
});

test("the cooldown is per RECIPIENT, not per caller — the IP limit is not a substitute", () => {
  // The IP rate limit bounds how fast an attacker can ask; it does nothing about how much mail
  // one victim receives. Both bounds must exist.
  const src = readFileSync("src/app/api/public/email-capture/route.ts", "utf8");
  assert.match(src, /checkIpRateLimit\(/, "per-caller bound still present");
  assert.match(src, /public:email-capture:recipient/, "per-recipient bound present");
});

test("the recipient cooldown is deliberately not gated on isNew", () => {
  // recordEmailCapture returns isNew:false both for a genuine duplicate AND when the DB is down,
  // so gating the send on it would silently stop every send during a DB blip. The cooldown asks a
  // separate question, on Redis, so a Postgres outage cannot mute the lead magnet.
  const src = readFileSync("src/app/api/public/email-capture/route.ts", "utf8");
  // Strip comments first: the docblock deliberately DISCUSSES isNew to explain why it is not used,
  // so a naive scan of the region trips on the prose rather than on the logic.
  const guard = src
    .slice(src.indexOf("PER-RECIPIENT send cooldown"), src.indexOf("let emailSent"))
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/isNew/.test(guard), "the cooldown must not be derived from recordEmailCapture's isNew");
  assert.match(src, /\{ ok: true, isNew, emailSent \}/, "capture is still recorded when the send is suppressed");
});

test("the suppressed path preserves the unsubscribe wiring on the send it does make", () => {
  // The merge that combined two independent fixes for this bug briefly reinstated an older
  // sendEmail() call without headers/topicId, which would have silently dropped List-Unsubscribe
  // and Resend topic suppression. Pin both to the send.
  const src = readFileSync("src/app/api/public/email-capture/route.ts", "utf8");
  assert.equal((src.match(/await sendEmail\(/g) ?? []).length, 1, "exactly one send path");
  assert.match(src, /headers,/, "List-Unsubscribe headers are passed through");
  assert.match(src, /topicId: process\.env\.RESEND_TOPIC_MARKETING_ID/, "topic suppression is passed through");
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

test("isValidEmail's length check applies to the trimmed value, not the raw one", () => {
  // A genuinely-overlong address must still be rejected...
  assert.equal(isValidEmail(`${"a".repeat(250)}@example.com`), false);
  // ...but padding whitespace around a valid, well-under-254 address must not
  // push the raw length past 254 and cause a false rejection — the length rule
  // is about the actual address, not incidental surrounding whitespace.
  const shortAddress = "trader@example.com";
  const padded = " ".repeat(254 - shortAddress.length + 10) + shortAddress;
  assert.ok(padded.length > 254, "sanity: padded input must exceed 254 raw chars");
  assert.equal(isValidEmail(padded), true);
});
