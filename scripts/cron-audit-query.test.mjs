import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("cron-audit-query watchdog fallback uses fetchRetry for transient edge 5xx", () => {
  const src = readFileSync(new URL("./cron-audit-query.mjs", import.meta.url), "utf8");
  assert.match(src, /fetchRetry\([\s\S]*cron-staleness-watchdog/);
});
