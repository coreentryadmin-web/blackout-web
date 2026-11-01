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

// Regression for the 2026-09-04 audit sweep: darkpool-discord calls fetchUwDarkPoolRecent
// (UW REST on cache miss) but was not tagged with runWithBackgroundUwSweep.
test("darkpool-discord imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the background-sweep tag from the shared rate limiter"
  );
});

test("darkpool-discord wraps UW REST tick in runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /await runWithBackgroundUwSweep\(\(\) =>\s*runDarkpoolDiscordTick/,
    "dark pool scan/digest/EOD must run inside the background-sweep tag"
  );
  assert.match(
    routeSrc,
    /async function runDarkpoolDiscordTick[\s\S]*await scanDarkpoolDiscordFromCache/,
    "UW REST work must live inside runDarkpoolDiscordTick, not bare in GET"
  );
});

// Regression (2026-11-01 sweep): the top-level RTH gate used to be
// `!force && rthOnly() && !isEtCashRth()` with no EOD-window carve-out — but
// isDiscordEodRecapWindow() only ever returns true OUTSIDE cash RTH (4:04-4:14 PM ET, after the
// 4:00 PM close). Under the default DARKPOOL_DISCORD_RTH_ONLY=unset(true) config, every tick
// landing in that window hit "Outside cash RTH" and returned before runDarkpoolDiscordTick (and
// therefore isDiscordEodRecapWindow/buildDarkpoolEodRecapEmbed) ever ran — the EOD recap was
// fully built, tested and wired below, but unreachable in production. Fixed to mirror
// thermal-discord's route, whose own gate already carries the equivalent `&& !eodDue`.
test("a timestamp inside the EOD-recap window is genuinely outside cash RTH", () => {
  // Wed 2026-09-09, 4:08 PM ET (20:08 UTC under EDT) — a real trading day, well past the 4:00 PM
  // close and inside isDiscordEodRecapWindow's 4:04-4:14 PM band. This is the exact precondition
  // that makes the old gate's `!isEtCashRth()` alone wrongly skip the EOD branch.
  const duringEodWindow = new Date("2026-09-09T20:08:00.000Z");
  assert.equal(isEtCashRth(duringEodWindow), false, "sanity: this timestamp must be outside cash RTH");
  assert.equal(
    isDiscordEodRecapWindow(duringEodWindow),
    true,
    "sanity: this timestamp must be inside the EOD-recap window"
  );
});

test("darkpool-discord's top-level RTH gate carves out the EOD-recap window", () => {
  assert.match(
    routeSrc,
    /if \(!force && rthOnly\(\) && !isEtCashRth\(now\) && !isDiscordEodRecapWindow\(now\)\)/,
    "the skip-gate must NOT fire during isDiscordEodRecapWindow, or the EOD recap below is dead code"
  );
});

// Regression for #3960 (CLQ-037/044): sharedCacheSetNx now THROWS on a Redis command error
// instead of silently falling back to an in-memory acquire — every caller must decide fail-open
// vs fail-closed explicitly. This dedup guard is a duplicate-post-tolerant cooldown, so it must
// fail OPEN (post anyway) rather than let a transient Redis blip fail the whole digest run.
test("darkpool-discord digest dedup fails OPEN on a sharedCacheSetNx rejection", () => {
  assert.match(
    routeSrc,
    /await sharedCacheSetNx\(DEDUP_DIGEST_KEY,[\s\S]{0,120}\)\.catch\(\s*\(\) => true\s*\)/,
    "DEDUP_DIGEST_KEY claim must have an explicit .catch(() => true) now that Redis errors propagate"
  );
});
