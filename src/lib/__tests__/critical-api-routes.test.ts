import { test, mock } from "node:test";
import assert from "node:assert/strict";

const deny401 = new Response(JSON.stringify({ error: "Unauthorized" }), {
  status: 401,
  headers: { "Content-Type": "application/json" },
});

const rlOk = { ok: true as const, remaining: 59, resetAt: Date.now() + 60_000 };

test("GET /api/track-record returns admin denial when requireAdminApi rejects", async () => {
  mock.module("../admin-access", {
    namedExports: {
      requireAdminApi: async () => deny401,
    },
  });
  mock.module("../ip-rate-limit", {
    namedExports: {
      getClientIp: () => "127.0.0.1",
      checkIpRateLimit: async () => rlOk,
      rateLimitHeaders: () => ({}),
    },
  });
  const { GET } = await import("../../app/api/track-record/route");
  const res = await GET(new Request("http://localhost/api/track-record") as import("next/server").NextRequest);
  assert.equal(res.status, 401);
  mock.restoreAll();
});

test("GET /api/public/track-record returns admin denial when requireAdminApi rejects", async () => {
  mock.module("../admin-access", {
    namedExports: {
      requireAdminApi: async () => deny401,
    },
  });
  mock.module("../ip-rate-limit", {
    namedExports: {
      getClientIp: () => "127.0.0.1",
      checkIpRateLimit: async () => rlOk,
      rateLimitHeaders: () => ({}),
    },
  });
  const { GET } = await import("../../app/api/public/track-record/route");
  const res = await GET(new Request("http://localhost/api/public/track-record") as import("next/server").NextRequest);
  assert.equal(res.status, 401);
  mock.restoreAll();
});

test("GET /api/track-record/plays returns admin denial when requireAdminApi rejects", async () => {
  mock.module("../admin-access", {
    namedExports: {
      requireAdminApi: async () => deny401,
    },
  });
  mock.module("../ip-rate-limit", {
    namedExports: {
      getClientIp: () => "127.0.0.1",
      checkIpRateLimit: async () => rlOk,
      rateLimitHeaders: () => ({}),
    },
  });
  const { GET } = await import("../../app/api/track-record/plays/route");
  const res = await GET(new Request("http://localhost/api/track-record/plays") as import("next/server").NextRequest);
  assert.equal(res.status, 401);
  mock.restoreAll();
});
