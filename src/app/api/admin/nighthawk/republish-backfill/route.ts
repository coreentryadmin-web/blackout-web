// POST /api/admin/nighthawk/republish-backfill — operator-directed, one-shot, re-runnable admin
// action (2026-09-28). Applies the structural-only-eligibility backfill logic to an already-
// PUBLISHED thin edition, using that edition's own real, already-frozen rank_governor candidate
// pool (never re-scores/re-discovers) and LIVE current option chains (contracts cannot be frozen).
// Idempotent — republishBackfilledEdition no-ops once the edition is already at the configured
// minimum play count, or when no eligible/contractable candidate remains in the pool. Never
// touches an already-published QUALIFIED play; only ever appends real, chain-grounded BACKFILL
// plays. See src/features/nighthawk/lib/post-publish-backfill.ts for the full rationale.
//
// Body: { "edition_for": "YYYY-MM-DD" } (required — this is a targeted, single-edition action,
// deliberately with no "latest" default so an admin always names exactly which edition they mean).
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiActor, requireAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { republishBackfilledEdition } from "@/features/nighthawk/lib/post-publish-backfill";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
        { ok: false, error: `edition_for is required, format YYYY-MM-DD` },
        { status: 400 }
      );
    }
    editionFor = body.edition_for;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await republishBackfilledEdition(editionFor);
    console.info(`[nighthawk/republish-backfill] edition_for=${editionFor} status=${result.status}`);
    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: "nighthawk_republish_backfill",
      detail: { edition_for: editionFor, result },
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 404, headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/republish-backfill", error);
    return NextResponse.json(
      { ok: false, error: "Republish-backfill failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
