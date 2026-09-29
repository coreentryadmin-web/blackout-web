import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("banger-live-sync gates on isEtCashRth before Polygon option-snapshot fetches", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const workAt = routeSrc.indexOf("runBangerLiveSync(");
  assert.ok(authAt >= 0 && gateAt >= 0 && workAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < workAt, "RTH gate must run before live-sync work starts");
});

test("the prospective quote-tick log persist is fire-and-forget -- never awaited, always .catch()'d, so a write failure cannot affect the real exit-decision path", () => {
  const persistAt = routeSrc.indexOf("persistBangerQuoteTick(");
  assert.ok(persistAt >= 0, "must call persistBangerQuoteTick from the fetchMarks callback");
  const callSite = routeSrc.slice(Math.max(0, persistAt - 40), persistAt + 400);
  assert.match(callSite, /void persistBangerQuoteTick/, "must be fired with `void`, never `await`ed");
  assert.match(callSite, /\.catch\(/, "must attach its own .catch() -- a rejected persist must never surface as an unhandled rejection");
});
