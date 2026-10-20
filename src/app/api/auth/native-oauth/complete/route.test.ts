import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression: POST /api/auth/native-oauth/complete was the one public, mutating
// route in this codebase with NEITHER a per-IP rate limit NOR a body/field-size
// bound, unlike every other public route (email-capture, telemetry/client-error).
// Without a size bound, an arbitrarily large `idToken` still reaches
// jwtVerify()'s base64-decode + JSON.parse before signature verification can
// reject it; without a rate limit, that work (plus a verified attempt's Clerk
// Backend round-trips) had no per-caller ceiling. mock.module() resolves bare
// specifiers relative to THIS FILE, not through the "@/" tsconfig alias.

let ipRateLimitCalls: Array<{ identity: string; key: string; limit: number; windowSecs: number }> = [];
let rateLimitShouldBlock = false;
let verifyGoogleCalls = 0;
let verifyAppleCalls = 0;
let mintCalls: Array<Record<string, unknown>> = [];

mock.module("../../../../../lib/ip-rate-limit.ts", {
  namedExports: {
    getClientIp: () => "1.2.3.4",
    checkIpRateLimit: async (identity: string, key: string, limit: number, windowSecs: number) => {
      ipRateLimitCalls.push({ identity, key, limit, windowSecs });
      return {
        ok: !rateLimitShouldBlock,
        remaining: rateLimitShouldBlock ? 0 : limit - 1,
        resetAt: Date.now() + windowSecs * 1000,
        limit,
      };
    },
    rateLimitHeaders: () => ({}),
  },
});

mock.module("../../../../../lib/native-oauth/verify-id-token.ts", {
  namedExports: {
    verifyGoogleIdToken: async () => {
      verifyGoogleCalls++;
      return { provider: "google" as const, sub: "sub_1", email: "a@example.com", emailVerified: true, name: "A" };
    },
    verifyAppleIdToken: async () => {
      verifyAppleCalls++;
      return { provider: "apple" as const, sub: "sub_2", email: "", emailVerified: false, name: null };
    },
  },
});

mock.module("../../../../../lib/native-oauth/clerk-bridge.ts", {
  namedExports: {
    mintClerkSessionFromNativeOAuth: async (ident: Record<string, unknown>) => {
      mintCalls.push(ident);
      return { cookieHeader: "__session=jwt; __client_uat=1", userId: "user_1", wasNewUser: false };
    },
  },
});

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const json = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest(new URL("https://x/api/auth/native-oauth/complete"), {
    method: "POST",
    body: json,
    headers: { "content-length": String(Buffer.byteLength(json)), ...headers },
  });
}

function resetMocks() {
  ipRateLimitCalls = [];
  rateLimitShouldBlock = false;
  verifyGoogleCalls = 0;
  verifyAppleCalls = 0;
  mintCalls = [];
}

test("enforces a per-IP rate limit before doing any verification work", async () => {
  resetMocks();
  const { POST } = await import("./route");
  await POST(req({ provider: "google", idToken: "x" }));

  assert.equal(ipRateLimitCalls.length, 1);
  assert.equal(ipRateLimitCalls[0]?.key, "public:native-oauth-complete");
});

test("a blocked rate limit returns 429 and never reaches token verification", async () => {
  resetMocks();
  rateLimitShouldBlock = true;
  const { POST } = await import("./route");
  const res = await POST(req({ provider: "google", idToken: "x" }));

  assert.equal(res.status, 429);
  assert.equal(verifyGoogleCalls, 0, "rate-limited request must never reach jwtVerify()");
});

test("rejects a body over the byte cap via Content-Length before parsing", async () => {
  resetMocks();
  const { POST } = await import("./route");
  const oversized = req({ provider: "google", idToken: "x" }, { "content-length": "999999" });
  const res = await POST(oversized);

  assert.equal(res.status, 413);
  assert.equal(verifyGoogleCalls, 0);
});

test("rejects an oversized idToken field even when the whole body is small", async () => {
  resetMocks();
  const { POST } = await import("./route");
  const res = await POST(req({ provider: "google", idToken: "a".repeat(8_001) }));

  assert.equal(res.status, 400);
  const bodyJson = (await res.json()) as { code: string };
  assert.equal(bodyJson.code, "missing_id_token");
  assert.equal(verifyGoogleCalls, 0, "an over-cap idToken must never reach jwtVerify()");
});

test("rejects an oversized fallbackEmail field", async () => {
  resetMocks();
  const { POST } = await import("./route");
  const res = await POST(
    req({ provider: "apple", idToken: "x", fallbackEmail: "a".repeat(255) + "@example.com" })
  );

  assert.equal(res.status, 400);
  const bodyJson = (await res.json()) as { code: string };
  assert.equal(bodyJson.code, "invalid_fallback_email");
  assert.equal(mintCalls.length, 0);
});

test("a normal, small Google sign-in still succeeds", async () => {
  resetMocks();
  const { POST } = await import("./route");
  const res = await POST(req({ provider: "google", idToken: "x", rawNonce: "n" }));

  assert.equal(res.status, 200);
  assert.equal(verifyGoogleCalls, 1);
  assert.equal(mintCalls.length, 1);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});
