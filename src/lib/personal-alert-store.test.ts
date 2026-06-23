import { test } from "node:test";
import assert from "node:assert/strict";
// Import the PURE validator (not personal-alert-store, which imports @clerk and
// would fail to load under `tsx --test`). See the membership-tiebreak.test.ts
// convention of keeping Clerk-importing modules out of the test graph.
import { isValidDiscordWebhook } from "./personal-alert-validate";

test("accepts a canonical discord webhook url", () => {
  assert.equal(
    isValidDiscordWebhook("https://discord.com/api/webhooks/123456789/abc-DEF_123"),
    true
  );
});

test("accepts discordapp.com host", () => {
  assert.equal(
    isValidDiscordWebhook("https://discordapp.com/api/webhooks/123/tok_en"),
    true
  );
});

test("rejects non-discord host (SSRF guard)", () => {
  assert.equal(
    isValidDiscordWebhook("https://evil.example.com/api/webhooks/1/x"),
    false
  );
});

test("rejects http (non-tls)", () => {
  assert.equal(
    isValidDiscordWebhook("http://discord.com/api/webhooks/1/x"),
    false
  );
});

test("rejects wrong path shape", () => {
  assert.equal(isValidDiscordWebhook("https://discord.com/login"), false);
});

test("rejects garbage", () => {
  assert.equal(isValidDiscordWebhook("not a url"), false);
});
