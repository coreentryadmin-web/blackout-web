import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { runVectorPickUniverseSweep } from "@/lib/vector/vector-pick-sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

async function runPickSweep(started: number): Promise<void> {
  try {
    const summary = await runVectorPickUniverseSweep();
    console.info(
      `[cron/vector-pick-sweep] done session=${summary.sessionDate} tickers=${summary.tickersAttempted} ` +
        `green=${summary.green} skip=${summary.skip} amber=${summary.amber} red=${summary.red} ` +
        `leaders=${summary.leadersWritten} closures=${summary.closuresLogged} elapsed=${Date.now() - started}ms`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[cron/vector-pick-sweep] REJECTED: ${detail}`);
  }
}

/** Server-side Vector contract-pick sweep — ranks + live-evaluates universe tickers without a desk viewer. */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-pick-sweep", started, payload);
    return NextResponse.json(payload);
  }

  const dispatch = () => {
    void runPickSweep(started);
  };

  try {
    after(dispatch);
  } catch {
    dispatch();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "Vector pick universe sweep dispatched in background",
  };
  await logCronRun("vector-pick-sweep", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Evaluates ranked contract picks for every Vector universe ticker; writes leaders + Don't buy closures.",
    },
    { status: 202 }
  );
}
