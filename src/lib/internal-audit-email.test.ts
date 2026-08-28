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

test("recognizes a bare audit- prefix (no leading segment before it)", () => {
  assert.ok(isInternalAuditEmail("audit-nh-force-1787890603966@blackouttrades.com"));
});

// Live-caught 2026-08-28: these two posted real "New member signed up" alerts to ops Discord,
// neither matching claude-/-audit-/@example.com — the gap this widening closes.
test("recognizes e2e as its own hyphen-delimited segment", () => {
  assert.ok(isInternalAuditEmail("vector-e2e-1787898155137@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("ios-ui-e2e-1787898161119@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("spx-e2e-1787890603966@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("zerodte-e2e-1787890603966@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("e2e-subject-1787890603966@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("e2e-subject-fb-1787890603966@blackouttrades.com"));
});

test("recognizes a Date.now()-style epoch suffix (9+ digits after a hyphen) with no e2e/audit keyword", () => {
  assert.ok(isInternalAuditEmail("rth-sweep-1787890603966@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("jwt-probe-1787890603966@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("nh-deploy-1787890603966@blackouttrades.com"));
  // deep-security-audit.mjs / premium-security-audit.mjs: label-<epoch>[-<base36>]
  assert.ok(isInternalAuditEmail("whop-valid-hmac-fake-event-1787890603966-k3f9x@blackouttrades.com"));
});

test("recognizes a crypto.randomBytes(4).toString('hex') suffix (8 lowercase hex chars, no timestamp at all)", () => {
  assert.ok(isInternalAuditEmail("meridian-cap-a3f9c21b@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("cto-free-a3f9c21b@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("cto-prem-a3f9c21b@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("admin-ui-a3f9c21b@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("nav-soak-a3f9c21b@blackouttrades.com"));
  assert.ok(isInternalAuditEmail("desk-ui-a3f9c21b@blackouttrades.com"));
});

test("recognizes @example.com, used by a couple of harnesses that don't hit the real domain", () => {
  assert.ok(isInternalAuditEmail("claude-audit-temp+helix+12345@example.com"));
  assert.ok(isInternalAuditEmail("anything@example.com"));
});

test("is case-insensitive", () => {
  assert.ok(isInternalAuditEmail("Claude-Audit-Temp@BlackoutTrades.com"));
});

// exhaustive-<ts> and endpoint-audit-<ts> (#3029's original explicit-prefix list) are covered by
// the digit-suffix and -audit- checks above without needing their own prefix entries — verified:
test("exhaustive- and endpoint-audit- (from #3029's original prefix list) still resolve, via the broader rules", () => {
  assert.ok(isInternalAuditEmail("exhaustive-1787898161119@blackouttrades.com"), "digit-suffix rule");
  assert.ok(isInternalAuditEmail("endpoint-audit-1787898161119@blackouttrades.com"), "-audit- rule");
  assert.ok(isInternalAuditEmail("claude-e2e-premium-482913@blackouttrades.com"), "claude- rule");
});

test("does not flag a real member's email that merely contains similar substrings", () => {
  assert.ok(!isInternalAuditEmail("claude@gmail.com"), "a real person literally named Claude");
  assert.ok(!isInternalAuditEmail("claude.smith@yahoo.com"), "dot, not the claude- hyphen prefix");
  assert.ok(!isInternalAuditEmail("auditor@gmail.com"), "contains 'audit' but not the -audit- tag");
  assert.ok(!isInternalAuditEmail("jamie.ellis@example.co"), "example.co is not example.com");
  assert.ok(!isInternalAuditEmail("cafe2e5@gmail.com"), "'e2e' appears but not as its own hyphen-bounded segment");
  assert.ok(!isInternalAuditEmail("unclee2e@gmail.com"), "'e2e' as a bare suffix with no hyphen before it");
  assert.ok(
    !isInternalAuditEmail("5551234567@gmail.com"),
    "a 10-digit phone-number-style local part with no hyphen before the digit run"
  );
  assert.ok(
    !isInternalAuditEmail("john.deadbeef@gmail.com"),
    "8 hex-valid characters after a DOT, not a hyphen"
  );
});

test("handles null/undefined/empty without throwing", () => {
  assert.equal(isInternalAuditEmail(null), false);
  assert.equal(isInternalAuditEmail(undefined), false);
  assert.equal(isInternalAuditEmail(""), false);
});
