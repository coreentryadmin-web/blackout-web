import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("nighthawk-backfill-repair gates auth -> trading-day -> window -> session-match before calling the repair", () => {
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const tradingDayAt = routeSrc.indexOf("isTradingDayEt(today)");
  const windowAt = routeSrc.indexOf("inRepairWindow(force)");
  const sessionMatchAt = routeSrc.indexOf("editionFor !== today");
  const repairAt = routeSrc.indexOf("republishBackfilledEdition(editionFor)");
  assert.ok(
    authAt >= 0 && tradingDayAt >= 0 && windowAt >= 0 && sessionMatchAt >= 0 && repairAt >= 0,
    "every gate and the repair call itself must be present"
  );
  assert.ok(tradingDayAt > authAt, "trading-day gate must run after auth");
  assert.ok(windowAt > tradingDayAt, "ET window gate must run after the trading-day gate");
  assert.ok(sessionMatchAt > windowAt, "session-match guard must run after the window gate");
  assert.ok(repairAt > sessionMatchAt, "the repair call must only run after every gate has passed");
});

test("force=1 bypasses the trading-day gate, the window gate, and the session-match guard", () => {
  assert.match(routeSrc, /!force && !isTradingDayEt\(today\)/, "force=1 must bypass the holiday gate");
  assert.match(routeSrc, /inRepairWindow\(force\)/);
  assert.match(routeSrc, /function inRepairWindow\(force: boolean\): boolean \{\s*if \(force\) return true;/);
  assert.match(routeSrc, /!force && editionFor !== today/, "force=1 must bypass the session-match guard");
});

test("reuses the already-shipped repairStaleBackfillContracts via republishBackfilledEdition, never reimplements the repair", () => {
  assert.match(
    routeSrc,
    /import \{ republishBackfilledEdition \} from "@\/features\/nighthawk\/lib\/post-publish-backfill"/
  );
  // The route must not define its own stale-contract detection or chain-fetch logic — that
  // belongs solely to post-publish-backfill.ts, so there is exactly one place that can drift.
  assert.doesNotMatch(routeSrc, /selection_tier\s*===?\s*["']BACKFILL["']/);
  assert.doesNotMatch(routeSrc, /parseOptionsContract/);
});

test("alerts ops on Discord only when something was actually repaired or dropped, never on a clean no-op", () => {
  const resultAt = routeSrc.indexOf("const result = await republishBackfilledEdition(editionFor);");
  const discordAt = routeSrc.indexOf("notifyOpsDiscord({");
  const guardAt = routeSrc.indexOf("if (repairedTickers.length > 0 || droppedTickers.length > 0)");
  assert.ok(resultAt >= 0 && discordAt >= 0 && guardAt >= 0);
  assert.ok(guardAt > resultAt, "the repaired/dropped check must run after the repair call");
  assert.ok(discordAt > guardAt, "the Discord alert must be inside the repaired/dropped guard");
});

test("the schedule is 15 minutes BEFORE nighthawk-morning-confirm's own dual-band, so a repair is already persisted before morning-confirm reads the edition row", async () => {
  const { CRON_JOBS } = await import("@/lib/cron-registry");
  const repair = CRON_JOBS.find((j) => j.key === "nighthawk-backfill-repair");
  const morningConfirm = CRON_JOBS.find((j) => j.key === "nighthawk-morning-confirm");
  assert.ok(repair, "nighthawk-backfill-repair must be registered");
  assert.ok(morningConfirm, "nighthawk-morning-confirm must be registered");
  assert.equal(repair!.schedule_cron_utc, "0 13,14 * * 1-5");
  assert.equal(morningConfirm!.schedule_cron_utc, "15 13,14 * * 1-5");
  assert.equal(repair!.weekdays_only, true);
  assert.equal(repair!.kind, "http");
  assert.equal(repair!.path, "/api/cron/nighthawk-backfill-repair");
});

test("a repair failure is isolated — the route's own try/catch returns ok:false rather than throwing", () => {
  const tryAt = routeSrc.indexOf("try {");
  const catchAt = routeSrc.indexOf("} catch (err) {");
  assert.ok(tryAt >= 0 && catchAt >= 0 && catchAt > tryAt);
  assert.match(routeSrc.slice(catchAt), /ok:\s*false,\s*error:/);
});
