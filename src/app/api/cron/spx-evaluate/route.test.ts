import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("spx-evaluate: ServerCacheTimeoutError logs skipped ok (not failed)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/cron/spx-evaluate/route.ts"), "utf8");
  assert.match(src, /instanceof ServerCacheTimeoutError/);
  assert.match(src, /desk_cache_timeout/);
  assert.match(src, /skipped:\s*true/);
});
