import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("gha-rth-audit retries Postgres and socket-health like rth-open-check", () => {
  const src = readFileSync(join(import.meta.dirname, "gha-rth-audit.mjs"), "utf8");
  assert.match(src, /isTransientAuditPgError/);
  assert.match(src, /probeOptionsSocketWithRetries/);
  assert.match(src, /PG_RTH_MAX_ATTEMPTS/);
});
