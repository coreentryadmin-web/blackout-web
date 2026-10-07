import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("legacy-live-sync gates on isEtCashRth before Polygon option-snapshot fetches", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const workAt = routeSrc.indexOf("runLegacyLiveSync(");
  assert.ok(authAt >= 0 && gateAt >= 0 && workAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < workAt, "RTH gate must run before live-sync work starts");
});

test("legacy-live-sync logs non-empty transitions before cron_job_runs handshake (CloudWatch auditability)", () => {
  // Found 2026-10-07, live audit: a real TAKE_PARTIAL/EXIT_RUNNER/STOP_OUT firing at a live
  // trigger (e.g. a position crossing its 2x scale-out) was previously unverifiable from
  // CloudWatch — the route logged nothing on success, and result.transitions only ever reached
  // cron_job_runs.meta_json, which no API exposes. Assert the log line exists, is gated on a
  // non-empty transitions array (never fires on an ordinary HOLD-only tick), and runs before the
  // logCronRun handshake so it isn't accidentally dropped on an early return.
  const logAt = routeSrc.indexOf("result.transitions.length > 0");
  const runAt = routeSrc.indexOf("runLegacyLiveSync(");
  const handshakeAt = routeSrc.indexOf("logCronRun(CRON_KEY, started, { ...result");
  assert.ok(logAt >= 0, "must gate a log line on non-empty transitions");
  assert.ok(runAt >= 0 && handshakeAt >= 0);
  assert.ok(logAt > runAt, "transitions must be read after runLegacyLiveSync resolves");
  assert.ok(logAt < handshakeAt, "transitions log must run before the cron_job_runs handshake");
  assert.match(
    routeSrc,
    /console\.info\(`\[cron\/legacy-live-sync\] \$\{result\.transitions\.length\} transition\(s\): \$\{JSON\.stringify\(result\.transitions\)\}`\)/,
    "log line must include the transitions themselves, not just a count"
  );
});
