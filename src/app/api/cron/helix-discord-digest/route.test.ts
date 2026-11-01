import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for #3960 (CLQ-037/044): sharedCacheSetNx now THROWS on a Redis command error
// instead of silently falling back to an in-memory acquire — every caller must decide fail-open
// vs fail-closed explicitly. claimDedup() is a duplicate-post-tolerant cooldown, so it must fail
// OPEN (post anyway) rather than let a transient Redis blip fail the whole digest run.
test("helix-discord-digest claimDedup fails OPEN on a sharedCacheSetNx rejection", () => {
  assert.match(
    routeSrc,
    /const claimed = await sharedCacheSetNx\(key, \{ at: new Date\(\)\.toISOString\(\) \}, ttl\)\.catch\(\s*\(\) => true\s*\)/,
    "claimDedup's sharedCacheSetNx call must have an explicit .catch(() => true) now that Redis errors propagate"
  );
});

// Regression: the EOD recap branch used to build its embed straight from `inputs` — the SAME
// rows fetched above with a fixed `since_hours: 6`, sized for the 15/30-min live digest. By the
// earliest EOD tick (4:04 PM ET), that 6h lookback starts ~10:04 AM, after the 9:30 AM session
// open filterHelixSessionFlows expects to see — silently dropping the first ~34 minutes of the
// session's flow from the "session recap" before the session filter ever runs. The fix fetches a
// dedicated, session-wide window (sized off hoursSinceSessionOpenEt) just for the EOD embed,
// matching the darkpool cron's own EOD branch, which already does a separate full-session fetch
// rather than reusing its live-scan window.
test("helix-discord-digest EOD branch fetches a session-wide window, not the 6h live-digest `inputs`", () => {
  assert.match(
    routeSrc,
    /hoursSinceSessionOpenEt/,
    "route must import/use hoursSinceSessionOpenEt to size a session-wide fetch for the EOD recap"
  );
  const eodBlock = routeSrc.slice(routeSrc.indexOf("isDiscordEodRecapWindow(now)"));
  assert.doesNotMatch(
    eodBlock,
    /flows:\s*inputs\.filter/,
    "EOD embed must not be built directly from the 6h-windowed `inputs` — it silently excludes early-session flow"
  );
  assert.match(
    eodBlock,
    /await fetchRecentFlows\(\{/,
    "EOD branch must issue its own dedicated fetchRecentFlows call sized for the full session"
  );
});
