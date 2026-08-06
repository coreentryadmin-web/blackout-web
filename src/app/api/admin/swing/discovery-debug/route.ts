// GET /api/admin/swing/discovery-debug — read-only funnel snapshot for ops (Wave C admin).
// Returns the latest persisted serving snapshot (what members see) plus honest counts.
// No per-request full-market scan — cache-reader rule.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { readSwingServingSnapshot } from "@/lib/swing/serving-lane";
import { persistenceGapReason } from "@/lib/swing/accumulation-store";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { fetchOpenSwingShadowPositions } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const snap = await readSwingServingSnapshot().catch(() => null);
  if (!snap) {
    return NextResponse.json(
      {
        ok: true,
        available: false,
        reason: "No persisted swing serving snapshot — discovery cron has not written yet.",
      },
      { headers: NO_STORE_HEADERS }
    );
  }

  const observed = (snap.observed ?? []).map((c) => ({
    ...c,
    persistenceGap: persistenceGapReason(c),
  }));

  // Shadow positions (2026-08-06): real signals a risk gate (budget/caps) turned away — zero real
  // capital, tracked in a SEPARATE table (never fed into the real book/budget/board). Read-only here.
  const shadow = await fetchOpenSwingShadowPositions().catch(() => []);

  return NextResponse.json(
    roundFloats({
      ok: true,
      available: true,
      asOf: snap.asOf,
      sessionDay: snap.sessionDay,
      dossiers: snap.dossiers?.length ?? 0,
      plays: snap.plays?.length ?? 0,
      watch: snap.watch?.length ?? 0,
      observed: observed.length,
      watchTickers: (snap.watch ?? []).map((w) => w.ticker),
      observedDetail: observed,
      spotsCount: Object.keys(snap.spotsByTicker ?? {}).length,
      shadowCount: shadow.length,
      shadowPositions: shadow.map((s) => ({
        ticker: s.ticker,
        direction: s.direction,
        archetype: s.archetype,
        subLane: s.sub_lane,
        blockedBy: s.blocked_by,
        entryPremium: s.entry_premium,
        sessionDate: s.session_date,
      })),
    }),
    { headers: NO_STORE_HEADERS }
  );
}
