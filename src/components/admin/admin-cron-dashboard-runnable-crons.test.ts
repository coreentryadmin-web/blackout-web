import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards AdminCronDashboard.tsx's client-side RUNNABLE_CRONS allowlist against drifting from
 * cron-dispatch.ts's CRON_DISPATCH. Found live 2026-10-12: RUNNABLE_CRONS still had the original
 * 3 entries from when the "Run now" button shipped, while CRON_DISPATCH had grown to 19 over many
 * follow-on PRs — 16 backend-supported, self-heal-safe crons never got a "Run now" button in the
 * admin UI.
 *
 * Can't just import CRON_DISPATCH/DISPATCHABLE_CRONS into the component (cron-dispatch.ts pulls
 * in real cron route handlers — next/server, DB-touching provider code — that must never reach
 * a "use client" bundle), so this statically parses both files' source text instead.
 */
function extractQuotedSetEntries(src: string, constName: string): Set<string> {
  const start = src.indexOf(`const ${constName}`);
  assert.ok(start >= 0, `${constName} not found`);
  const end = src.indexOf("]);", start);
  assert.ok(end >= 0, `${constName}'s closing "]);" not found`);
  const body = src.slice(start, end);
  const matches = body.matchAll(/"([a-z0-9-]+)"/g);
  return new Set([...matches].map((m) => m[1]!));
}

function extractObjectKeys(src: string, constName: string): Set<string> {
  const start = src.indexOf(`export const ${constName}`);
  assert.ok(start >= 0, `${constName} not found`);
  const end = src.indexOf("\n};", start);
  assert.ok(end >= 0, `${constName}'s closing "};" not found`);
  const body = src.slice(start, end);
  const matches = body.matchAll(/^\s*"([a-z0-9-]+)":\s*\{/gm);
  return new Set([...matches].map((m) => m[1]!));
}

test("AdminCronDashboard's RUNNABLE_CRONS matches cron-dispatch.ts's CRON_DISPATCH keys exactly", () => {
  const dashboardSrc = readFileSync(
    join(import.meta.dirname, "AdminCronDashboard.tsx"),
    "utf8"
  );
  const dispatchSrc = readFileSync(
    join(import.meta.dirname, "..", "..", "lib", "cron-dispatch.ts"),
    "utf8"
  );

  const runnable = extractQuotedSetEntries(dashboardSrc, "RUNNABLE_CRONS");
  const dispatchable = extractObjectKeys(dispatchSrc, "CRON_DISPATCH");

  assert.ok(dispatchable.size > 3, "sanity: expected CRON_DISPATCH to have grown past its original 3 entries");

  const missingFromDashboard = [...dispatchable].filter((k) => !runnable.has(k));
  const extraInDashboard = [...runnable].filter((k) => !dispatchable.has(k));

  assert.deepEqual(
    missingFromDashboard,
    [],
    `CRON_DISPATCH has crons RUNNABLE_CRONS is missing: ${missingFromDashboard.join(", ")}`
  );
  assert.deepEqual(
    extraInDashboard,
    [],
    `RUNNABLE_CRONS has crons no longer in CRON_DISPATCH: ${extraInDashboard.join(", ")}`
  );
});
