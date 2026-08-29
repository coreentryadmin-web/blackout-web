// Pure per-row shaping for the admin tier-export route (Task tracking #59 — see
// docs/audit/0DTE-RESEARCH.md's "Follow-up scoped but BLOCKED" note, 2026-08-28, and the
// route's own header comment for the full story). Split out so the field mapping — in
// particular, which tier a row gets — is unit-testable without a live database.
import type { ZeroDteSetupLogRow } from "@/lib/db";
import { tierFromEntryContext } from "./tiers";

export type ZeroDteTierExportRow = {
  session_date: string;
  ticker: string;
  direction: "long" | "short";
  /** Real historical tier from the SAME pinned entry_context adapter the live system used
   *  at commit — null means genuinely untiered (pre-context row), never fabricated as "C". */
  tier: "A" | "B" | "C" | null;
  first_flagged_at: string;
  entry_premium: number | null;
  top_strike: number | null;
  expiry: string | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  status: string | null;
  exit_policy_at_commit: string | null;
};

export function buildTierExportRow(row: ZeroDteSetupLogRow): ZeroDteTierExportRow {
  const assignment = tierFromEntryContext(row.entry_context);
  const ctx = row.entry_context;
  return {
    session_date: row.session_date,
    ticker: row.ticker,
    direction: row.direction,
    tier: assignment?.tier ?? null,
    first_flagged_at: row.first_flagged_at,
    entry_premium: row.entry_premium,
    top_strike: row.top_strike,
    expiry: row.expiry,
    plan_outcome: row.plan_outcome,
    plan_pnl_pct: row.plan_pnl_pct,
    status: row.status,
    exit_policy_at_commit:
      ctx && typeof ctx === "object" && typeof ctx.exit_policy_at_commit === "string"
        ? ctx.exit_policy_at_commit
        : null,
  };
}
