// Cron: NIGHT HAWK BACKFILL REPAIR — self-heals a stale BACKFILL contract on today's already-
// published Legacy edition, before market open.
//
// FIRES: 13:00 + 14:00 UTC Mon-Fri (dual-band, same shape as nighthawk-morning-confirm) — 9:00 AM
// ET in both DST regimes, 15 minutes BEFORE morning-confirm's own 9:15 AM ET run, so morning-
// confirm (which reads the edition row fresh from the DB and explicitly documents "the edition
// ROW is still never mutated" by ITS OWN logic — see that route's header comment) always sees
// whatever this route has already repaired.
//
// WHY THIS EXISTS (Ask Largo standing mandate, live repro 2026-10-25): PR #6637 (2026-10-24)
// shipped `repairStaleBackfillContracts`/`republishBackfilledEdition` (post-publish-backfill.ts)
// specifically to re-pick or drop a BACKFILL play whose own option contract has already expired
// relative to the edition's target trading day — but that function is ONLY ever invoked via the
// admin-only, manually-triggered `POST /api/admin/nighthawk/republish-backfill`. Nothing calls it
// automatically. Re-verified live 2026-10-25, a full day after #6637 shipped the repair
// capability: `GET /api/market/nighthawk/edition` for edition_for "2026-10-26" was STILL serving
// the exact same dead contract #6637's own commit message cites ("PLTR $197.5 Call 2026-10-23"),
// confirmed dead via `GET /api/market/nighthawk/legacy-marks` (mark/bid/ask/asof all null) while
// the edition's other two plays resolved with real live marks — because nobody had ever actually
// invoked the admin endpoint for this edition. The repair CAPABILITY existed; the automatic
// CALLER did not. This cron is that caller.
//
// This is deliberately a SEPARATE cron rather than a change to nighthawk-morning-confirm or
// nighthawk-edition: morning-confirm's own header comment states it never mutates the edition
// row (the pull latch lives on the outcome row instead) — writing the repaired `plays` into the
// edition row from inside that route would contradict its own documented invariant. nighthawk-
// edition is the evening discovery/scoring/publish pipeline for a FUTURE edition_for, not a
// repair pass on an edition already published and now approaching its own trading day — bolting
// an unrelated repair step onto that route's job-staging/checkpointing logic would be scope creep
// on a sensitive pipeline. A small, single-purpose cron that calls the already-shipped, already-
// idempotent `republishBackfilledEdition` is the minimal, safe fix.
//
// AUTH: Bearer CRON_SECRET (isCronAuthorized). force-dynamic.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction, fetchLatestNighthawkEdition, fetchNighthawkEditionByDate } from "@/lib/db";
import { rowToNightHawkEdition } from "@/features/nighthawk/lib/edition-builder";
import { republishBackfilledEdition } from "@/features/nighthawk/lib/post-publish-backfill";
import { todayEt, isTradingDayEt } from "@/features/nighthawk/lib/session";
import { inEtWindow } from "@/features/nighthawk/lib/et-window";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_KEY = "nighthawk-backfill-repair";

function inRepairWindow(force: boolean): boolean {
  if (force) return true;
  // Dual-band 9:00 AM ET, same DST-coverage shape as every other nighthawk cron's schedule_cron_utc.
  return inEtWindow({
    targetHour: Number(process.env.NIGHTHAWK_BACKFILL_REPAIR_HOUR_ET ?? "9"),
    targetMinute: Number(process.env.NIGHTHAWK_BACKFILL_REPAIR_MINUTE_ET ?? "0"),
    catchupMin: Number(process.env.NIGHTHAWK_BACKFILL_REPAIR_CATCHUP_MIN ?? "90"),
  });
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  const today = todayEt(new Date(started));

  // Same holiday guard every other nighthawk-* cron carries (inEtWindow only knows Sat/Sun).
  if (!force && !isTradingDayEt(today)) {
    const payload = { ok: true, skipped: true, reason: `non-trading day (${today})` };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  if (!inRepairWindow(force)) {
    const payload = {
      ok: false,
      skipped: true,
      reason: "Outside repair window (9:00 AM ET) — use ?force=1 to override",
    };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  const editionDateParam = req.nextUrl.searchParams.get("date") ?? today;

  try {
    let editionRow = await fetchNighthawkEditionByDate(editionDateParam);
    if (!editionRow) {
      editionRow = await fetchLatestNighthawkEdition();
    }
    if (!editionRow) {
      const payload = { ok: false, skipped: true, reason: "No Night Hawk edition found to repair" };
      await logCronRun(CRON_KEY, started, payload);
      return NextResponse.json(payload);
    }

    const edition = rowToNightHawkEdition(editionRow);
    const editionFor = edition.edition_for ?? editionDateParam;

    // Same session-match discipline as nighthawk-morning-confirm: a repair against a FUTURE
    // edition (e.g. Monday's, published Thursday evening when Friday is a holiday) belongs to
    // Monday's own 9:00 AM run, not today's.
    if (!force && editionFor !== today) {
      const payload = {
        ok: true,
        skipped: true,
        reason: `Edition targets ${editionFor}, not today (${today}) — nothing to repair this session`,
      };
      await logCronRun(CRON_KEY, started, payload);
      return NextResponse.json(payload);
    }

    const result = await republishBackfilledEdition(editionFor);

    if (!result.ok) {
      const payload = { ok: false, skipped: true, reason: result.status, edition_for: editionFor };
      await logCronRun(CRON_KEY, started, payload);
      return NextResponse.json(payload);
    }

    const repairedTickers = "repairedTickers" in result ? result.repairedTickers : [];
    const droppedTickers = "droppedTickers" in result ? result.droppedTickers : [];

    if (repairedTickers.length > 0 || droppedTickers.length > 0) {
      await notifyOpsDiscord({
        severity: "warning",
        title: `Night Hawk: stale BACKFILL contract self-healed — ${editionFor}`,
        body:
          `repaired: ${repairedTickers.join(", ") || "(none)"}\n` +
          `dropped: ${droppedTickers.join(", ") || "(none)"}\n` +
          `status=${result.status}`,
      }).catch(() => undefined);
    }

    const payload = {
      ok: true,
      edition_for: editionFor,
      status: result.status,
      plays_count: result.playsCount,
      repaired_tickers: repairedTickers,
      dropped_tickers: droppedTickers,
    };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  } catch (err) {
    const payload = { ok: false, error: err instanceof Error ? err.message : String(err) };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload, { status: 500 });
  }
}
