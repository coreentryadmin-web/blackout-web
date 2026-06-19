import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getAgentConfig } from "@/lib/nighthawk/agent-config";
import { huntPlatformContext, runHuntScan } from "@/lib/nighthawk/hunt-builder";
import type { HuntMode, HuntRequest, HuntResponse } from "@/lib/nighthawk/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VALID_MODES: HuntMode[] = ["day", "swing", "leap"];

export async function POST(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  let body: HuntRequest;
  try {
    body = (await req.json()) as HuntRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.mode || !VALID_MODES.includes(body.mode)) {
    return NextResponse.json({ error: "Invalid hunt mode" }, { status: 400 });
  }

  const config = getAgentConfig(body.mode);
  const filters = body.filters ?? {};

  console.info("[nighthawk/hunt] start", {
    mode: body.mode,
    filters,
    userId: authResult.userId,
  });

  const [scan, platform_context] = await Promise.all([
    runHuntScan(body),
    huntPlatformContext(),
  ]);

  const response: HuntResponse = {
    status: scan.ok ? "complete" : "error",
    mode: body.mode,
    scanned_at: new Date().toISOString(),
    message: scan.ok
      ? scan.message
      : scan.message || `${config.title} hunt finished without qualifying plays.`,
    plays: scan.plays,
    platform_context,
  };

  console.info("[nighthawk/hunt] done", {
    mode: body.mode,
    ok: scan.ok,
    plays: scan.plays.length,
    candidates: scan.candidates,
    duration_ms: scan.duration_ms,
    userId: authResult.userId,
  });

  return NextResponse.json(response, {
    status: scan.ok ? 200 : 422,
    headers: { "Cache-Control": "no-store" },
  });
}
