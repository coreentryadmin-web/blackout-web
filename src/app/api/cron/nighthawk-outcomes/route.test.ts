import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("nighthawk-outcomes gates on isTradingDayEt before outcome grading", () => {
  assert.match(
    routeSrc,
    /import \{ isTradingDayEt \} from "@\/features\/nighthawk\/lib\/session"/,
    "must import the NYSE holiday-aware trading-day gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isTradingDayEt(sessionDay)");
  const resolveAt = routeSrc.indexOf("resolvePendingNighthawkOutcomes(");
  assert.ok(authAt >= 0 && gateAt >= 0 && resolveAt >= 0);
  assert.ok(gateAt > authAt, "trading-day gate must run after auth");
  assert.ok(resolveAt > gateAt, "outcome resolver must run after trading-day gate");
  assert.match(routeSrc, /!force && !isTradingDayEt\(sessionDay\)/, "force=1 must bypass holiday gate");
});

test("nighthawk-outcomes wires the daily learning digest (Phase 2F part 1) fail-soft, after grading, into both the payload and logCronRun", () => {
  assert.match(
    routeSrc,
    /import \{ buildNighthawkDebriefReport \} from "@\/features\/nighthawk\/lib\/debrief-aggregate"/
  );
  assert.match(
    routeSrc,
    /import \{ buildDailyLearningDigestMessage \} from "@\/features\/nighthawk\/lib\/daily-learning-digest"/
  );
  assert.match(routeSrc, /import \{ notifyOpsDiscord \} from "@\/features\/spx\/lib\/spx-play-notify"/);

  const healthAt = routeSrc.indexOf("nighthawkOutcomesRunHealth(result)");
  const digestAt = routeSrc.indexOf("const dailyLearningDigest = await");
  // "const payload = {" also appears in the two earlier skip-branches (non-trading-day, outside
  // outcome window) — search for the REAL payload declaration starting after the digest pass.
  const payloadAt = routeSrc.indexOf("const payload = {", digestAt);
  assert.ok(healthAt >= 0 && digestAt >= 0 && payloadAt >= 0);
  assert.ok(digestAt > healthAt, "the digest pass must run after grading health is already computed, never gating it");
  assert.ok(payloadAt > digestAt, "the digest result must be computed before it's included in the payload");

  assert.match(
    routeSrc,
    /daily_learning_digest: dailyLearningDigest/,
    "the digest result must be included in the cron's response payload"
  );
  // The whole pass is wrapped in its own try/catch (an IIFE) so a digest-build or Discord-notify
  // failure can never surface as, or be mistaken for, a real grading failure.
  const iifeAt = routeSrc.indexOf("const dailyLearningDigest = await (async () => {");
  assert.ok(iifeAt >= 0, "must be its own fail-soft async block, matching every other pass in this route");
  assert.match(routeSrc.slice(iifeAt), /} catch \(err\) \{\s*return \{ posted: false/);

  assert.match(
    routeSrc,
    /buildNighthawkDebriefReport\(\{ days: 1, nowMs \}\)/,
    "must scope the digest to TODAY's session (days:1), not the admin route's own rolling window"
  );
});
