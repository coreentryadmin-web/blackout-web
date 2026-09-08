import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CRON_JOBS } from "./cron-registry";

/**
 * SWING-SYSTEM-CTO-AUDIT-2026-09-06 findings #4/#18: swing-discovery was documented as "commits nothing"
 * for 44+ days after the live commit seam shipped (2026-07-24). Operators reading cron-registry or the
 * route header would wrongly treat ?force=1 as safe on an inert cron. This test ratchets the operator-facing
 * docs to match the wired commit path (insertPosition + budget in buildDiscoveryDeps).
 */
test("swing-discovery operator docs describe live commits, not a commits-nothing cron", () => {
  const job = CRON_JOBS.find((j) => j.key === "swing-discovery");
  assert.ok(job, "swing-discovery must stay registered for the admin cron-health board");

  const desc = job.description.toLowerCase();
  assert.ok(
    !desc.includes("commits nothing"),
    `cron-registry swing-discovery description still claims commits nothing: ${job.description}`,
  );
  assert.ok(
    desc.includes("live commit"),
    `cron-registry swing-discovery description must disclose live commits: ${job.description}`,
  );

  const routeHeader = readFileSync(
    join(process.cwd(), "src/app/api/cron/swing-discovery/route.ts"),
    "utf8",
  );
  assert.ok(
    !/COMMITS NOTHING/i.test(routeHeader),
    "swing-discovery route header must not claim COMMITS NOTHING",
  );
  assert.ok(
    /live commit/i.test(routeHeader),
    "swing-discovery route header must document the live commit seam",
  );
});
