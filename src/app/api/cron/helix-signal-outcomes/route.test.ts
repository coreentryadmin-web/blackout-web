import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("helix-signal-outcomes gates on isEtCashRth before advisory lock / grading work", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const lockAt = routeSrc.indexOf("tryAdvisoryLock(HELIX_SIGNAL_OUTCOMES_LOCK)");
  assert.ok(authAt >= 0 && gateAt >= 0 && lockAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < lockAt, "RTH gate must run before advisory lock / DB grading");
});
