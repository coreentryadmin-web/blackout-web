import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { largoSessionRetentionDays, purgeStaleLargoSessions } from "@/lib/largo/largo-store";

export const dynamic = "force-dynamic";

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const q = req.nextUrl.searchParams.get("secret");
  return auth === secret || q === secret;
}

/** Weekly cleanup — delete Largo sessions inactive for 7+ days (default). */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const daysParam = req.nextUrl.searchParams.get("days");
  const retentionDays = daysParam ? Number(daysParam) : largoSessionRetentionDays();
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    return NextResponse.json({ error: "Invalid days parameter" }, { status: 400 });
  }

  try {
    const result = await purgeStaleLargoSessions(retentionDays);
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/largo-cleanup]", error);
    return NextResponse.json({ ok: false, error: "Largo cleanup failed", detail }, { status: 500 });
  }
}
