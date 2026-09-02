import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * helix-alert-notify.ts touches Postgres (dbQuery), Redis (sharedCacheSetNx), and web-push
 * (sendWebPush) — none reachable from a bare `tsx --test` run in this sandbox. Source-text
 * inspection is the established idiom for this class of code (see src/lib/db.test.ts), asserting
 * the specific safety properties that matter rather than re-testing pure logic already covered by
 * helix-alert-rules-core.test.ts (matchesHelixAlertRule, sanitizeIncomingHelixAlertRule).
 */

const SRC = readFileSync(join(__dirname, "helix-alert-notify.ts"), "utf8");

test("notifyHelixAlertSubscribers checks the activation flag + VAPID BEFORE any DB query", () => {
  const activatedCheckIdx = SRC.indexOf("if (!activated() || !dbConfigured()) return;");
  const firstDbQueryIdx = SRC.indexOf("dbQuery<");
  assert.ok(activatedCheckIdx >= 0, "activation gate must exist");
  assert.ok(firstDbQueryIdx >= 0, "a dbQuery call must exist");
  assert.ok(
    activatedCheckIdx < firstDbQueryIdx,
    "the inert gate must run before the DB is ever touched — this function runs on every persisted print, all day, cluster-wide"
  );
});

test("activated() requires BOTH the HELIX_ALERTS_PUSH flag and vapidConfigured()", () => {
  const fn = SRC.slice(SRC.indexOf("function activated()"), SRC.indexOf("function activated()") + 300);
  assert.match(fn, /HELIX_ALERTS_PUSH/);
  assert.match(fn, /vapidConfigured\(\)/);
  assert.match(fn, /&&/, "both conditions must be ANDed, not either alone");
});

test("the whole body is wrapped in try/catch — a rule-evaluation failure must never affect the print's own persist/publish path", () => {
  assert.match(SRC, /try\s*\{[\s\S]*ensureHelixAlertRulesTable[\s\S]*\}\s*catch/);
});

test("the cooldown claim is a hard skip on a Redis error (fail CLOSED), not a fallback-send", () => {
  const catchIdx = SRC.indexOf("let claimed = false;");
  const snippet = SRC.slice(catchIdx, catchIdx + 300);
  assert.match(snippet, /catch\s*\{\s*continue;\s*\}/, "a thrown sharedCacheSetNx must `continue` (skip this rule), never fall through to sendWebPush");
});

test("sendWebPush is scoped to the matching rule's user_id — never a broadcast for a per-member alert", () => {
  assert.match(SRC, /sendWebPush\(\s*\{[\s\S]*?\},\s*\{\s*userId:\s*row\.user_id\s*\}\s*\)/);
});

test("the query only ever reads enabled=true rules — a disabled rule is filtered at the SQL layer, not just in matchesHelixAlertRule", () => {
  assert.match(SRC, /WHERE ticker = \$1 AND enabled = true/);
});
