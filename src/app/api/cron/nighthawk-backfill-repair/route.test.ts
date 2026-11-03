import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);
const jobSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "features", "nighthawk", "lib", "nighthawk-backfill-repair-job.ts"),
  "utf8"
);
const morningConfirmSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "nighthawk-morning-confirm", "route.ts"),
  "utf8"
);

test("nighthawk-backfill-repair gates auth before delegating to the shared job", () => {
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const jobAt = routeSrc.indexOf("await runNighthawkBackfillRepairJob");
  assert.ok(authAt >= 0 && jobAt > authAt);
});

test("shared job gates trading-day -> window -> session-match before calling the repair", () => {
  const tradingDayAt = jobSrc.indexOf("isTradingDayEt(today)");
  const windowAt = jobSrc.indexOf("inNighthawkBackfillRepairWindow(force)");
  const sessionMatchAt = jobSrc.indexOf("editionFor !== today");
  const repairAt = jobSrc.indexOf("republishBackfilledEdition(editionFor)");
  assert.ok(tradingDayAt >= 0 && windowAt >= 0 && sessionMatchAt >= 0 && repairAt >= 0);
  assert.ok(windowAt > tradingDayAt);
  assert.ok(sessionMatchAt > windowAt);
  assert.ok(repairAt > sessionMatchAt);
});

test("force=1 bypasses the trading-day gate, the window gate, and the session-match guard", () => {
  assert.match(jobSrc, /!force && !isTradingDayEt\(today\)/);
  assert.match(jobSrc, /inNighthawkBackfillRepairWindow\(force\)/);
  assert.match(
    jobSrc,
    /export function inNighthawkBackfillRepairWindow\(force: boolean\): boolean \{\s*if \(force\) return true;/
  );
  assert.match(jobSrc, /!force && editionFor !== today/);
});

test("reuses the already-shipped repairStaleBackfillContracts via republishBackfilledEdition, never reimplements the repair", () => {
  assert.match(jobSrc, /republishBackfilledEdition\(editionFor\)/);
  assert.doesNotMatch(jobSrc, /selection_tier\s*===?\s*["']BACKFILL["']/);
  assert.doesNotMatch(jobSrc, /parseOptionsContract/);
});

test("alerts ops on Discord only when something was actually repaired or dropped, never on a clean no-op", () => {
  const resultAt = jobSrc.indexOf("const result = await republishBackfilledEdition(editionFor);");
  const guardAt = jobSrc.indexOf("if (repairedTickers.length > 0 || droppedTickers.length > 0)");
  const discordAt = jobSrc.indexOf("notifyOpsDiscord({", guardAt);
  assert.ok(resultAt >= 0 && discordAt >= 0 && guardAt >= 0);
  assert.ok(guardAt > resultAt);
  assert.ok(discordAt > guardAt);
});

test("morning rescue: a no_rank_governor_snapshot result dispatches a full force-rebuild instead of a dead-end skip", () => {
  const resultAt = jobSrc.indexOf("const result = await republishBackfilledEdition(editionFor);");
  const notOkAt = jobSrc.indexOf("if (!result.ok) {", resultAt);
  const rescueBranchAt = jobSrc.indexOf('if (result.status === "no_rank_governor_snapshot")', notOkAt);
  const dispatchAt = jobSrc.indexOf("buildEveningEdition(", rescueBranchAt);
  const skipAt = jobSrc.indexOf("reason: result.status, edition_for: editionFor", rescueBranchAt);
  assert.ok(rescueBranchAt > notOkAt);
  assert.ok(dispatchAt > rescueBranchAt);
  assert.ok(skipAt > dispatchAt);
  const rescueSlice = jobSrc.slice(rescueBranchAt, skipAt);
  assert.match(rescueSlice, /force:\s*true/);
  assert.match(rescueSlice, /persist:\s*true/);
  assert.match(rescueSlice, /asOfEt:\s*previousTradingDayEt\(editionFor\)/);
  assert.match(rescueSlice, /after\(dispatchRebuild\)/);
  assert.match(rescueSlice, /runWithBackgroundUwSweep\(\(\) =>\s*\n\s*buildEveningEdition\(/);
});

test("nighthawk-morning-confirm delegates the backfill repair job before reading the edition row", () => {
  assert.match(morningConfirmSrc, /runNighthawkBackfillRepairJob\(/);
  const delegateAt = morningConfirmSrc.indexOf("runNighthawkBackfillRepairJob");
  const fetchAt = morningConfirmSrc.indexOf("fetchNighthawkEditionByDate(editionDateParam)");
  assert.ok(delegateAt >= 0 && fetchAt > delegateAt);
  assert.match(morningConfirmSrc, /skipWindowGate:\s*true/);
  assert.match(morningConfirmSrc, /delegatedFrom:\s*CRON_KEY/);
});

test("the schedule is 15 minutes BEFORE nighthawk-morning-confirm's own dual-band, so a repair is already persisted before morning-confirm reads the edition row", async () => {
  const { CRON_JOBS } = await import("@/lib/cron-registry");
  const repair = CRON_JOBS.find((j) => j.key === "nighthawk-backfill-repair");
  const morningConfirm = CRON_JOBS.find((j) => j.key === "nighthawk-morning-confirm");
  assert.ok(repair);
  assert.ok(morningConfirm);
  assert.equal(repair!.schedule_cron_utc, "0 13,14 * * 1-5");
  assert.equal(morningConfirm!.schedule_cron_utc, "15 13,14 * * 1-5");
});

test("a repair failure is isolated — the job's own try/catch returns ok:false rather than throwing", () => {
  const tryAt = jobSrc.indexOf("try {");
  const catchAt = jobSrc.indexOf("} catch (err) {");
  assert.ok(tryAt >= 0 && catchAt > tryAt);
  assert.match(jobSrc.slice(catchAt), /ok:\s*false,\s*error:/);
});
