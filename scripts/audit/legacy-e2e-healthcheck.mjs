#!/usr/bin/env node
/*
 * NIGHT HAWK LEGACY END-TO-END HEALTH CHECK — one repeatable run against PRODUCTION
 * (blackouttrades.com) that prints a GREEN/AMBER/RED matrix for Legacy's next-day digest
 * board. Built because the Legacy audit lane had been re-deriving the same three manual
 * checks (edition freshness, mark sanity, record consistency) by hand every ~15-min cycle —
 * this mechanizes exactly that, mirroring the shape of zerodte-e2e-healthcheck.mjs and
 * swing's own tooling for the sibling Night Hawk lanes.
 *
 * STAGES:
 *   A  EDITION   — GET /api/market/nighthawk/edition: reachable, not stale, not degraded,
 *                  carries plays (or an honest no_plays state).
 *   B  MARKS     — GET /api/market/nighthawk/legacy-marks for every OCC resolvable from
 *                  today's edition plays (via the same resolveLegacyPlayOcc the deck adapter
 *                  uses): each mark positive, within [bid, ask], not stale.
 *   C  RECORD    — GET /api/market/nighthawk/record: reachable, and the segment's own
 *                  win/loss/open/etc. buckets actually sum to its own reported resolved count.
 *
 * READ-ONLY. Auth via scripts/audit/lib/audit-auth-fetch.mjs (cron bearer first, Clerk
 * temp-user fallback — released at the end). Writes nothing, mutates no board state.
 *
 * Exit code: NON-ZERO if any stage is RED (usable as a standing gate for this lane).
 *
 * FLAGS: --json   machine output (full stage matrix + evidence)
 *        --quiet  suppress the per-check chatter (keep the final matrix)
 *        --days=N record window (default 14)
 *
 * RUN:
 *   node --import tsx scripts/audit/legacy-e2e-healthcheck.mjs
 * or: npm run healthcheck:legacy
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { resolveLegacyPlayOcc } from "../../src/features/nighthawk/lib/legacy-play-contract.ts";
import {
  rollupVerdict,
  verdictForEdition,
  verdictForMarks,
  verdictForRecord,
} from "./lib/legacy-healthcheck-eval.mjs";

const ARGV = process.argv.slice(2);
const JSON_OUT = ARGV.includes("--json");
const QUIET = ARGV.includes("--quiet") || JSON_OUT;
const DAYS = Number((ARGV.find((a) => a.startsWith("--days=")) || "").split("=")[1] || "14");

const BASE = process.env.AUDIT_APP_URL || "https://blackouttrades.com";

function log(...args) {
  if (!QUIET) console.log(...args);
}

async function checkEdition() {
  const res = await fetchAuditJson(BASE, "/api/market/nighthawk/edition");
  const plays = Array.isArray(res.json?.plays) ? res.json.plays : [];
  const stage = verdictForEdition({
    fetchOk: res.ok,
    available: res.json?.available,
    stale: Boolean(res.json?.stale),
    degraded: Boolean(res.json?.degraded),
    playsCount: plays.length,
    noPlays: Boolean(res.json?.no_plays),
  });
  return { stage, plays, editionFor: res.json?.edition_for ?? null };
}

async function checkMarks(plays) {
  const occs = [
    ...new Set(
      plays
        .map((p) => resolveLegacyPlayOcc(String(p.ticker ?? ""), p.options_play ?? null))
        .filter((o) => typeof o === "string" && o.length > 0)
    ),
  ];
  if (occs.length === 0) {
    return verdictForMarks({ fetchOk: true, requestedOccs: [], rows: [] });
  }
  const res = await fetchAuditJson(
    BASE,
    `/api/market/nighthawk/legacy-marks?occs=${encodeURIComponent(occs.slice(0, 12).join(","))}`
  );
  return verdictForMarks({
    fetchOk: res.ok,
    requestedOccs: occs,
    rows: Array.isArray(res.json?.marks) ? res.json.marks : [],
  });
}

async function checkRecord() {
  const res = await fetchAuditJson(BASE, `/api/market/nighthawk/record?days=${DAYS}`);
  return verdictForRecord({ fetchOk: res.ok, segment: res.json?.segments?.current ?? null });
}

async function main() {
  log(`[legacy-healthcheck] base=${BASE} days=${DAYS}`);

  const editionResult = await checkEdition();
  log(`  A EDITION  ${editionResult.stage.verdict}  ${editionResult.stage.evidence}`);

  const marksResult = await checkMarks(editionResult.plays);
  log(`  B MARKS    ${marksResult.verdict}  ${JSON.stringify(marksResult.evidence)}`);

  const recordResult = await checkRecord();
  log(`  C RECORD   ${recordResult.verdict}  ${recordResult.evidence}`);

  const overall = rollupVerdict([editionResult.stage.verdict, marksResult.verdict, recordResult.verdict]);

  const out = {
    ranAt: new Date().toISOString(),
    base: BASE,
    editionFor: editionResult.editionFor,
    overall,
    stages: {
      A_edition: editionResult.stage,
      B_marks: marksResult,
      C_record: recordResult,
    },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`\n[legacy-healthcheck] OVERALL: ${overall}`);
  }

  await releaseAuditClerkSession();
  process.exitCode = overall === "RED" ? 1 : 0;
}

main().catch(async (err) => {
  console.error("[legacy-healthcheck] FATAL:", err);
  await releaseAuditClerkSession().catch(() => {});
  process.exitCode = 1;
});
