import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("platform-warm background dispatch is wrapped in runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
  assert.match(routeSrc, /runWithBackgroundUwSweep\(\(\) => runPlatformWarm\(started\)\)/);
});

test("platform-warm gates on shouldRunCacheWarmer before dispatching bootstrap warm", () => {
  assert.match(
    routeSrc,
    /import \{ callerInfoFromRequest, shouldRunCacheWarmer \} from "@\/lib\/cache-warmer-gate"/,
    "must use the shared cache-warmer gate (includes NYSE holiday via isEtExtendedWarmHours)"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf('shouldRunCacheWarmer(force');
  const dispatchAt = routeSrc.indexOf("after(dispatchWarm)");
  assert.ok(authAt >= 0 && gateAt >= 0 && dispatchAt >= 0);
  assert.ok(gateAt > authAt, "hours gate must run after auth");
  assert.ok(dispatchAt > gateAt, "bootstrap warm must run after hours gate");
  assert.match(routeSrc, /req\.nextUrl\.searchParams\.get\("force"\) === "1"/, "force=1 must bypass hours gate");
});
