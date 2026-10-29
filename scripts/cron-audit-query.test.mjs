import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("cron-audit-query watchdog fallback uses fetchRetry", () => {
  const src = readFileSync(join(import.meta.dirname, "cron-audit-query.mjs"), "utf8");
  assert.match(src, /fetchRetry\([\s\S]*cron-staleness-watchdog/, "watchdog HTTP path must retry transient 5xx/520");
});
