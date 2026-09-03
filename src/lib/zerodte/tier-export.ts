// Pure per-row shaping for the admin tier-export route (Task tracking #59 — see
// docs/audit/0DTE-RESEARCH.md's "Follow-up scoped but BLOCKED" note, 2026-08-28, and the
// route's own header comment for the full story). Split out so the field mapping — in
// particular, which tier a row gets — is unit-testable without a live database.
import type { ZeroDteSetupLogRow } from "@/lib/db";
import { tierFromEntryContext } from "./tiers";
import { readFrozenExitPolicy } from "./exit-sync";
import type { ResolvedExitPolicy } from "./strategy-version";

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
  /** Pinned at commit — drives condor vs directional replay routing. */
  play_type: "DIRECTIONAL" | "CONDOR" | null;
  /** Frozen session regime for trim_scale tranche thresholds (entry_context.session_regime). */
  session_regime: "trend" | "neutral" | "range" | null;
  /** Runner target % frozen at commit (exit_policy_snapshot.target_pct or runner_profile). */
  runner_target_pct: number | null;
  runner_tag: string | null;
  /** DB-stamped conservative-executable grade (entry_context.executable), when present. */
  stored_executable_pnl_pct: number | null;
  stored_executable_outcome: string | null;
  peak_premium: number | null;
  trough_premium: number | null;
  /** Frozen WS-02 exit policy snapshot — the grader replays under THESE numbers, not current code. */
  exit_policy_snapshot: ResolvedExitPolicy | null;
  /** Condor geometry subset when play_type === CONDOR. */
  condor: {
    breach_lower: number;
    breach_upper: number;
    net_credit: number | null;
    max_loss: number | null;
    gross_wing_risk: number;
    net_credit_mid: number | null;
  } | null;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function buildTierExportRow(row: ZeroDteSetupLogRow): ZeroDteTierExportRow {
  const assignment = tierFromEntryContext(row.entry_context);
  const ctx = row.entry_context as Record<string, unknown> | null;
  const frozen = readFrozenExitPolicy(ctx);
  const runner = ctx?.runner_profile as { target_pct?: unknown; tag?: unknown } | null;
  const exec = ctx?.executable as { plan_pnl_pct?: unknown; plan_outcome?: unknown } | null;
  const regime = ctx?.session_regime;
  const playType = ctx?.play_type;
  const condorRaw = ctx?.condor as Record<string, unknown> | null;
  const condor =
    playType === "CONDOR" && condorRaw
      ? {
          breach_lower: Number(condorRaw.breach_lower ?? condorRaw.short_put),
          breach_upper: Number(condorRaw.breach_upper ?? condorRaw.short_call),
          net_credit: num(condorRaw.net_credit),
          max_loss: num(condorRaw.max_loss),
          gross_wing_risk: Number(condorRaw.gross_wing_risk),
          net_credit_mid: num(condorRaw.net_credit_mid),
        }
      : null;
  const condorOk =
    condor != null && Number.isFinite(condor.breach_lower) && Number.isFinite(condor.breach_upper);
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
      ctx && typeof ctx.exit_policy_at_commit === "string" ? ctx.exit_policy_at_commit : null,
    play_type: playType === "CONDOR" ? "CONDOR" : playType === "DIRECTIONAL" ? "DIRECTIONAL" : null,
    session_regime:
      regime === "trend" || regime === "neutral" || regime === "range" ? regime : null,
    runner_target_pct: num(frozen?.target_pct) ?? num(runner?.target_pct),
    runner_tag: typeof runner?.tag === "string" ? runner.tag : null,
    stored_executable_pnl_pct: num(exec?.plan_pnl_pct),
    stored_executable_outcome:
      typeof exec?.plan_outcome === "string" ? exec.plan_outcome : null,
    peak_premium: row.peak_premium,
    trough_premium: row.trough_premium,
    exit_policy_snapshot: frozen,
    condor: condorOk ? condor : null,
  };
}
