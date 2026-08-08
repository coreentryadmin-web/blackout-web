import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression: POST /api/public/email-capture sent a real email to whatever address
// was submitted on EVERY request, bounded only by a per-IP rate limit (5/60s) — that
// caps the caller's request rate, not the victim's inbox: one IP sustains 7,200
// mails/day at a single address, and rotating IPs scales linearly. An unauthenticated
// email-bomb amplifier, and a fresh sending domain's reputation risk. Fixed by adding
// a per-recipient send cooldown (1/24h, keyed by the normalized email) alongside the
// existing per-IP cap — see the comment in route.ts. mock.module() resolves bare
// specifiers relative to this file, not through the "@/" tsconfig alias — see
// src/lib/__tests__/critical-api-routes.test.ts.

let ipRateLimitCalls: Array<{ identity: string; key: string; limit: number; windowSecs: number }> = [];
let blockedRecipientKeys = new Set<string>();
let recordCalls: Array<{ email: string }> = [];
let markSentCalls: string[] = [];
let sendEmailCalls: Array<{ to: string }> = [];

mock.module("../../../../lib/ip-rate-limit", {
  namedExports: {
    getClientIp: () => "1.2.3.4",
    checkIpRateLimit: async (identity: string, key: string, limit: number, windowSecs: number) => {
      ipRateLimitCalls.push({ identity, key, limit, windowSecs });
      const blocked = blockedRecipientKeys.has(`${identity}:${key}`);
      return { ok: !blocked, remaining: blocked ? 0 : limit - 1, resetAt: Date.now() + windowSecs * 1000, limit };
    },
    rateLimitHeaders: () => ({}),
  },
});

mock.module("../../../../lib/email-captures", {
  namedExports: {
    isValidEmail: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.trim().length <= 254,
    recordEmailCapture: async (input: { email: string }) => {
      recordCalls.push(input);
      return { isNew: true };
    },
    markLeadMagnetSent: async (email: string) => {
      markSentCalls.push(email);
    },
  },
});

mock.module("../../../../lib/email/resend-client", {
  namedExports: {
    sendEmail: async (input: { to: string }) => {
      sendEmailCalls.push(input);
      return { ok: true, id: "test-id" };
    },
  },
});

mock.module("../../../../lib/email/templates/gex-cheat-sheet", {
  namedExports: {
    gexCheatSheetEmail: () => ({ subject: "test subject", html: "<p>test</p>" }),
  },
});

function req(email: string): NextRequest {
  return new NextRequest(new URL("https://x/api/public/email-capture"), {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

function resetMocks() {
  ipRateLimitCalls = [];
  blockedRecipientKeys = new Set();
  recordCalls = [];
  markSentCalls = [];
  sendEmailCalls = [];
}

test("a fresh recipient's first submission sends the email", async () => {
  resetMocks();
  const { POST } = await import("./route");
  const res = await POST(req("new@example.com"));
  const body = (await res.json()) as { ok: boolean; emailSent: boolean };

  assert.equal(sendEmailCalls.length, 1);
  assert.equal(sendEmailCalls[0]?.to, "new@example.com");
  assert.equal(markSentCalls.length, 1);
  assert.equal(body.ok, true);
  assert.equal(body.emailSent, true);
});

test("checkIpRateLimit is called for both the IP cap and a separate per-recipient cap", async () => {
  resetMocks();
  const { POST } = await import("./route");
  await POST(req("someone@example.com"));

  const keys = ipRateLimitCalls.map((c) => c.key);
  assert.ok(keys.includes("public:email-capture"), "must still enforce the per-IP cap");
  assert.ok(keys.includes("public:email-capture:recipient"), "must also enforce a per-recipient cap");

  const recipientCall = ipRateLimitCalls.find((c) => c.key === "public:email-capture:recipient");
  assert.equal(recipientCall?.identity, "someone@example.com");
  assert.equal(recipientCall?.limit, 1, "at most one send per recipient per window — this is the email-bomb guard");
});

test("a second submission for the same recipient within the cooldown window does NOT send — capture still succeeds honestly", async () => {
  resetMocks();
  // Simulate "this recipient already has an outstanding send in the last 24h" —
  // the exact state the real Redis-backed limiter would report on a repeat hit.
  blockedRecipientKeys.add("victim@example.com:public:email-capture:recipient");

  const { POST } = await import("./route");
  const res = await POST(req("victim@example.com"));
  const body = (await res.json()) as { ok: boolean; emailSent: boolean };

  assert.equal(sendEmailCalls.length, 0, "must not send — this is the attacker-repeats-a-victim-address case");
  assert.equal(markSentCalls.length, 0);
  // Capture is still recorded and the response is still ok — only the send is
  // suppressed, matching the "capture succeeds even if the send doesn't" contract.
  assert.equal(recordCalls.length, 1);
  assert.equal(body.ok, true);
  assert.equal(body.emailSent, false, "the caller must be told honestly that no email went out this time");
});

test("recipient key is case-insensitive (same address, different casing, still one send per window)", async () => {
  resetMocks();
  blockedRecipientKeys.add("victim@example.com:public:email-capture:recipient");

  const { POST } = await import("./route");
  const res = await POST(req("Victim@Example.com"));
  const body = (await res.json()) as { emailSent: boolean };

  assert.equal(sendEmailCalls.length, 0);
  assert.equal(body.emailSent, false);
});
