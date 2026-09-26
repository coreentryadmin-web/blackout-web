// GET /api/admin/swing/closed-position-snapshots — admin-only export of the REAL per-tick
// (~15-min RTH cadence) longitudinal history for every closed native-swing position (leg) in a
// window, joining the member-facing closed-deck row (entry/contract/cortex/score — the pinned
// decision record) with its full swing_position_snapshots series (option_mark/underlying_px/
// running_mfe/running_mae/thesis_state/event_json — the real observed path).
//
// WHY THIS EXISTS (Ask Largo standing mandate, operator directive 2026-09-26): the discovery-edge
// study (docs/audit/NIGHTHAWK-EDGE-STUDY-2026-09-26.md) found only summary peak/trough values were
// exportable — no true chronological path, so trailing-stop/breakeven-timing/time-based/thesis-
// invalidation exit rules could not be honestly simulated (they need to know WHEN price did what,
// not just the extremes). `swing_position_snapshots` already carries exactly that: an append-only
// (never upserted) row per RTH refresh tick since the engine went live with real capital
// (2026-07-24, same day as the writer — insertSwingSnapshot, manage-sync.ts), with NO existing
// export route (fetchSwingSnapshots had zero callers outside the writer's own cron and tests before
// this route). This closes that gap for native swing specifically — no equivalent per-tick
// mechanism exists for Banger (its peak/trough are pure update-in-place running max/min with no
// historical log), so this route cannot and does not attempt to serve Banger.
//
// Each snapshot's `event_json.rung`/`action`/`enforced`/`gating` is production's OWN real-time
// management verdict at that exact tick (planManageSync, manage-sync.ts) — not something this
// route (or any consumer) re-derives — so a consumer can reconstruct "what did production actually
// decide, and when" without fabricating any qualitative signal, and can test an alternative rule's
// counterfactual decision using only ticks up to and including that timestamp (no look-ahead).
//
// SCOPE NOTE (disclosed, not fixed here): a rolled position is a CHAIN of separate `position_id`
// rows in swing_positions, each with its own snapshot series. This route serves snapshots for the
// TERMINAL leg only (the same leg `closedDeckSourcesFromChains` sources entry/peak/trough/contract
// from) — a multi-leg chain's earlier legs are not included. This is a real, disclosed scope limit
// (a rolled chain's simulated replay covers only its final leg's own holding period), not a
// look-ahead issue — every consumer of this route must treat a chain's pre-terminal-leg history as
// absent, never approximate it from the terminal leg's own entry.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  fetchSwingPositionChain,
  fetchSwingPositionsRange,
  fetchSwingSnapshots,
  requireDatabaseInProduction,
} from "@/lib/db";
import { selectSwingRecordRootIds } from "@/lib/swing/record";
import { closedDeckSourcesFromChains } from "@/lib/swing/closed-plays";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { formatEtDate, todayEt } from "@/features/nighthawk/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_DAYS = 90;
const MAX_DAYS = 120;
const MAX_ROWS = 2000;
const MAX_CHAINS = 300;
const MAX_SNAPSHOTS_PER_POSITION = 2000;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS),
  );
  const through = todayEt();
  const since = formatEtDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  try {
    const posRows = await fetchSwingPositionsRange(since, Math.min(MAX_ROWS, days * 40));
    const rootIds = selectSwingRecordRootIds(posRows).slice(0, MAX_CHAINS);
    const chains = await Promise.all(rootIds.map((id) => fetchSwingPositionChain(id)));
    const closedDeck = closedDeckSourcesFromChains(chains);

    const rows = await Promise.all(
      closedDeck.map(async (row) => {
        const snapshots = await fetchSwingSnapshots(row.positionId, MAX_SNAPSHOTS_PER_POSITION);
        return { ...row, snapshots };
      }),
    );

    return NextResponse.json(
      roundFloats({ since, through, days, count: rows.length, rows }),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    recordAdminRouteError("admin/swing/closed-position-snapshots", error);
    return NextResponse.json({ error: "Failed to load swing closed-position snapshots" }, { status: 502 });
  }
}
