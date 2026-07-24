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
  for (const [tk, lg] of ledgerByTk) {
    if (seen.has(tk)) continue;
    if (!WORKING_STATUSES.has(String(lg.status ?? "").toUpperCase())) continue;
    out.push(sourceFrom(tk, null, lg, allocByTk.get(tk) ?? null));
  }
  return out;
}
