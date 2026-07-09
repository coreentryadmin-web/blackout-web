import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Minimal deploy liveness — Railway healthcheck; no auth, no DB migrations. */
export async function GET() {
  // Once-per-deploy CF purge on ECS boot (healthcheck hits every new task before traffic).
  void import("@/lib/cf-purge-on-deploy")
    .then(({ maybePurgeCloudflareOnDeploy }) => maybePurgeCloudflareOnDeploy())
    .catch(() => undefined);

  const as_of = new Date().toISOString();

  if (process.env.NODE_ENV === "production" && !process.env.WHOP_WEBHOOK_SECRET?.trim()) {
    console.warn("[health] billing webhooks unconfigured in production");
    return NextResponse.json(
      { ok: false, reason: "billing_webhooks_unconfigured" },
      { status: 503 }
    );
  }

  if (!dbConfigured()) {
    return NextResponse.json({ ok: true, as_of, db: "skipped" });
  }

  // Readiness is checked elsewhere; liveness must not fail deploy when Postgres is slow/unreachable.
  return NextResponse.json({ ok: true, as_of, db: "configured" });
}
