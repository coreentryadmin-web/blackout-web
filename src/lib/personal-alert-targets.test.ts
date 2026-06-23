import { test } from "node:test";
import assert from "node:assert/strict";
import {
  personalAlertsEnabled,
  resolvePersonalAlertTargets,
} from "./personal-alert-targets";

test("flag off => disabled", () => {
  assert.equal(personalAlertsEnabled(undefined), false);
  assert.equal(personalAlertsEnabled("0"), false);
  assert.equal(personalAlertsEnabled(""), false);
});

test("flag on accepts 1/true", () => {
  assert.equal(personalAlertsEnabled("1"), true);
  assert.equal(personalAlertsEnabled("true"), true);
  assert.equal(personalAlertsEnabled("TRUE"), true);
});

test("disabled resolver returns []", () => {
  const out = resolvePersonalAlertTargets(
    [{ userId: "u1", url: "https://discord.com/api/webhooks/1/a" }],
    { enabled: false, maxRecipients: 10 }
  );
  assert.deepEqual(out, []);
});

test("dedups by url and drops blanks", () => {
  const out = resolvePersonalAlertTargets(
    [
      { userId: "u1", url: "https://discord.com/api/webhooks/1/a" },
      { userId: "u2", url: "https://discord.com/api/webhooks/1/a" },
      { userId: "u3", url: "  " },
    ],
    { enabled: true, maxRecipients: 10 }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].userId, "u1");
});

test("caps to maxRecipients", () => {
  const cands = Array.from({ length: 5 }, (_, i) => ({
    userId: `u${i}`,
    url: `https://discord.com/api/webhooks/${i}/t`,
  }));
  const out = resolvePersonalAlertTargets(cands, { enabled: true, maxRecipients: 2 });
  assert.equal(out.length, 2);
});
