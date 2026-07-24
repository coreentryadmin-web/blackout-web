import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWING_SCAN_PHASES,
  etMinutesOfDay,
  resolveScanPhase,
  phaseRunKey,
  decideSwingScan,
} from "./scan-cadence.ts";

// July → EDT (UTC-4). A fixed ET wall-clock instant is written with the -04:00 offset so the test is
// independent of the machine's local TZ.
const etInstant = (hhmm: string) => Date.parse(`2026-07-24T${hhmm}:00-04:00`);

test("etMinutesOfDay reads the ET wall clock (DST-aware)", () => {
  assert.equal(etMinutesOfDay(etInstant("17:00")), 17 * 60, "5:00 PM ET → 1020 min");
  assert.equal(etMinutesOfDay(etInstant("06:30")), 6 * 60 + 30);
});

test("resolveScanPhase maps each phase window; POST_CLOSE is first/primary", () => {
  assert.equal(resolveScanPhase(etInstant("17:00"))?.phase, "POST_CLOSE");
  assert.equal(resolveScanPhase(etInstant("07:00"))?.phase, "PRE_OPEN");
  assert.equal(resolveScanPhase(etInstant("12:30"))?.phase, "MIDDAY");
  assert.equal(resolveScanPhase(etInstant("15:30"))?.phase, "POWER_HOUR");
  assert.equal(resolveScanPhase(etInstant("21:00"))?.phase, "OVERNIGHT");
  // A pre-dawn gap → no phase (the cron self-skips).
  assert.equal(resolveScanPhase(etInstant("03:00")), null);
  // POST_CLOSE ships first and is the primary phase.
  assert.equal(SWING_SCAN_PHASES[0].phase, "POST_CLOSE");
  assert.equal(SWING_SCAN_PHASES[0].primary, true);
});

test("phase windows are non-overlapping", () => {
  for (let i = 0; i < SWING_SCAN_PHASES.length; i++) {
    for (let j = i + 1; j < SWING_SCAN_PHASES.length; j++) {
      const a = SWING_SCAN_PHASES[i];
      const b = SWING_SCAN_PHASES[j];
      const overlap = a.startMin < b.endMin && b.startMin < a.endMin;
      assert.equal(overlap, false, `${a.phase} and ${b.phase} overlap`);
    }
  }
});

test("decideSwingScan is IDEMPOTENT per (date, phase): a claimed key skips", () => {
  const nowMs = etInstant("17:00"); // POST_CLOSE
  const sessionDay = "2026-07-24";
  const key = phaseRunKey(sessionDay, "POST_CLOSE");

  // First firing: nothing claimed → run.
  const first = decideSwingScan({ nowMs, sessionDay, ranKeys: new Set() });
  assert.equal(first.run, true);
  assert.equal(first.phase, "POST_CLOSE");
  assert.equal(first.key, key);

  // Second firing inside the same window, same day, key already claimed → skip (no double-write).
  const second = decideSwingScan({ nowMs, sessionDay, ranKeys: new Set([key]) });
  assert.equal(second.run, false);
  assert.match(second.reason, /already ran/);

  // A DIFFERENT session day with the same phase is a fresh run — the key is date-scoped.
  const nextDay = decideSwingScan({ nowMs, sessionDay: "2026-07-25", ranKeys: new Set([key]) });
  assert.equal(nextDay.run, true, "yesterday's claim must not suppress today's phase");
});

test("decideSwingScan skips when no phase is active", () => {
  const d = decideSwingScan({ nowMs: etInstant("03:00"), sessionDay: "2026-07-24", ranKeys: new Set() });
  assert.equal(d.run, false);
  assert.equal(d.phase, null);
  assert.equal(d.key, null);
});
