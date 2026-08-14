// Night Hawk three-board (0DTE / Swing / LEAPS) — the unified remodel read that replaces the separate
// "Today's plays" / "Tonight's playbook" surfaces. The ZERO_DTE lane is the live, proven 0DTE engine
// (getZeroDteBoardPayload) adapted into the uniform HorizonPlay shape; SWING / LEAPS come online as the
// whole-market discovery lanes ship (they render as empty lanes until then, never omitted).
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction, fetchOpenSwingPositions, fetchLatestSwingSnapshotEvents } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import { scopeBoardToHorizon, assembleHorizonBoard, makePlaySet, withLane } from "@/lib/horizon-board";
import {
  horizonForView,
  isKnownNightHawkView,
  KNOWN_NIGHTHAWK_VIEW_TOKENS,
  parseNightHawkView,
} from "@/features/nighthawk/lib/nighthawk-view";
import { horizonBoardFromZeroDtePayload } from "@/lib/zerodte/horizon-board-from-payload";
import { getSwingServingLane, discoverSwingFromPersisted, readSwingServingSnapshot } from "@/lib/swing/serving-lane";
import { requireToolApi } from "@/lib/tool-access-server";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  // Same single launch gate as the 0DTE Command board — Night Hawk owns the kill-switch.
  if (authResult.via === "user") {
    const nighthawkDenied = await requireToolApi("nighthawk");
    if (nighthawkDenied) return nighthawkDenied;
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  ensureDataSockets();
  try {
    // Toggle scoping: ?view=0dte|swings|leaps|legacy (or ?horizon=) narrows the payload to one lane so the
    // whole desk shows the selected horizon. Absent → the full board (all lanes). LEGACY has no horizon
    // lane here (it's served by the separate evening-edition route), so it scopes to an all-empty board.
    const viewParam = req.nextUrl.searchParams.get("view") ?? req.nextUrl.searchParams.get("horizon");
    // Reject an unrecognised view instead of silently serving the default lane. parseNightHawkView
    // falls back for the UI's benefit (a stale shared link should still render), but on an API that
    // fallback made `?view=outcomes` and `?view=totally-invalid-view` return the 0DTE lane with a
    // 200 — measured live 2026-08-10, both 1,053 bytes against 34,352 for `?view=swings`. A caller
    // could not tell "you asked for something that does not exist" from "that lane is empty".
    if (viewParam != null && viewParam !== "" && !isKnownNightHawkView(viewParam)) {
      return NextResponse.json(
        { error: "Invalid view", allowed: [...KNOWN_NIGHTHAWK_VIEW_TOKENS].map((v) => v.toLowerCase()) },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    const horizon = viewParam ? horizonForView(parseNightHawkView(viewParam)) : null;

    // Scoped Swing/LEAPS views never need the live 0DTE board rebuild — skip the heavy payload
    // when the response will zero that lane anyway (P2-5 latency fix).
    let payload: Awaited<ReturnType<typeof getZeroDteBoardPayload>> | null = null;
    let board =
      horizon === "SWING" || horizon === "LEAPS"
        ? assembleHorizonBoard(makePlaySet({}), new Date().toISOString())
        : null;

    if (!board) {
      payload = await getZeroDteBoardPayload();
      board = horizonBoardFromZeroDtePayload(payload, payload.as_of);
    }

    // SWING branch: persisted discovery lane + OPEN ledger rows for live sections. Cache-reader on
    // providers (spots come from the serving snapshot); DB open-book read is the member board's job.
    const snap = await readSwingServingSnapshot().catch(() => null);
    const swingLane = await getSwingServingLane({
      discover: discoverSwingFromPersisted,
      fetchOpenPositions: () => fetchOpenSwingPositions().catch(() => []),
      fetchLatestManageEvents: (ids) => fetchLatestSwingSnapshotEvents(ids).catch(() => new Map()),
      spotsByTicker: snap?.spotsByTicker,
    });
    // withLane, not a raw spread: `board` was assembled from the 0DTE payload alone, so its
    // totalCommitted/totalWatch describe the ZERO_DTE lane only. Splicing SWING in with a spread left
    // those totals stale on the all-lanes view — `scopeBoardToHorizon(board, null)` is a documented
    // no-op, so nothing downstream re-derived them (measured live 2026-08-14: totalCommitted 1 on a
    // board whose SWING lane carried 14 committed plays). withLane re-derives from all three lanes.
    board = withLane(board, "SWING", swingLane);
    board = scopeBoardToHorizon(board, horizon);
    // roundFloats at the boundary: the 0DTE lane is already rounded inside zerodte-service,
    // but the SWING lane is spliced in raw from getSwingServingLane() and the board totals are
    // re-derived here (scopeBoardToHorizon) without rounding — so raw provider floats (e.g.
    // 7499.360000000001) could leak into the horizon board once swings ship. Rounding the whole
    // payload at the response edge is the same backstop every sibling market route applies and
    // touches no computed value (roundFloats only trims IEEE float noise on numbers).
    return NextResponse.json(
      roundFloats({
        board,
        upstream_ok: payload?.upstream_ok ?? true,
        session: payload?.session ?? null,
      }),
      {
        headers: NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    console.error("[market/nighthawk/horizons]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: NO_STORE_HEADERS }
    );
  }
}
