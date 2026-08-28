import assert from "node:assert/strict";
import { test } from "node:test";
import { isInternalAuditEmail } from "./internal-audit-email.ts";

test("recognizes the claude- prefix convention used by most audit harnesses", () => {
  assert.ok(isInternalAuditEmail("claude-audit-temp+discordnotif229752@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("claude-audit-temp@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("claude-nh-check@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("claude-simfeed-temp@blackouttrades.com"));
});

test("recognizes the -audit- tag used by lanes with their own prefix", () => {
  assert.ok(isInternalAuditEmail("seo-audit-1787890603966@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("largo-spx-audit-1787890603966@blackouttrades.com"));
});

test("recognizes @example.com, used by a couple of harnesses that don't hit the real domain", () => {
  assert.ok(isInternalAuditEmail("claude-audit-temp+helix+12345@example.com"));
  assert.ok(isInternalAuditEmail("anything@example.com"));
});

test("is case-insensitive", () => {
  assert.ok(isInternalAuditEmail("Claude-Audit-Temp@BlackoutTrades.com"));
});

test("recognizes Playwright e2e harness timestamp emails", () => {
  assert.ok(isInternalAuditEmail("vector-e2e-1787898155137@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("ios-ui-e2e-1787898161119@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("spx-e2e-1787898161119@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("claude-e2e-premium-482913@blackouttrades.com"));
});

test("recognizes other harness one-off prefixes", () => {
  assert.ok(isInternalAuditEmail("rth-sweep-1787898161119@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("exhaustive-1787898161119@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("endpoint-audit-1787898161119@blackouttrades.com"));
});

test("does not flag a real member's email that merely contains similar substrings", () => {
  assert.ok(!isInternalAuditEmail("claude@gmail.com"), "a real person literally named Claude");
  assert.ok(!isInternalAuditEmail("claude.smith@yahoo.com"), "dot, not the claude- hyphen prefix");
  assert.ok(!isInternalAuditEmail("auditor@gmail.com"), "contains 'audit' but not the -audit- tag");
  assert.ok(!isInternalAuditEmail("jamie.ellis@example.co"), "example.co is not example.com");
});

test("handles null/undefined/empty without throwing", () => {
  assert.equal(isInternalAuditEmail(null), false);
  assert.equal(isInternalAuditEmail(undefined), false);
  assert.equal(isInternalAuditEmail(""), false);
});
