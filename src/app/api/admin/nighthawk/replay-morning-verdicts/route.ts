// POST /api/admin/nighthawk/replay-morning-verdicts — operator-directed, idempotent, re-runnable
// admin action (2026-09-29). Closes a real gap found live: a play that gets a
// nighthawk_play_outcomes row AFTER the 9:15am ET morning-confirm cron has already fired for the
// day (e.g. a BACKFILL play added via /api/admin/nighthawk/republish-backfill after 9:15) never
// gets its morning verdict/pull-latch persisted -- persistNighthawkMorningVerdicts's write
// silently no-op'd for it that morning (missing_rows, by design, to tolerate a publish-time sync
// failure gracefully), and the cron only ever runs once per edition_for. See
// docs/audit/findings-staging/2026-09-29-nighthawk-republish-missing-outcome-rows-split-brain.md.
//
// This does NOT recompute anything. It re-reads the SAME cached Redis blob the 9:15am cron
// already wrote for this edition (nh:play-status:{date} -- the actual verdict already shown to
// members all day) and calls the same persistNighthawkMorningVerdicts(...) the cron itself calls,
// just sourcing playStatuses/market from that cache instead of fresh Polygon/intel reads. Unlike
// re-invoking the cron route with ?force=1, this never touches the Redis blob (no risk of
// overwriting today's correct 9:15 snapshot with mid-day numbers mislabeled "premarket") and can
// only ever write a verdict that was ALREADY computed and published earlier that day -- a replay,
// never a new decision. The underlying DB write (recordNighthawkMorningVerdict) is COALESCE-based
// (first-write-wins), so a ticker that already has a persisted verdict is untouched; only rows
// still missing one (the actual gap) get written.
//
// Body: { "edition_for": "YYYY-MM-DD" } (required, no "latest" default -- same discipline as
// republish-backfill's own route).
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiActor, requireAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { makeRedis } from "@/lib/make-redis";
import { fetchNighthawkEditionByDate } from "@/lib/db";
import { rowToNightHawkEdition } from "@/features/nighthawk/lib/edition-builder";
import { persistNighthawkMorningVerdicts } from "@/features/nighthawk/lib/morning-verdict-persist";
import type { MorningConfirmResult } from "@/app/api/cron/nighthawk-morning-confirm/route";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REDIS_KEY = (date: string) => `nh:play-status:${date}`;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const actor = await getAdminApiActor();

  let editionFor: string;
  try {
    const raw = await req.text();
    const body = raw.trim().length > 0 ? (JSON.parse(raw) as { edition_for?: unknown }) : {};
    if (typeof body.edition_for !== "string" || !ISO_DATE_RE.test(body.edition_for)) {
      return NextResponse.json(
        { ok: false, error: "edition_for is required, format YYYY-MM-DD" },
        { status: 400 }
      );
    }
    editionFor = body.edition_for;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const redisUrl = process.env.REDIS_URL ?? "";
  if (!redisUrl) {
    return NextResponse.json(
      { ok: false, error: "Redis not configured" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  let redis: Awaited<ReturnType<typeof makeRedis>> | null = null;
  try {
    redis = await makeRedis("nighthawk-replay-morning-verdicts", redisUrl, { maxRetriesPerRequest: 1 });
    const raw = await redis.get(REDIS_KEY(editionFor));
    if (!raw) {
      return NextResponse.json(
        { ok: false, error: `No cached morning-confirm result for ${editionFor} -- nothing to replay` },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    const cached = JSON.parse(raw) as MorningConfirmResult;

    const editionRow = await fetchNighthawkEditionByDate(editionFor);
    if (!editionRow) {
      return NextResponse.json(
        { ok: false, error: `No published edition for ${editionFor}` },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    const edition = rowToNightHawkEdition(editionRow);

    const result = await persistNighthawkMorningVerdicts({
      editionFor,
      checkedAt: cached.checked_at,
      playStatuses: cached.plays,
      plays: (edition.plays ?? []) as PlaybookPlay[],
      market: {
        // Sourced from the SAME cached blob -- never recomputed. stockPremarketByTicker isn't
        // re-exposed by the cached result shape, so per-ticker metrics.stock_premarket honestly
        // persists as null for a replayed row rather than fabricating a value; this only affects
        // supplementary metrics, never status/reason/the pull latch itself.
        gapPts: cached.overnight_gap_pts,
        spxPremarket: cached.spx_premarket,
        spxPriorClose: cached.prior_close,
        regime: cached.regime,
        stockPremarketByTicker: {},
      },
    });

    console.info(
      `[nighthawk/replay-morning-verdicts] edition_for=${editionFor} persisted=${result.persisted} already=${result.already_recorded} missing=${result.missing_rows} pulled=${result.pulled}`
    );
    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: "nighthawk_replay_morning_verdicts",
      detail: { edition_for: editionFor, result },
    });
    return NextResponse.json(
      { edition_for: editionFor, ...result },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/replay-morning-verdicts", error);
    return NextResponse.json(
      { ok: false, error: "Replay failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  } finally {
    await redis?.quit().catch(() => undefined);
  }
}
