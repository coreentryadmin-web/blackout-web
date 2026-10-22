import assert from "node:assert/strict";
import test from "node:test";

import type { CronJobHealth } from "@/lib/admin-cron-health";
import { applySwingDiscoveryCronHealth } from "./swing-discovery-cron-health";
import { SWING_SCAN_PHASES } from "./scan-cadence";

function baseHealth(overrides: Partial<CronJobHealth> = {}): CronJobHealth {
  return {
    key: "swing-discovery",
    name: "Night Hawk Swing Discovery",
    kind: "http",
    path: "/api/cron/swing-discovery",
    schedule_label: "phase",
    description: "",
    status: "stale",
    status_label: "stale",
    market_hours_stale: false,
    last_run_at: "2026-10-22T16:00:00.000Z",
    last_status: "skipped",
    last_duration_ms: 1,
    last_message: "no active discovery phase",
    age_min: 12,
    stale_after_min: 2160,
    effective_stale_min: 2160,
    stale_multiplier: 1,
    runs_24h: { ok: 1, failed: 0, skipped: 40 },
    ...overrides,
  };
}

test("between phases: recent skip handshake is healthy, not query-blocking stale", () => {
  const now = new Date("2026-10-22T16:10:00.000Z"); // 12:10 ET — gap before MIDDAY
  const out = applySwingDiscoveryCronHealth(baseHealth(), now, {
    sessionDay: "2026-10-22",
    phaseWindow: null,
    phaseClaim: null,
    servingSnapshot: null,
  });
  assert.equal(out.status, "healthy");
});

test("inside phase: done claim clears stale/failed for cron-audit", () => {
  const midday = SWING_SCAN_PHASES.find((w) => w.phase === "MIDDAY")!;
  const now = new Date("2026-10-22T16:30:00.000Z");
  const out = applySwingDiscoveryCronHealth(
    baseHealth({ status: "failed", last_status: "failed" }),
    now,
    {
      sessionDay: "2026-10-22",
      phaseWindow: midday,
      phaseClaim: { status: "done", at: now.getTime() },
      servingSnapshot: null,
    }
  );
  assert.equal(out.status, "healthy");
});

test("inside phase: claim-released failure is warning (retry), not query fail", () => {
  const midday = SWING_SCAN_PHASES.find((w) => w.phase === "MIDDAY")!;
  const now = new Date("2026-10-22T16:30:00.000Z");
  const out = applySwingDiscoveryCronHealth(
    baseHealth({
      status: "failed",
      last_status: "failed",
      last_message: "serving snapshot persist failed — phase claim released for retry",
      age_min: 8,
    }),
    now,
    {
      sessionDay: "2026-10-22",
      phaseWindow: midday,
      phaseClaim: null,
      servingSnapshot: null,
    }
  );
  assert.equal(out.status, "warning");
});
