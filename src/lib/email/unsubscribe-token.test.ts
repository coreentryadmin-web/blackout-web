import assert from "node:assert/strict";
import { test } from "node:test";
import { signUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, marketingUnsubscribe } from "./unsubscribe-token.ts";

const ORIGINAL_KEY = process.env.RESEND_API_KEY;

test("signUnsubscribeToken + verifyUnsubscribeToken round-trip", () => {
  process.env.RESEND_API_KEY = "test_key_for_hmac_only";
  try {
    const token = signUnsubscribeToken("Trader@Example.com");
    assert.ok(token && token.length === 32, "expects a 32-char token");
    // Case/whitespace-insensitive — the same address should always sign the same.
    assert.equal(verifyUnsubscribeToken("trader@example.com", token!), true);
    assert.equal(verifyUnsubscribeToken(" Trader@Example.com ", token!), true);
  } finally {
    process.env.RESEND_API_KEY = ORIGINAL_KEY;
  }
});

test("verifyUnsubscribeToken rejects a tampered token or wrong email", () => {
  process.env.RESEND_API_KEY = "test_key_for_hmac_only";
  try {
    const token = signUnsubscribeToken("trader@example.com")!;
    assert.equal(verifyUnsubscribeToken("someoneelse@example.com", token), false, "token must not verify for a different email");
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
    assert.equal(verifyUnsubscribeToken("trader@example.com", tampered), false, "a flipped character must fail verification");
    assert.equal(verifyUnsubscribeToken("trader@example.com", ""), false, "an empty token must fail verification");
  } finally {
    process.env.RESEND_API_KEY = ORIGINAL_KEY;
  }
});

test("fails open (returns null, never throws) when RESEND_API_KEY is unset", () => {
  delete process.env.RESEND_API_KEY;
  try {
    assert.equal(signUnsubscribeToken("trader@example.com"), null);
    assert.equal(unsubscribeUrl("trader@example.com"), null);
    const { url, headers } = marketingUnsubscribe("trader@example.com");
    assert.equal(url, null);
    assert.deepEqual(headers, {});
  } finally {
    process.env.RESEND_API_KEY = ORIGINAL_KEY;
  }
});

test("marketingUnsubscribe returns matching URL + RFC 8058 headers when configured", () => {
  process.env.RESEND_API_KEY = "test_key_for_hmac_only";
  try {
    const { url, headers } = marketingUnsubscribe("trader@example.com");
    assert.ok(url?.includes("/api/public/email-unsubscribe?email="));
    assert.ok(headers["List-Unsubscribe"]?.includes(url!));
    assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  } finally {
    process.env.RESEND_API_KEY = ORIGINAL_KEY;
  }
});
