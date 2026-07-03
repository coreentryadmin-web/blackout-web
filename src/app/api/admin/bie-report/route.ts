// GET /api/admin/bie-report — the live window into what the BLACKOUT Intelligence
// Engine is learning and fixing. Computes all three Layer-5 reports ON DEMAND
// (self-evaluation, gate calibration, platform discovery) plus the interaction
// stats and the trail of previously persisted reports — so "what is it improving
// right now?" is one authenticated request, not a wait for the daily cron.
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { dbConfigured, fetchBieInteractionStats, fetchBieKnowledge } from "@/lib/db";
import { runBieCalibration, formatCalibration } from "@/lib/bie/calibration";
import { runBieDailySelfEval, formatBieReport } from "@/lib/bie/report";
import { runBieDiscovery } from "@/lib/bie/discovery";
import { bieEmbeddingsConfigured } from "@/lib/bie/embeddings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!dbConfigured()) {
    return NextResponse.json({ available: false, reason: "database not configured" });
  }

  const [selfEval, calibration, discovery, stats, trail] = await Promise.all([
    runBieDailySelfEval().catch(() => null),
    runBieCalibration(14).catch(() => null),
    runBieDiscovery().catch(() => null),
    fetchBieInteractionStats(24).catch(() => null),
    fetchBieKnowledge({ kind: "self_eval", limit: 30 }).catch(() => []),
  ]);

  return NextResponse.json(
    {
      available: true,
      as_of: new Date().toISOString(),
      embeddings_configured: bieEmbeddingsConfigured(),
      // The three live reports, both structured and human-readable.
      self_eval: selfEval ? { data: selfEval, text: formatBieReport(selfEval) } : null,
      calibration: calibration ? { data: calibration, text: formatCalibration(calibration) } : null,
      discovery,
      interactions_24h: stats,
      // Every previously persisted report — the improvement trail, newest first.
      report_trail: trail.map((r) => ({ source: r.source, at: r.created_at, preview: r.chunk.slice(0, 200) })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
