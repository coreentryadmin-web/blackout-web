import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Nightly largo-stress (run 40695702887, 2026-10-28) died mid-sweep with an uncaught
 * `TypeError: fetch failed` / ECONNRESET after several Cloudflare 429 SKIPs — not a Largo answer defect.
 */

const RUNNER = join(import.meta.dirname, "..", "scripts", "largo-stress-run.mjs");

test("largo-stress-run askLive catches fetch failures as transport SKIP inputs", () => {
  const src = readFileSync(RUNNER, "utf8");
  assert.match(
    src,
    /catch \(err\)[\s\S]*transportError/,
    "askLive must catch exhausted fetchRetry errors instead of crashing the worker pool"
  );
  assert.match(
    src,
    /transportError && status === 0/,
    "worker scoring must surface the socket error on http-0 transport SKIPs"
  );
});
