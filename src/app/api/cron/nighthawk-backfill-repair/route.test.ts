import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const passSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "features", "nighthawk", "lib", "backfill-repair-pass.ts"),
  "utf8"
);
const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);
const morningSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "nighthawk-morning-confirm", "route.ts"),
  "utf8"
);

test("nighthawk-backfill-repair gates trading-day -> window -> session-match before calling the repair", () => {
  const runAt = passSrc.indexOf("export async function runNighthawkBackfillRepairPass");
  const body = passSrc.slice(runAt);
  const tradingDayAt = body.indexOf("isTradingDayEt(today)");
  const windowAt = body.indexOf("inNighthawkBackfillRepairWindow(force");
  const sessionMatchAt = body.indexOf("editionFor !== today");
  const repairAt = body.indexOf("republishBackfilledEdition(editionFor)");
  assert.ok(
    tradingDayAt >= 0 && windowAt >= 0 && sessionMatchAt >= 0 && repairAt >= 0,
    "every gate and the repair call itself must be present"
  );
  assert.ok(windowAt > tradingDayAt, "ET window gate must run after the trading-day gate");
  assert.ok(sessionMatchAt > windowAt, "session-match guard must run after the window gate");
  assert.ok(repairAt > sessionMatchAt, "the repair call must only run after every gate has passed");
});

test("force=1 bypasses the trading-day gate, the window gate, and the session-match guard", () => {
  assert.match(passSrc, /!force && !isTradingDayEt\(today\)/, "force=1 must bypass the holiday gate");
  assert.match(passSrc, /inNighthawkBackfillRepairWindow\(force/);
  assert.match(
    passSrc,
    /function inNighthawkBackfillRepairWindow\(force: boolean[\s\S]*?if \(force\) return true;/
  );
  assert.match(passSrc, /!force && editionFor !== today/, "force=1 must bypass the session-match guard");
});

test("reuses the already-shipped repair via republishBackfilledEdition, never reimplements the repair", () => {
  assert.match(
    passSrc,
    /import \{ republishBackfilledEdition \} from "@\/features\/nighthawk\/lib\/post-publish-backfill"/
  );
  assert.doesNotMatch(passSrc, /selection_tier\s*===?\s*["']BACKFILL["']/);
  assert.doesNotMatch(passSrc, /parseOptionsContract/);
});

test("alerts ops on Discord only when something was actually repaired or dropped, never on a clean no-op", () => {
  const resultAt = passSrc.indexOf("const result = await republishBackfilledEdition(editionFor);");
  const guardAt = passSrc.indexOf("if (repairedTickers.length > 0 || droppedTickers.length > 0)");
  const discordAt = passSrc.indexOf("notifyOpsDiscord({", guardAt);
  assert.ok(resultAt >= 0 && discordAt >= 0 && guardAt >= 0);
  assert.ok(guardAt > resultAt, "the repaired/dropped check must run after the repair call");
  assert.ok(discordAt > guardAt, "the Discord alert must be inside the repaired/dropped guard");
});

test("morning rescue: a no_rank_governor_snapshot result dispatches a full force-rebuild instead of a dead-end skip", () => {
  const resultAt = passSrc.indexOf("const result = await republishBackfilledEdition(editionFor);");
  const notOkAt = passSrc.indexOf("if (!result.ok) {", resultAt);
  const rescueBranchAt = passSrc.indexOf('if (result.status === "no_rank_governor_snapshot")', notOkAt);
  const dispatchAt = passSrc.indexOf("buildEveningEdition(", rescueBranchAt);
  const skipAt = passSrc.indexOf("reason: result.status, edition_for: editionFor", rescueBranchAt);

  assert.ok(resultAt >= 0 && notOkAt >= 0, "the repair-failure branch must exist");
  assert.ok(
    rescueBranchAt >= 0 && rescueBranchAt > notOkAt,
    "the no_rank_governor_snapshot check must be inside the !result.ok branch"
  );
  assert.ok(
    dispatchAt >= 0 && dispatchAt > rescueBranchAt,
    "the rescue branch must call buildEveningEdition"
  );
  assert.ok(
    skipAt >= 0 && skipAt > dispatchAt,
    "the generic dead-end skip must come AFTER the rescue branch"
  );

  const rescueSlice = passSrc.slice(rescueBranchAt, skipAt);
  assert.match(rescueSlice, /force:\s*true/, "the rescue rebuild must force a full reset");
  assert.match(rescueSlice, /persist:\s*true/, "the rescue rebuild must persist (not dry-run)");
  assert.match(rescueSlice, /asOfEt:\s*previousTradingDayEt\(editionFor\)/);
  assert.match(rescueSlice, /after\(dispatchRebuild\)/);
  assert.match(rescueSlice, /runWithBackgroundUwSweep\(\(\) =>\s*\n\s*buildEveningEdition\(/);
});

test("dedicated cron route delegates to runNighthawkBackfillRepairPass", () => {
  assert.match(routeSrc, /await runNighthawkBackfillRepairPass\(\{/);
});

test("nighthawk-morning-confirm piggybacks the backfill repair pass before reading the edition", () => {
  const passAt = morningSrc.indexOf("runNighthawkBackfillRepairPass(");
  const fetchAt = morningSrc.indexOf("fetchNighthawkEditionByDate(editionDateParam)", passAt);
  assert.ok(passAt >= 0 && fetchAt > passAt, "backfill repair must run before edition fetch");
  assert.match(morningSrc, /callerVerifiedWindow:\s*true/);
});

test("registry schedule stays on the standalone TOML band (0 13,14) even while morning-confirm piggybacks dispatch", async () => {
  const { CRON_JOBS } = await import("@/lib/cron-registry");
  const repair = CRON_JOBS.find((j) => j.key === "nighthawk-backfill-repair");
  const morningConfirm = CRON_JOBS.find((j) => j.key === "nighthawk-morning-confirm");
  assert.ok(repair, "nighthawk-backfill-repair must be registered");
  assert.ok(morningConfirm, "nighthawk-morning-confirm must be registered");
  assert.equal(repair!.schedule_cron_utc, "0 13,14 * * 1-5");
  assert.equal(morningConfirm!.schedule_cron_utc, "15 13,14 * * 1-5");
});

test("a repair failure is isolated — the pass's own try/catch returns ok:false rather than throwing", () => {
  const tryAt = passSrc.indexOf("try {");
  const catchAt = passSrc.indexOf("} catch (err) {");
  assert.ok(tryAt >= 0 && catchAt >= 0 && catchAt > tryAt);
  assert.match(passSrc.slice(catchAt), /ok:\s*false,\s*error:/);
});
