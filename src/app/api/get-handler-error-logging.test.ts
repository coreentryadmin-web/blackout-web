import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

// Regression (2026-10-20, DISCOVERY-lane error-handling sweep): five member-facing GET routes
// had a bare `catch { return ... fail-state }` with zero logging — a real DB outage or query
// error was indistinguishable from "legitimately no data yet" for both the caller and ops,
// since nothing ever reached stdout/an alert. Each route's own POST handler a few lines below
// already does `console.error("[route] POST failed:", err)` on the exact same kind of failure,
// so the asymmetry reads as an oversight on the read path rather than a deliberate fail-open
// decision (no comment states one, unlike this codebase's genuinely-intentional fail-open
// catches elsewhere, which explain themselves). Fixed by adding the matching
// `console.error("[route] GET failed:", err)` to each GET handler's catch block.
const ROUTES = [
  { path: "coaching/alerts", label: "coaching/alerts" },
  { path: "market/regime", label: "market/regime" },
  { path: "market/anomalies", label: "market/anomalies" },
  { path: "track-record/plays", label: "track-record/plays" },
  { path: "brief/premarket", label: "brief/premarket" },
] as const;

describe("GET handlers log on a swallowed DB/query error instead of silently returning a fail-state", () => {
  for (const { path, label } of ROUTES) {
    test(`${label}/route.ts's GET catch block logs the error`, () => {
      const src = readFileSync(new URL(`./${path}/route.ts`, import.meta.url), "utf8");
      // The GET handler's catch block is the FIRST `} catch` in the file (POST's own catch,
      // which already logs, comes later) -- anchor on that to check the right one.
      const firstCatchIdx = src.indexOf("} catch");
      assert.ok(firstCatchIdx > 0, `${label}/route.ts must have a catch block`);
      const catchBlock = src.slice(firstCatchIdx, firstCatchIdx + 200);
      assert.match(
        catchBlock,
        /catch \(err\)/,
        `${label}/route.ts's GET catch block must bind the error, not discard it with a bare "catch {"`
      );
      assert.match(
        catchBlock,
        /console\.error\(\s*["'`]\[.*\]\s*GET failed:["'`],\s*err\)/,
        `${label}/route.ts's GET catch block must log the error, matching its own POST handler's convention`
      );
    });
  }
});
