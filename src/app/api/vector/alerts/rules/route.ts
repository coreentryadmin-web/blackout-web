import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured, dbQuery } from "@/lib/db";
import {
  ensureVectorAlertRulesTable,
  rowToAlertRule,
  sanitizeIncomingRules,
  type VectorAlertRuleRow,
} from "@/features/vector/lib/vector-alert-rules-db";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/**
 * Server-side persistence for a member's Vector alert rules (task: server-side wall-touch/
 * flip-cross delivery). Rules still live primarily in browser localStorage
 * (`vector-alerts-store.ts`) — this route is a best-effort MIRROR the client syncs to on every
 * local save (see `VectorPageShell.tsx`'s `persistRules`) so `/api/cron/vector-alerts` has
 * something to evaluate for a member with no open tab. A failed sync here must never break the
 * in-page experience, which is why the client treats this as fire-and-forget.
 *
 * Auth pattern mirrors `src/app/api/push/subscribe/route.ts` exactly (Clerk `auth()`, 401 when
 * signed out, 503 when the DB isn't configured, lazy `ensureVectorAlertRulesTable()`).
 */

function normalizeTicker(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toUpperCase();
}

/** GET ?ticker=SPY → that ticker's rules only. GET with no ticker → every rule for the account
 *  (used by the cron's "which tickers does this user care about" fan-out, and available to any
 *  future account-wide UI). */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  if (!dbConfigured()) {
    // No server-side store configured — the client's localStorage copy is still authoritative,
    // so answer with an empty mirror rather than an error (this route is a best-effort add-on).
    return NextResponse.json({ rules: [] }, { headers: NO_STORE_HEADERS });
  }

  const ticker = normalizeTicker(req.nextUrl.searchParams.get("ticker"));

  try {
    await ensureVectorAlertRulesTable();
    const { rows } = ticker
      ? await dbQuery<VectorAlertRuleRow>(
          `SELECT id, ticker, kind, tolerance_pct, enabled
             FROM vector_alert_rules
            WHERE user_id = $1 AND ticker = $2
            ORDER BY id`,
          [userId, ticker]
        )
      : await dbQuery<VectorAlertRuleRow>(
          `SELECT id, ticker, kind, tolerance_pct, enabled
             FROM vector_alert_rules
            WHERE user_id = $1
            ORDER BY ticker, id`,
          [userId]
        );
    return NextResponse.json({ rules: rows.map(rowToAlertRule) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[vector alert rules GET]", error);
    return NextResponse.json({ error: "Failed to load rules" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

/** Replace the authed user's rule set for ONE ticker (whole-ticker replace, matching the shell's
 *  `persistRules(next)` shape — it always saves the FULL rule array for the active ticker). */
export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  let body: { ticker?: string; rules?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const ticker = normalizeTicker(body.ticker);
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400, headers: NO_STORE_HEADERS });

  const clean = sanitizeIncomingRules(ticker, body.rules);

  try {
    await ensureVectorAlertRulesTable();
    // Whole-ticker replace: delete then (re)insert. Not wrapped in an explicit transaction — this
    // is a best-effort mirror of localStorage (never the source of truth), so a rare interleaving
    // on this single-user-scoped row set is an acceptable trade for staying consistent with the
    // rest of the repo's simple dbQuery call sites (push/subscribe has no transaction either).
    await dbQuery(`DELETE FROM vector_alert_rules WHERE user_id = $1 AND ticker = $2`, [userId, ticker]);
    if (clean.length) {
      const values: unknown[] = [];
      const rowsSql = clean
        .map((rule, i) => {
          const base = i * 6; // 6 columns per row: id, user_id, ticker, kind, tolerance_pct, enabled
          values.push(rule.id, userId, rule.ticker, rule.kind, rule.tolerancePct ?? null, rule.enabled);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
        })
        .join(", ");
      await dbQuery(
        `INSERT INTO vector_alert_rules (id, user_id, ticker, kind, tolerance_pct, enabled)
         VALUES ${rowsSql}`,
        values
      );
    }
    return NextResponse.json({ ok: true, rules: clean }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[vector alert rules PUT]", error);
    return NextResponse.json({ error: "Failed to save rules" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

/** Clear all rules for ONE ticker on the authed user's account (body: { ticker }). */
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  let ticker: string;
  try {
    ticker = normalizeTicker((await req.json())?.ticker);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400, headers: NO_STORE_HEADERS });

  try {
    await ensureVectorAlertRulesTable();
    await dbQuery(`DELETE FROM vector_alert_rules WHERE user_id = $1 AND ticker = $2`, [userId, ticker]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[vector alert rules DELETE]", error);
    return NextResponse.json({ error: "Failed to delete rules" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
