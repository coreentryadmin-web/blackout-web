import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isEtCashRth } from "@/lib/et-market-hours";
import { isDiscordEodRecapWindow } from "@/lib/discord-eod-recap";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression (2026-11-01 sweep): the top-level RTH gate used to be
// `!force && rthOnly() && !isEtCashRth()` with no EOD-window carve-out — but
// isDiscordEodRecapWindow() only ever returns true OUTSIDE cash RTH (4:04-4:14 PM ET, after the
// 4:00 PM close). Under the default HELIX_DISCORD_DIGEST_RTH_ONLY=unset(true) config, every tick
// landing in that window hit "Outside cash RTH" and returned before the EOD branch (isDiscordEod-
// RecapWindow/buildHelixEodRecapEmbed, built with its own dedicated session-wide fetch — see the
// test below this one) ever ran — the HELIX EOD recap was fully wired but unreachable in
// production. Same root cause fixed in the sibling darkpool-discord route; mirrors
// thermal-discord's route, whose own gate already carries the equivalent `&& !eodDue`.
test("a timestamp inside the EOD-recap window is genuinely outside cash RTH", () => {
  // Wed 2026-09-09, 4:08 PM ET (20:08 UTC under EDT) — a real trading day, well past the 4:00 PM
  // close and inside isDiscordEodRecapWindow's 4:04-4:14 PM band.
  const duringEodWindow = new Date("2026-09-09T20:08:00.000Z");
  assert.equal(isEtCashRth(duringEodWindow), false, "sanity: this timestamp must be outside cash RTH");
  assert.equal(
    isDiscordEodRecapWindow(duringEodWindow),
    true,
    "sanity: this timestamp must be inside the EOD-recap window"
  );
});

test("helix-discord-digest's top-level RTH gate carves out the EOD-recap window", () => {
  assert.match(
    routeSrc,
    /if \(!force && rthOnly\(\) && !isEtCashRth\(now\) && !isDiscordEodRecapWindow\(now\)\)/,
    "the skip-gate must NOT fire during isDiscordEodRecapWindow, or the EOD recap below is dead code"
  );
});

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
