import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PREMIUM_SSE_ROUTES: Array<{
  path: string;
  toolKey?: string;
}> = [
  { path: "src/app/api/market/zerodte/marks/stream/route.ts", toolKey: "nighthawk" },
  { path: "src/app/api/market/vector/stream/route.ts", toolKey: "vector" },
  { path: "src/app/api/market/flows/stream/route.ts" },
];

test("recheckSseStreamAuth skips cron connections", async () => {
  const { recheckSseStreamAuth } = await import("./sse-stream-auth.js");
  const result = await recheckSseStreamAuth({ via: "cron", minTier: "premium" });
  assert.equal(result, null);
});

test("every premium SSE route re-checks tier inside the tick/send loop", () => {
  for (const { path, toolKey } of PREMIUM_SSE_ROUTES) {
    const src = readFileSync(path, "utf8");
    assert.match(
      src,
      /recheckSseStreamAuth\(/,
      `${path} must call recheckSseStreamAuth in the long-lived stream loop`
    );
    if (toolKey) {
      assert.match(
        src,
        new RegExp(`toolKey:[\\s\\S]*["']${toolKey}["']`),
        `${path} must pass toolKey "${toolKey}" to the recheck helper`
      );
    }
  }
});
