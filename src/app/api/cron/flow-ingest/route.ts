import { NextRequest, NextResponse } from "next/server";
import { runFlowIngest } from "@/lib/providers/flow-ingest";
import { logCronRun } from "@/lib/cron-run";

export async function GET(req: NextRequest) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const q = req.nextUrl.searchParams.get("secret");

  if (!secret || (auth !== secret && q !== secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFlowIngest();
    await logCronRun("flow-ingest", started, {
      ok: true,
      skipped: Boolean(result.skipped),
      reason: typeof result.skipped === "string" ? result.skipped : undefined,
      ingested: result.ingested,
      polled: result.polled,
    });
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/flow-ingest]", error);
    await logCronRun("flow-ingest", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Ingest failed", detail }, { status: 500 });
  }
}
