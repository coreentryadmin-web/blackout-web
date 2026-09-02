import { NextResponse, type NextRequest } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { dbConfigured, dbQuery } from "@/lib/db";
import {
  ensureHelixAlertRulesTable,
  rowToHelixAlertRule,
  sanitizeIncomingHelixAlertRule,
  type HelixAlertRuleRow,
} from "@/features/helix/lib/helix-alert-rules-db";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/**
 * Server-side CRUD for a member's HELIX per-ticker flow alert rules. Auth/shape mirrors
 * `/api/vector/alerts/rules/route.ts` (premium tier + `requireToolApi`, Clerk `auth()`, 503 when
 * the DB isn't configured, lazy `ensureHelixAlertRulesTable()`) — the one structural difference is
 * ONE rule per (user, ticker) rather than an array, so PUT is a single-row upsert rather than a
 * whole-array replace. See helix-alert-rules-core.ts's header for why.
 */

function normalizeTicker(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toUpperCase();
}

async function requireHelixAlertAuth(): Promise<{ userId: string } | Response> {
  const tier = await requireTierApi("premium");
  if (tier instanceof Response) return tier;
  const locked = await requireToolApi("flows"); // HELIX's ToolKey is "flows" (its URL, /flows) — "helix" is the product name, not the key
  if (locked) return locked;
  return { userId: tier.userId };
}

/** GET ?ticker=TSLA → that ticker's rule (or null). GET with no ticker → every rule on the
 *  account (for a future account-wide "manage all my alerts" view). */
export async function GET(req: NextRequest) {
  const auth = await requireHelixAlertAuth();
  if (auth instanceof Response) return auth;
  const { userId } = auth;
  if (!dbConfigured()) {
    return NextResponse.json({ rule: null, rules: [] }, { headers: NO_STORE_HEADERS });
  }

  const ticker = normalizeTicker(req.nextUrl.searchParams.get("ticker"));

  try {
    await ensureHelixAlertRulesTable();
    if (ticker) {
      const { rows } = await dbQuery<HelixAlertRuleRow>(
        `SELECT ticker, min_premium, side, enabled
           FROM helix_alert_rules
          WHERE user_id = $1 AND ticker = $2`,
        [userId, ticker]
      );
      return NextResponse.json(
        { rule: rows[0] ? rowToHelixAlertRule(rows[0]) : null },
        { headers: NO_STORE_HEADERS }
      );
    }
    const { rows } = await dbQuery<HelixAlertRuleRow>(
      `SELECT ticker, min_premium, side, enabled
         FROM helix_alert_rules
        WHERE user_id = $1
        ORDER BY ticker`,
      [userId]
    );
    return NextResponse.json({ rules: rows.map(rowToHelixAlertRule) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[helix alert rules GET]", error);
    return NextResponse.json({ error: "Failed to load rule" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

/** Upsert the authed user's ONE rule for a ticker. */
export async function PUT(req: NextRequest) {
  const auth = await requireHelixAlertAuth();
  if (auth instanceof Response) return auth;
  const { userId } = auth;
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  let body: { ticker?: string; minPremium?: unknown; side?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const ticker = normalizeTicker(body.ticker);
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400, headers: NO_STORE_HEADERS });

  const clean = sanitizeIncomingHelixAlertRule(ticker, body);
  if (!clean) {
    return NextResponse.json({ error: "Invalid rule (minPremium must be a positive number, enabled must be a boolean)" }, {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }

  try {
    await ensureHelixAlertRulesTable();
    await dbQuery(
      `INSERT INTO helix_alert_rules (user_id, ticker, min_premium, side, enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, ticker)
       DO UPDATE SET min_premium = $3, side = $4, enabled = $5, updated_at = now()`,
      [userId, ticker, clean.minPremium, clean.side, clean.enabled]
    );
    return NextResponse.json({ ok: true, rule: { ticker, ...clean } }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[helix alert rules PUT]", error);
    return NextResponse.json({ error: "Failed to save rule" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

/** Remove the authed user's rule for ONE ticker (body: { ticker }). */
export async function DELETE(req: NextRequest) {
  const auth = await requireHelixAlertAuth();
  if (auth instanceof Response) return auth;
  const { userId } = auth;
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
    await ensureHelixAlertRulesTable();
    await dbQuery(`DELETE FROM helix_alert_rules WHERE user_id = $1 AND ticker = $2`, [userId, ticker]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[helix alert rules DELETE]", error);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
