import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getSpxPlayState } from "@/features/spx/lib/spx-service";
import {
  fetchLatestNighthawkEdition,
  fetchLatestPlayableNighthawkEdition,
  fetchNighthawkEditionByDate,
  requireDatabaseInProduction,
} from "@/lib/db";
import { rowToNightHawkEdition } from "@/features/nighthawk/lib/edition-builder";
import { isBeforeOrAtMarketCloseEt, nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { roundFloats } from "@/lib/round-floats";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import {
  nighthawkToSignals,
  sortSignals,
  spxToSignal,
  type Signal,
} from "@/lib/mobile/signals-projection";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mobile signals aggregator — the ONE endpoint the native iOS Signals tab
 * consumes. Two reasons this is its own route instead of pointing the app at
 * `/api/market/spx/play` and `/api/market/nighthawk/edition` directly:
 *
 * 1. **Shape stability.** The two source payloads are large (SpxPlayPayload
 *    alone is 30+ fields including nested playbook_shadow / cortex / mtf that
 *    the web dashboard needs) and evolve constantly. If iOS bound directly,
 *    every backend rename would break the app. This route projects to a tight
 *    contract in `src/lib/mobile/signals-projection.ts` that mirrors the app's
 *    SignalLifecycle stages 1:1.
 *
 * 2. **Two sources, one feed.** SPX Slayer + Night Hawk are entirely separate
 *    engines on the backend but present as one "Signals" tab in the app. The
 *    merge belongs on the server (one round trip, ordered, deduped) not on
 *    the client (two parallel fetches, race conditions on ordering).
 *
 * The auth gate mirrors every other premium data route
 * (`authorizeCronOrTierApi(minTier: "premium")`); cron callers get an empty
 * feed rather than a 401 so ops smoke checks pass without granting cron
 * access to member signals.
 */

async function loadNighthawk(): Promise<NightHawkEdition> {
  // Match /api/market/nighthawk/edition's carry-until-close semantic exactly:
  // if today's live playable edition is still actionable (before its session
  // closes), serve THAT even if tonight's edition_for is a later date. This
  // prevents the app from going blank between market close and the next
  // edition publishing.
  const editionFor = nextTradingDayEt(todayEt());
  const activePlayable = await fetchLatestPlayableNighthawkEdition();
  if (
    activePlayable &&
    activePlayable.edition_for !== editionFor &&
    isBeforeOrAtMarketCloseEt(activePlayable.edition_for)
  ) {
    const ed = rowToNightHawkEdition(activePlayable);
    ed.served_for = activePlayable.edition_for;
    ed.carry_until_close = true;
    return ed;
  }
  const exact = await fetchNighthawkEditionByDate(editionFor);
  if (exact) return rowToNightHawkEdition(exact);
  const latest = await fetchLatestNighthawkEdition();
  if (latest) {
    const ed = rowToNightHawkEdition(latest);
    if (ed.edition_for && ed.edition_for !== editionFor) {
      ed.stale = true;
      ed.served_for = ed.edition_for;
    }
    return ed;
  }
  return {
    available: false,
    edition_for: editionFor,
    published_at: null,
    recap_headline: null,
    recap_summary: null,
    plays: [],
  };
}

export async function GET(req: NextRequest) {
  const auth = await authorizeCronOrTierApi(req, "premium");
  if (auth instanceof Response) return auth;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  // Fetch both engines in parallel — neither depends on the other and each
  // has its own error path. `Promise.allSettled` means one engine failing
  // (e.g. Night Hawk DB read blip) doesn't blank the entire Signals tab.
  const [spxResult, nightHawkResult] = await Promise.allSettled([
    getSpxPlayState(),
    loadNighthawk(),
  ]);

  const spxPlay = spxResult.status === "fulfilled" ? spxResult.value : null;
  const nightHawk =
    nightHawkResult.status === "fulfilled"
      ? nightHawkResult.value
      : ({
          available: false,
          edition_for: null,
          published_at: null,
          recap_headline: null,
          recap_summary: null,
          plays: [],
        } as NightHawkEdition);

  const signals: Signal[] = [];
  const spxSignal = spxPlay ? spxToSignal(spxPlay) : null;
  if (spxSignal) signals.push(spxSignal);
  signals.push(...nighthawkToSignals(nightHawk));

  const payload = {
    ok: true as const,
    signals: sortSignals(signals),
    sources: {
      spxSlayer: {
        available: Boolean(spxPlay?.available),
        phase: spxPlay?.phase ?? "SCANNING",
        action: spxPlay?.action ?? "SCANNING",
        asOf: spxPlay?.as_of ?? null,
      },
      nightHawk: {
        available: Boolean(nightHawk.available),
        editionFor: nightHawk.edition_for,
        publishedAt: nightHawk.published_at,
        stale: Boolean(nightHawk.stale),
        degraded: Boolean(nightHawk.degraded),
        playCount: nightHawk.plays.length,
      },
    },
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(roundFloats(payload), {
    headers: NO_STORE_HEADERS,
  });
}
