import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression coverage for `persist: persist || true` (docs/audit/FINDINGS.md) — that
// expression is unconditionally `true` regardless of the `?persist=1` query param, so
// every admin historical-rebuild call silently overwrote a past published edition
// instead of defaulting to a dry-run probe (edition-builder.ts's own documented
// contract: "Historical asOfEt defaults to dry-run unless persist=true"). Mocking the
// deep dependency (buildEveningEdition) to capture its call args, per the pattern in
// src/app/api/cron/spx-issues-sync/route.test.ts.

let adminAllowed = true;
let buildCalls: Array<Record<string, unknown>> = [];

mock.module("../../../../../lib/admin-access", {
  namedExports: {
    requireAdminApi: async () => (adminAllowed ? null : new Response("denied", { status: 403 })),
  },
});
mock.module("../../../../../lib/admin-route-errors", {
  namedExports: {
    recordAdminRouteError: () => {},
  },
});
mock.module("../../../../../features/nighthawk/lib/edition-builder", {
  namedExports: {
    buildEveningEdition: async (opts: Record<string, unknown>) => {
      buildCalls.push(opts);
      return { ok: true, job_status: "published" };
    },
    serializeBuildError: (e: unknown) => String(e),
  },
});

function req(url: string): NextRequest {
  return new NextRequest(new URL(url, "https://blackouttrades.com"));
}

test("no ?persist param on a historical rebuild → dry-run (persist: false), never silently overwrites", async () => {
  buildCalls = [];
  const { POST } = await import("./route");
  await POST(req("https://x/api/admin/nighthawk/run?asOfEt=2026-05-01"));
  assert.equal(buildCalls.length, 1);
  assert.equal(buildCalls[0]!.asOfEt, "2026-05-01");
  assert.equal(buildCalls[0]!.persist, false, "persist must reflect the query param, not be hardcoded true");
});

test("?persist=1 on a historical rebuild → persist: true (the real opt-in)", async () => {
  buildCalls = [];
  const { POST } = await import("./route");
  await POST(req("https://x/api/admin/nighthawk/run?asOfEt=2026-05-01&persist=1"));
  assert.equal(buildCalls[0]!.persist, true);
});

test("no asOfEt → persist/asOfEt omitted entirely (today's normal run, force only)", async () => {
  buildCalls = [];
  const { POST } = await import("./route");
  await POST(req("https://x/api/admin/nighthawk/run"));
  assert.equal(buildCalls[0]!.force, true);
  assert.equal("asOfEt" in buildCalls[0]!, false);
  assert.equal("persist" in buildCalls[0]!, false);
});
