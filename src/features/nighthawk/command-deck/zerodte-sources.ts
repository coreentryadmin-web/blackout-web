/**
 * Pure board-payload → deck-source derivation for the 0DTE Command Deck. Split out of containers.tsx (a
 * React client module) so it can be unit-tested without the React/SWR/EventSource graph.
 *
 * Two correctness rules live here (see docs/audit/0DTE-SYSTEM.md §9):
 *  - 9-4: every WORKING ledger position (OPEN/HOLD/TRIM) renders even if the scan no longer surfaces its
 *    ticker — an open play must never vanish from the only surface that manages it.
 *  - 9-6a: a fresh find's status comes from its gate verdict — a gate-BLOCKED (refused) find is a SKIP,
 *    not a still-in-consideration WATCH.
 */
import type { ZeroDteDeckSource } from "./adapters";

export interface BoardResp {
  available?: boolean;
  degraded?: boolean;
  upstream_ok?: boolean;
  setups?: Array<Record<string, unknown>>;
  ledger?: Array<Record<string, unknown>>;
  allocation?: Array<{ ticker: string; role: string; sizing: string; reasons?: string[] }>;
}

/** Ledger statuses that represent a WORKING (member-held) position — always rendered (9-4). */
export const WORKING_STATUSES = new Set(["OPEN", "HOLD", "TRIM"]);

/** True when the board payload is degraded/unavailable and must NOT be painted as a calm flat tape (9-3).
 *  `resp == null` is the first-load state (still fetching) — not degraded. */
export function isBoardDegraded(resp: BoardResp | null | undefined): boolean {
  return resp != null && (resp.available === false || resp.degraded === true || resp.upstream_ok === false);
}

/** Build one deck source from a setup (may be null for a ledger-only open position) + its ledger row. */
function sourceFrom(
  tk: string,
  s: Record<string, unknown> | null,
  lg: Record<string, unknown> | null,
  allocation: { role: string; sizing: string; reasons?: string[] } | null,
): ZeroDteDeckSource {
  const gateVerdict = (s?.gate as { verdict?: string } | undefined)?.verdict;
  // A committed play's ledger status wins; else the fresh find's gate verdict decides (BLOCKED → SKIP).
  const status = (lg?.status as string) ?? (gateVerdict === "BLOCKED" ? "SKIP" : "WATCH");
  // A ledger-only open position (no fresh setup) still needs direction/strike so the card isn't blank.
  const setup =
    (s as ZeroDteDeckSource["setup"]) ??
    (lg
      ? ({
          direction: lg.direction as "long" | "short",
          top_strike: (lg.top_strike as number) ?? null,
          dte: null,
        } as ZeroDteDeckSource["setup"])
      : null);
  // Terminal v2 additive block — read the real ladder + live greeks/book/executable + origin/tier
  // straight off the ledger row (server payload) or the sim frame; confluence off the setup. All
  // OPTIONAL: a legacy payload that omits them yields undefined and the terminal degrades to "—".
  const confl = s?.confluence as { confirmations?: number } | undefined;
  return {
    ticker: tk,
    strike: (s?.top_strike as number) ?? (lg?.top_strike as number) ?? null,
    status,
    score: (s?.score as number) ?? null,
    live_pnl_pct: (lg?.live_pnl_pct as number) ?? null,
    entry_premium: (lg?.entry_premium as number) ?? null,
    last_mark: (lg?.last_mark as number) ?? null,
    peak_premium: (lg?.peak_premium as number) ?? null,
    trough_premium: (lg?.trough_premium as number) ?? null,
    setup,
    allocation,
    exit_policy: (lg?.exit_policy as ZeroDteDeckSource["exit_policy"]) ?? null,
    bid: (lg?.bid as number) ?? null,
    ask: (lg?.ask as number) ?? null,
    live_pnl_pct_exec: (lg?.live_pnl_pct_exec as number) ?? null,
    greeks: (lg?.greeks as ZeroDteDeckSource["greeks"]) ?? null,
    mark_as_of: (lg?.mark_as_of as string) ?? null,
    mark_is_sync: (lg?.mark_is_sync as boolean) ?? null,
    discovery_origin: (lg?.discovery_origin as string[]) ?? (s?.discovery_origin as string[]) ?? null,
    tier: (lg?.tier as ZeroDteDeckSource["tier"]) ?? null,
    confluence: confl?.confirmations ?? null,
    scorecard: (lg?.scorecard as ZeroDteDeckSource["scorecard"]) ?? null,
    // Condor detection: the ledger row's is_condor flag (server/sim) or the setup's play_type.
    is_condor:
      (lg?.is_condor as boolean) ??
      (lg?.play_type === "CONDOR" || s?.play_type === "CONDOR" ? true : null),
    // Condor render geometry (Wave 2): the frozen CondorPlan blob on the ledger row (server:
    // entry_context.condor → the payload's `condor`; sim: the condor frame). Parsed structurally by
    // the adapter, so a missing/malformed blob simply degrades the tent. The LIVE underlying comes
    // from the freshest source available — the ledger row (server may carry it) or the setup's
    // underlying_price — for the tent's current-price marker.
    condor: (lg?.condor as unknown) ?? null,
    underlying_price:
      (lg?.underlying_price as number) ?? (s?.underlying_price as number) ?? null,
    // Edge layer (Wave 3): the pinned trigger reason (server ledger row / sim frame) + the
    // first-flag instant for the ribbon's ET clock time. Both OPTIONAL/null-safe.
    why_now: (lg?.why_now as ZeroDteDeckSource["why_now"]) ?? null,
    first_flagged_at: (lg?.first_flagged_at as string) ?? null,
  };
}

/** Merge the board payload into deck sources: each ranked setup ⋈ its ledger row ⋈ allocation, PLUS every
 *  working ledger position the scan didn't surface (9-4). */
export function zeroDteSources(resp: BoardResp | null): ZeroDteDeckSource[] {
  if (!resp) return [];
  const ledgerByTk = new Map<string, Record<string, unknown>>();
  for (const r of resp.ledger ?? []) ledgerByTk.set(String(r.ticker ?? "").toUpperCase(), r);
  const allocByTk = new Map<string, { role: string; sizing: string; reasons?: string[] }>();
  for (const a of resp.allocation ?? []) allocByTk.set(a.ticker.toUpperCase(), a);

  const out: ZeroDteDeckSource[] = [];
  const seen = new Set<string>();
  for (const s of resp.setups ?? []) {
    const tk = String(s.ticker ?? "").toUpperCase();
    if (!tk) continue;
    seen.add(tk);
    out.push(sourceFrom(tk, s, ledgerByTk.get(tk) ?? null, allocByTk.get(tk) ?? null));
  }
  // Union ALL ledger rows the scan didn't surface: WORKING positions (9-4) AND CLOSED plays so
  // they remain visible in the "Closed" filter instead of vanishing when the scanner drops them.
  for (const [tk, lg] of ledgerByTk) {
    if (seen.has(tk)) continue;
    const st = String(lg.status ?? "").toUpperCase();
    if (!WORKING_STATUSES.has(st) && st !== "CLOSED") continue;
    out.push(sourceFrom(tk, null, lg, allocByTk.get(tk) ?? null));
  }
  return out;
}
