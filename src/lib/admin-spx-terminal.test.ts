import assert from "node:assert/strict";
import test from "node:test";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { AdminIncidentRow } from "@/lib/admin-incidents";
import type { SpxAdminIssuesPayload } from "@/lib/admin-spx-issues";
import { buildSpxTerminalFeed } from "./admin-spx-terminal";

const NOW = Date.parse("2026-09-04T16:00:00.000Z");

function baseIssues(): SpxAdminIssuesPayload {
  return {
    generated_at: new Date(NOW).toISOString(),
    counts: { critical: 0, warning: 0, info: 0, total: 0 },
    health_ok: true,
    issues: [],
    api_errors: [],
  };
}

function baseDesk(): SpxDeskPayload {
  return {
    available: true,
    price: 7700,
    market_open: false,
    gamma_regime: "unknown",
  } as SpxDeskPayload;
}

function incident(overrides: Partial<AdminIncidentRow> = {}): AdminIncidentRow {
  return {
    id: "inc-1",
    fingerprint: "fp-1",
    severity: "warning",
    category: "test",
    title: "Test incident",
    detail: "detail",
    status: "open",
    opened_at: new Date(NOW - 120_000).toISOString(),
    acked_at: null,
    resolved_at: null,
    acked_by: null,
    mtta_ms: null,
    ...overrides,
  };
}

test("buildSpxTerminalFeed: future-skewed incident opened_at reads as clock skew", () => {
  const futureOpened = new Date(NOW + 60_000).toISOString();
  const feed = buildSpxTerminalFeed({
    issues: baseIssues(),
    desk: baseDesk(),
    play: null,
    liveEngine: false,
    openIncidents: [incident({ opened_at: futureOpened })],
    now: NOW,
  });

  const row = feed.lines.find((l) => l.id === "incident:inc-1");
  assert.ok(row);
  assert.match(row.meta ?? "", /open clock skew/);
});

test("buildSpxTerminalFeed: past incident opened_at shows clamped open duration", () => {
  const feed = buildSpxTerminalFeed({
    issues: baseIssues(),
    desk: baseDesk(),
    play: null,
    liveEngine: false,
    openIncidents: [incident()],
    now: NOW,
  });

  const row = feed.lines.find((l) => l.id === "incident:inc-1");
  assert.ok(row);
  assert.match(row.meta ?? "", /open 120s/);
});
