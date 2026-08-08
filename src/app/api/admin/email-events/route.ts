// Minimal observability surface for the Resend delivery webhook (see
// app/api/webhook/resend/route.ts) — sent/delivered/opened/clicked/bounced/
// complained/failed counts broken down by template_tag, plus the most recent
// raw events. Deliberately a JSON API, not a dashboard page — a full visual
// UI is a reasonable follow-up once there's actually a few weeks of data to
// look at, not before.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { dbConfigured, dbQuery } from "@/lib/db";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!dbConfigured()) {
    return NextResponse.json({ available: false, reason: "database not configured" }, { headers: NO_STORE_HEADERS });
  }

  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? "14") || 14));

  const [byTemplate, recent] = await Promise.all([
    dbQuery<{ template_tag: string | null; event_type: string; count: string }>(
      `SELECT template_tag, event_type, COUNT(*) AS count
       FROM email_events
       WHERE occurred_at >= NOW() - ($1 || ' days')::interval
       GROUP BY template_tag, event_type
       ORDER BY template_tag NULLS LAST, event_type`,
      [days]
    ),
    dbQuery<{
      resend_email_id: string | null;
      event_type: string;
      recipient: string | null;
      subject: string | null;
      template_tag: string | null;
      occurred_at: string;
    }>(
      `SELECT resend_email_id, event_type, recipient, subject, template_tag, occurred_at
       FROM email_events
       ORDER BY occurred_at DESC
       LIMIT 100`
    ),
  ]);

  // Reshape byTemplate rows into { [template]: { [event_type]: count } } — easier
  // to eyeball than a flat row list, and cheap since the row count is small.
  const summary: Record<string, Record<string, number>> = {};
  for (const row of byTemplate.rows) {
    const key = row.template_tag ?? "(untagged)";
    summary[key] ??= {};
    summary[key][row.event_type] = Number(row.count);
  }

  return NextResponse.json(
    { available: true, days, summary, recent: recent.rows },
    { headers: NO_STORE_HEADERS }
  );
}
