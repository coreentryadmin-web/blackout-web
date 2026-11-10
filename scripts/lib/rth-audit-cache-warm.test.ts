import assert from "node:assert/strict";
import test from "node:test";

import { warmRthAuditCaches } from "./rth-audit-cache-warm.mjs";

test("warmRthAuditCaches dispatches heatmap and desk warm", async () => {
  const urls: string[] = [];
  await warmRthAuditCaches({
    base: "https://example.test",
    cron: "secret",
    waitMs: 0,
    fetchFn: async (url) => {
      urls.push(url);
      return { status: 200, json: async () => ({ ok: true }) };
    },
  });
  assert.ok(urls.some((u) => u.includes("heatmap-warm")));
  assert.ok(urls.some((u) => u.includes("desk-warm")));
});
