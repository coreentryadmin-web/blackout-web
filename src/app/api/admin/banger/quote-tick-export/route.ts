// GET /api/admin/banger/quote-tick-export — admin-only export of banger_quote_tick_log, the
// prospective NBBO quote-tick log built by PR #5522 (docs/audit/BANGER-EXIT-QUOTE-TICK-VALIDATION-
// 2026-09-27.md) to close the archived-vs-live data gap the earlier Polygon-reconstruction
// adversarial validation ran into. This route is the data source for the live-tick-log validation
// framework (scripts/audit/banger-live-tick-validation.mjs) — it has no other consumer.
//
// TWO MODES, so a caller never pays for per-tick detail before knowing it's worth fetching:
//   - COVERAGE (default, no `occ` param): one aggregate GROUP BY scan across every contract this
//     table has EVER seen a tick for since `since` — {contract_occ, tick_count, first_tick_at,
//     last_tick_at} per contract. Cheap regardless of table size; the validation framework calls
//     this first, every run, to decide which contracts even have candidate coverage before asking
//     for full detail on just those.
//   - DETAIL (`occ` param given): every tick for that ONE contract in `[since, until)`, oldest→
//     newest — the replay order the tick-by-tick management-loop clone needs.
//
// Read-only, zero write path. Mirrors admin/banger/closed-export and admin/swing/
// closed-position-snapshots' own auth/error/header conventions.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import {
  fetchBangerQuoteTickCoverage,
  fetchBangerQuoteTicksForContract,
} from "@/lib/banger/quote-tick-log";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const MAX_TICKS_PER_CONTRACT = 5000;
const MAX_CONTRACTS_IN_COVERAGE = 5000;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS),
  );
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam))
    ? new Date(sinceParam).toISOString()
    : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const occ = req.nextUrl.searchParams.get("occ");

  try {
    if (occ) {
      const untilParam = req.nextUrl.searchParams.get("until");
      const until = untilParam && !Number.isNaN(Date.parse(untilParam))
        ? new Date(untilParam).toISOString()
        : new Date().toISOString();
      const ticks = await fetchBangerQuoteTicksForContract(occ, since, until, MAX_TICKS_PER_CONTRACT);
      return NextResponse.json(
        roundFloats({ mode: "detail", contract_occ: occ, since, until, count: ticks.length, ticks }),
        { headers: NO_STORE_HEADERS },
      );
    }
    const coverage = await fetchBangerQuoteTickCoverage(since, MAX_CONTRACTS_IN_COVERAGE);
    return NextResponse.json(
      roundFloats({ mode: "coverage", since, through: new Date().toISOString(), days, count: coverage.length, coverage }),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    recordAdminRouteError("admin/banger/quote-tick-export", error);
    return NextResponse.json({ error: "Failed to load banger quote-tick export" }, { status: 502 });
  }
}
