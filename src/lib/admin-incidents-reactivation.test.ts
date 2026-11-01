import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression coverage for the "reactivated incident keeps a stale acked_at/acked_by from its
// PREVIOUS occurrence" bug: syncAdminIncidents's upsert only reset `status`/`resolved_at` when
// the existing row was 'resolved' — it left `acked_at`/`acked_by`/`opened_at` untouched. A
// fingerprint that was acked, then resolved, then fired again came back with status='open' but a
// non-null acked_at/acked_by, which computeMttaMs's own invariant ("a still-open, never-acked
// incident must report a null MTTA") exists specifically to prevent — but the dashboard's per-row
// MTTA badge and its aggregate "Avg MTTA" KPI both read mtta_ms unconditionally, with no idea the
// row was ever reactivated.
//
// mock.module() resolves bare specifiers relative to THIS file (not the "@/" tsconfig alias) —
// see src/app/api/webhook/resend/route.test.ts for the same pattern. Run with:
//   node --import tsx --experimental-test-module-mocks --test \
//     src/lib/admin-incidents-reactivation.test.ts

type Row = Record<string, unknown>;
let queryLog: Array<{ sql: string; params: unknown[] }> = [];
let priorRows: Row[] = [];
let openRows: Row[] = [];

mock.module("./db", {
  namedExports: {
    dbConfigured: () => true,
    dbQuery: async <T>(sql: string, params: unknown[] = []) => {
      queryLog.push({ sql, params });
      if (sql.includes("CREATE TABLE")) return { rows: [] as T[], rowCount: 0 };
      if (sql.includes("SELECT fingerprint, status, acked_at::text")) {
        return { rows: priorRows as T[], rowCount: priorRows.length };
      }
      if (sql.includes("INSERT INTO admin_incidents")) {
        return { rows: [] as T[], rowCount: (params[0] as unknown[])?.length ?? 0 };
      }
      if (sql.includes("SELECT fingerprint, category FROM admin_incidents")) {
        return { rows: openRows as T[], rowCount: openRows.length };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  },
});

function resetMocks() {
  queryLog = [];
  priorRows = [];
  openRows = [];
}

describe("syncAdminIncidents — reactivation lifecycle", () => {
  let syncAdminIncidents: typeof import("./admin-incidents").syncAdminIncidents;

  before(async () => {
    ({ syncAdminIncidents } = await import("./admin-incidents"));
  });

  test("a brand-new fingerprint starts open with no ack state", async () => {
    resetMocks();
    await syncAdminIncidents([
      { id: "x", severity: "warning", category: "cat", title: "brand new", detail: "d" },
    ]);

    const insertCall = queryLog.find((q) => q.sql.includes("INSERT INTO admin_incidents"));
    assert.ok(insertCall, "must issue the upsert");
    // params layout: fp, sev, cat, ttl, det, st, op, ak, akby, res (10 per row)
    const [, , , , , status, , acked_at, acked_by, resolved_at] = insertCall!.params;
    assert.equal(status, "open");
    assert.equal(acked_at, null);
    assert.equal(acked_by, null);
    assert.equal(resolved_at, null);
  });

  test("a still-open, never-acked fingerprint is left alone (no fabricated ack)", async () => {
    resetMocks();
    priorRows = [
      { fingerprint: "cat:still open", status: "open", acked_at: null, acked_by: null, opened_at: "2026-10-01T00:00:00.000Z" },
    ];
    await syncAdminIncidents([
      { id: "x", severity: "critical", category: "cat", title: "still open", detail: "d2" },
    ]);

    const insertCall = queryLog.find((q) => q.sql.includes("INSERT INTO admin_incidents"));
    const [, , , , , status, opened_at, acked_at, acked_by] = insertCall!.params;
    assert.equal(status, "open");
    assert.equal(acked_at, null);
    assert.equal(acked_by, null);
    assert.equal(opened_at, "2026-10-01T00:00:00.000Z", "opened_at must not be disturbed for a row that was never resolved");
  });

  test("a still-acked fingerprint keeps its real ack — not reset, not re-fabricated", async () => {
    resetMocks();
    priorRows = [
      {
        fingerprint: "cat:still acked",
        status: "acked",
        acked_at: "2026-10-20T10:00:00.000Z",
        acked_by: "ops@blackout",
        opened_at: "2026-10-20T09:00:00.000Z",
      },
    ];
    await syncAdminIncidents([
      { id: "x", severity: "warning", category: "cat", title: "still acked", detail: "d3" },
    ]);

    const insertCall = queryLog.find((q) => q.sql.includes("INSERT INTO admin_incidents"));
    const [, , , , , status, opened_at, acked_at, acked_by] = insertCall!.params;
    assert.equal(status, "acked");
    assert.equal(acked_at, "2026-10-20T10:00:00.000Z");
    assert.equal(acked_by, "ops@blackout");
    assert.equal(opened_at, "2026-10-20T09:00:00.000Z");
  });

  // ── THE BUG ──────────────────────────────────────────────────────────────────────────────────
  test("a RESOLVED fingerprint reactivating restarts its whole lifecycle — no stale acked_at/acked_by/opened_at", async () => {
    resetMocks();
    priorRows = [
      {
        fingerprint: "cat:recurring issue",
        status: "resolved",
        // Stale evidence from the LAST occurrence — an admin acked it days ago, it was then
        // resolved, and now the exact same (category, title) has fired again.
        acked_at: "2026-10-18T12:00:00.000Z",
        acked_by: "ops@blackout",
        opened_at: "2026-10-18T11:30:00.000Z",
      },
    ];
    await syncAdminIncidents([
      { id: "x", severity: "critical", category: "cat", title: "recurring issue", detail: "fired again" },
    ]);

    const insertCall = queryLog.find((q) => q.sql.includes("INSERT INTO admin_incidents"));
    assert.ok(insertCall);
    const [, , , , , status, opened_at, acked_at, acked_by, resolved_at] = insertCall!.params;

    assert.equal(status, "open", "reopens as a fresh, unacked occurrence");
    // THE REGRESSION: pre-fix, acked_at/acked_by carried the stale 2026-10-18 values straight
    // through, so a currently-open, never-(this-time)-acked incident reported a real-looking
    // MTTA — exactly what computeMttaMs's own invariant says must never happen.
    assert.equal(acked_at, null, "must not carry over the previous occurrence's ack timestamp");
    assert.equal(acked_by, null, "must not carry over the previous occurrence's ack actor");
    assert.equal(resolved_at, null);
    assert.notEqual(opened_at, "2026-10-18T11:30:00.000Z", "a reactivated incident is a fresh occurrence, not a continuation of the old one");
  });

  test("multiple issues in one call each get their own correctly-computed lifecycle", async () => {
    resetMocks();
    priorRows = [
      { fingerprint: "cat:a", status: "resolved", acked_at: "2026-10-01T00:00:00.000Z", acked_by: "old@x", opened_at: "2026-09-30T00:00:00.000Z" },
      { fingerprint: "cat:b", status: "open", acked_at: null, acked_by: null, opened_at: "2026-10-25T00:00:00.000Z" },
    ];
    await syncAdminIncidents([
      { id: "1", severity: "critical", category: "cat", title: "a", detail: "d" },
      { id: "2", severity: "warning", category: "cat", title: "b", detail: "d" },
      { id: "3", severity: "critical", category: "cat", title: "c", detail: "d" }, // brand new
    ]);

    const insertCall = queryLog.find((q) => q.sql.includes("INSERT INTO admin_incidents"));
    const params = insertCall!.params;
    // Row 0 (reactivated "a"): acked_at/acked_by reset
    assert.equal(params[7], null, "row a acked_at reset");
    assert.equal(params[8], null, "row a acked_by reset");
    // Row 1 (still-open "b"): untouched
    assert.equal(params[17], null, "row b acked_at stays null");
    assert.equal(params[16], "2026-10-25T00:00:00.000Z", "row b opened_at untouched");
    // Row 2 (brand new "c"): fresh
    assert.equal(params[25], "open", "row c status");
    assert.equal(params[27], null, "row c acked_at");
  });
});
