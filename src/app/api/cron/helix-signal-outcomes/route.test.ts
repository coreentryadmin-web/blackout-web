import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// isEtCashRth (hard 16:00 ET cutoff), NOT isEtExtendedWarmHours, would break the 1h checkpoint for
// a firing near the close — gradeHelixSignalOutcomes needs to run past 16:00 ET to grade it
// promptly (deployed schedule is 9:00-17:00 ET under EDT specifically for this margin). See PR
// #4484 review.
test("helix-signal-outcomes gates on isEtExtendedWarmHours (not isEtCashRth) before advisory lock / grading work", () => {
  assert.match(
    routeSrc,
    /import \{ isEtExtendedWarmHours \} from "@\/lib\/et-market-hours"/,
    "must import the extended-hours gate — isEtCashRth's hard 16:00 cutoff would delay post-close 1h-checkpoint grading to the next session"
  );
  assert.equal(
    /import \{[^}]*\bisEtCashRth\b/.test(routeSrc),
    false,
    "must not import isEtCashRth here — its hard 16:00 cutoff would clip the post-close margin the 1h checkpoint depends on"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtExtendedWarmHours()");
  const lockAt = routeSrc.indexOf("tryAdvisoryLock(HELIX_SIGNAL_OUTCOMES_LOCK)");
  assert.ok(authAt >= 0 && gateAt >= 0 && lockAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < lockAt, "RTH gate must run before advisory lock / DB grading");
});
