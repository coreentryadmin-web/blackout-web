// Regression guard for once-daily / dual-band crons that must declare schedule_cron_utc in
// cron-registry.ts so admin-cron-health suppresses off-window stale noise (ops #1331, #1550, #1983).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = readFileSync(join(ROOT, "src/lib/cron-registry.ts"), "utf8");

/**
 * Every registry entry that DECLARES `schedule_cron_utc` must match its `railway.<key>.toml`.
 *
 * Derived from the registry rather than hand-listed. The previous version kept two literal arrays
 * — one of scheduled keys, one of deliberately-unscheduled ones — and both went stale the moment
 * `zerodte-grade` and `largo-morning-brief` were genuinely scheduled (dual-band, as the original
 * removal comment recommended). A list a human must remember to update is the same defect this
 * file exists to catch, one level up, so there is no longer a list.
 *
 * History worth keeping: both keys once mirrored a toml while blackout-infra had never generated
 * the job, so the registry advertised a cadence nothing fired and `admin-cron-health` suppressed
 * the staleness alert that would have revealed it. Neither this test nor any other in this repo
 * can see blackout-infra, so "the job really exists" is not checkable here — what IS checkable is
 * that the two schedules we do control never silently disagree.
 */
function registryEntries(src) {
  const out = new Map();
  const re = /key: "([a-z0-9-]+)"/g;
  const starts = [...src.matchAll(re)];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index;
    const to = i + 1 < starts.length ? starts[i + 1].index : src.length;
    out.set(starts[i][1], src.slice(from, to));
  }
  return out;
}

const entries = registryEntries(registry);
const declaring = [];
for (const [key, entry] of entries) {
  const tomlPath = join(ROOT, `railway.${key}.toml`);
  if (!existsSync(tomlPath)) continue;
  const m = entry.match(/schedule_cron_utc:\s*"([^"]+)"/);
  if (m) declaring.push({ key, declared: m[1], tomlPath });
}

test("the scan actually found scheduled crons (a vacuous pass is not a pass)", () => {
  // Without this, a change to the registry's shape would make every assertion below disappear and
  // the file would report green while checking nothing.
  assert.ok(
    declaring.length >= 5,
    `expected at least 5 registry entries declaring schedule_cron_utc, found ${declaring.length} — ` +
      `the parser has probably drifted from cron-registry.ts's shape`,
  );
});

for (const { key, declared, tomlPath } of declaring) {
  test(`scheduled cron "${key}" schedule_cron_utc matches railway.${key}.toml`, () => {
    const toml = readFileSync(tomlPath, "utf8");
    const match = toml.match(/cronSchedule = "([^"]+)"/);
    assert.ok(match, `railway.${key}.toml must declare cronSchedule`);
    assert.equal(
      declared,
      match[1],
      `cron-registry.ts key "${key}" declares schedule_cron_utc "${declared}" but ` +
        `railway.${key}.toml says "${match[1]}" — admin-cron-health suppresses staleness against ` +
        `the registry value, so a disagreement silences alerts for a window the job does not run in.`,
    );
  });
}
