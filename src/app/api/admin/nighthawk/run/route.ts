import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { buildEveningEdition, serializeBuildError } from "@/features/nighthawk/lib/edition-builder";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Admin-triggered manual run of the Night Hawk edition pipeline. Same builder the
 * cron hits — force-runs (bypasses the time window) and resumes the checkpointed
 * job. Admin-auth only (no CRON_SECRET needed).
 *
 * Query: ?asOfEt=YYYY-MM-DD&persist=1 — target edition_for = nextTradingDayEt(asOfEt).
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const asOfEt = req.nextUrl.searchParams.get("asOfEt")?.trim() || undefined;
  const persist = req.nextUrl.searchParams.get("persist") === "1";

  try {
    const result = await buildEveningEdition({
      force: true,
      ...(asOfEt ? { asOfEt, persist: persist || true } : {}),
    });
    const status = result.ok ? 200 : result.job_status === "failed" ? 500 : 202;
    return NextResponse.json(
      {
        ...result,
        note:
          result.job_status === "published"
            ? "Edition published."
            : "Checkpointed pipeline — click Run again to resume until published.",
      },
      { status, headers: { ...NO_STORE_HEADERS, "Cache-Control": "no-store" } }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/run", error);
    const detail = serializeBuildError(error);
    return NextResponse.json(
      { ok: false, error: "Edition build failed", detail },
      { status: 500 }
    );
  }
}
