import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Minimal deploy liveness — ALB/ECS healthcheck; no auth, no DB migrations. */
export async function GET() {
  const as_of = new Date().toISOString();

  // Warn but do NOT return 503 — a liveness probe must not crash-loop
  // containers over a missing integration secret. Config completeness
  // belongs in /api/admin/… dashboards, not the ECS health check path.
  if (process.env.NODE_ENV === "production" && !process.env.WHOP_WEBHOOK_SECRET?.trim()) {
    console.warn("[health] billing webhooks unconfigured in production");
  }

  if (!dbConfigured()) {
    return NextResponse.json({ ok: true, as_of, db: "skipped" });
  }

  // Readiness is checked elsewhere; liveness must not fail deploy when Postgres is slow/unreachable.
  return NextResponse.json({ ok: true, as_of, db: "configured" });
}
