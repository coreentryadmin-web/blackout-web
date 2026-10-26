import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression: indicesOk (the Polygon indices-socket readiness check) was gated
// on uwConfigured() instead of polygonConfigured() — a copy-paste of the uwOk
// guard immediately above it. In any environment where UW is not configured
// but Polygon is, !uwConfigured() short-circuits indicesOk to true regardless
// of the real Polygon indices-socket state, so /api/worker/ready can report
// ok:true (200) while the Polygon indices feed is actually down.
//
// mock.module() resolves bare specifiers relative to this file, not through
// the "@/" tsconfig alias — see src/lib/__tests__/critical-api-routes.test.ts.

let mockUwConfigured = true;
let mockPolygonConfigured = true;
let mockIndicesAuthenticated = false;
let mockIndicesWsState: "CONNECTING" | "OPEN" | "CLOSING" | "CLOSED" | "NOT_CREATED" = "CLOSED";
let mockUwInitialized = true;
let mockUwAuthFailed = false;

mock.module("../../../../lib/process-role", {
  namedExports: { isIngestProcess: () => true },
});
mock.module("../../../../lib/ws/init-data-sockets", {
  namedExports: { ensureDataSockets: () => {} },
});
mock.module("../../../../lib/ws/polygon-socket", {
  namedExports: {
    getIndexStoreStatus: () => ({
      authenticated: mockIndicesAuthenticated,
      wsState: mockIndicesWsState,
    }),
  },
});
mock.module("../../../../lib/ws/uw-socket", {
  namedExports: {
    getUwSocketHealth: () => ({
      initialized: mockUwInitialized,
      auth_failed: mockUwAuthFailed,
    }),
  },
});
mock.module("../../../../lib/providers/config", {
  namedExports: {
    uwConfigured: () => mockUwConfigured,
    polygonConfigured: () => mockPolygonConfigured,
  },
});

describe("/api/worker/ready indices readiness gate", () => {
  let GET: () => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("reports NOT ready when Polygon is configured but its indices socket is down, even if UW is unconfigured", async () => {
    mockUwConfigured = false;
    mockPolygonConfigured = true;
    mockIndicesAuthenticated = false;
    mockIndicesWsState = "CLOSED";

    const res = await GET();
    const json = await res.json();

    assert.equal(res.status, 503);
    assert.equal(json.ok, false);
  });

  test("reports ready when Polygon is not configured at all, regardless of UW config", async () => {
    mockUwConfigured = false;
    mockPolygonConfigured = false;
    mockIndicesAuthenticated = false;
    mockIndicesWsState = "CLOSED";

    const res = await GET();
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
  });

  test("reports ready when Polygon indices socket is authenticated", async () => {
    mockUwConfigured = true;
    mockPolygonConfigured = true;
    mockIndicesAuthenticated = true;
    mockIndicesWsState = "OPEN";
    mockUwInitialized = true;
    mockUwAuthFailed = false;

    const res = await GET();
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
  });
});
