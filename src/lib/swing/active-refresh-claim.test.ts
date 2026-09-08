import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeRefreshClaimTtlSec,
  isActiveRefreshClaimLive,
  SWING_ACTIVE_REFRESH_CLAIM_KEY,
} from "./active-refresh-claim.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("isActiveRefreshClaimLive treats fresh running claim as live", () => {
  const now = 1_000_000;
  assert.equal(
    isActiveRefreshClaimLive({ status: "running", at: now - 60_000 }, now, 120),
    true,
  );
});

test("isActiveRefreshClaimLive expires claim past maxDuration+buffer", () => {
  const now = 1_000_000;
  assert.equal(
    isActiveRefreshClaimLive({ status: "running", at: now - 200_000 }, now, 10),
    false,
  );
});

test("active-refresh route acquires singleton claim before background work (Q37)", () => {
  const src = readFileSync(
    join(root, "src/app/api/cron/swing-active-refresh/route.ts"),
    "utf8",
  );
  assert.match(src, /SWING_ACTIVE_REFRESH_CLAIM_KEY/);
  assert.match(src, /sharedCacheSetNx\(/);
  assert.match(src, /sharedCacheDel\(/);
});

test("claim TTL covers route maxDuration", () => {
  assert.ok(activeRefreshClaimTtlSec() >= 180);
  assert.equal(SWING_ACTIVE_REFRESH_CLAIM_KEY, "swing:active-refresh:running");
});
