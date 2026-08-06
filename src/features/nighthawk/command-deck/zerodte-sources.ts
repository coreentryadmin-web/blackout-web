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
import type { ThesisHealthPayload } from "@/lib/zerodte/thesis-health";
import { resolveFreshFindStatus, type SessionHeatState } from "@/lib/zerodte/board";

import type { DiscoveryFunnelHint } from "@/lib/zerodte/discovery-funnel-hint";
import type { MarketStateSnapshot } from "@/lib/zerodte/market-state-engine";
import type { SpxSlayerBadge } from "@/features/spx/lib/spx-slayer-badge-map";

export interface BoardResp {
  available?: boolean;
  degraded?: boolean;
  upstream_ok?: boolean;
  as_of?: string;
  setups?: Array<Record<string, unknown>>;
  ledger?: Array<Record<string, unknown>>;
  allocation?: Array<{ ticker: string; role: string; sizing: string; reasons?: string[] }>;
  session?: { heat?: { state?: string | null } | null; date?: string; trading_day?: boolean } | null;
  /** Phase 2b — regime-adaptive rail weights at merge rank. */
  market_state?: MarketStateSnapshot | null;
  /** Phase 2c — top session gate/rejection hint for the member strip. */
  discovery_funnel?: DiscoveryFunnelHint | null;
  /** feat/nh-spx-badge — SPX Slayer's own live play, read-only display badge (4th tile). Not a
   *  Night Hawk discovery lane; does not feed setups/ledger/allocation above. */
  spx_slayer_badge?: SpxSlayerBadge | null;
}

/** Ledger statuses that represent a WORKING (member-held) position — always rendered (9-4). */
export const WORKING_STATUSES = new Set(["OPEN", "HOLD", "TRIM"]);

/** True when the board payload is degraded/unavailable and must NOT be painted as a calm flat tape (9-3).
 *  `resp == null` is the first-load state (still fetching) — not degraded. */
export function isBoardDegraded(resp: BoardResp | null | undefined): boolean {
  return resp != null && (resp.available === false || resp.degraded === true || resp.upstream_ok === false);
}

/** Pull a finite number from a nested plan blob (setup.plan / ledger.plan_json). */
function planNum(plan: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = plan?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Build one deck source from a setup (may be null for a ledger-only open position) + its ledger row. */
function sourceFrom(
  tk: string,
  s: Record<string, unknown> | null,
  lg: Record<string, unknown> | null,
  allocation: { role: string; sizing: string; reasons?: string[] } | null,
  heatState: SessionHeatState | undefined,
): ZeroDteDeckSource {
  const setupPlanEarly = (s?.plan as Record<string, unknown> | null | undefined) ?? null;
  const gateVerdict = (s?.gate as { verdict?: string } | undefined)?.verdict;
  // A committed play's ledger status wins; else mirror mergePlays / ZeroDteBoard (9-6a + session heat).
  const status =
    (lg?.status as string) ??
    (gateVerdict === "BLOCKED"
      ? "SKIP"
      : resolveFreshFindStatus(
          heatState,
          setupPlanEarly?.entry_status === "MOVED",
          Boolean(setupPlanEarly?.illiquid),
        ));
  // Plan quote (WATCH setups): the board carries plan.mark/bid/ask/occ on every enriched find.
  // Without plumbing these, the right-rail mark/book stay "—" until a fresh SSE tick — and after
  // hours the marks lane is intentionally stale/null, so the three panels looked completely static.
  const setupPlan = (s?.plan as Record<string, unknown> | null | undefined) ?? null;
  const ledgerPlan =
    (lg?.plan_json as Record<string, unknown> | null | undefined) ??
    (lg?.plan as Record<string, unknown> | null | undefined) ??
    null;
  const occ =
    (typeof lg?.occ === "string" && lg.occ.length > 0 ? lg.occ : null) ??
    (typeof setupPlan?.occ === "string" && setupPlan.occ.length > 0 ? (setupPlan.occ as string) : null) ??
    (typeof ledgerPlan?.occ === "string" && ledgerPlan.occ.length > 0 ? (ledgerPlan.occ as string) : null);
  const planMark = planNum(setupPlan, "mark") ?? planNum(ledgerPlan, "mark");
  const planBid = planNum(setupPlan, "bid") ?? planNum(ledgerPlan, "bid");
  const planAsk = planNum(setupPlan, "ask") ?? planNum(ledgerPlan, "ask");
  const lastMark = (lg?.last_mark as number) ?? planMark;
  const bid = (lg?.bid as number) ?? planBid;
  const ask = (lg?.ask as number) ?? planAsk;
  // SYNC badge: ledger already flags mark_is_sync when the live lane didn't serve a timestamp.
  // A WATCH mark that came ONLY from setup.plan (no ledger last_mark / no mark_as_of) is also
  // unknown-age sync — never paint it as a 1s-fresh LIVE pulse.
  const markAsOf = (lg?.mark_as_of as string) ?? null;
  const markIsSync =
    (lg?.mark_is_sync as boolean) ??
    (lastMark != null && markAsOf == null ? true : null);

  // A ledger-only open position (no fresh setup) still needs direction/strike so the card isn't blank.
  // Carry OCC onto a synthesized plan so the adapter + SSE overlay can key the contract.
  const setup =
    (s as ZeroDteDeckSource["setup"]) ??
    (lg
      ? ({
          direction: lg.direction as "long" | "short",
          top_strike: (lg.top_strike as number) ?? null,
          dte: null,
          plan: occ
            ? {
                occ,
                mark: planMark,
                bid: planBid,
                ask: planAsk,
                stop_premium: planNum(ledgerPlan, "stop_premium"),
                target_premium: planNum(ledgerPlan, "target_premium"),
              }
            : null,
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
    live_pnl_pct:
      status === "WATCH" || status === "SKIP" ? null : ((lg?.live_pnl_pct as number) ?? null),
    entry_premium: (lg?.entry_premium as number) ?? null,
    last_mark: lastMark,
    peak_premium: (lg?.peak_premium as number) ?? null,
    trough_premium: (lg?.trough_premium as number) ?? null,
    setup,
    allocation,
    exit_policy: (lg?.exit_policy as ZeroDteDeckSource["exit_policy"]) ?? null,
    bid,
    ask,
    live_pnl_pct_exec: (lg?.live_pnl_pct_exec as number) ?? null,
    greeks: (lg?.greeks as ZeroDteDeckSource["greeks"]) ?? null,
    mark_as_of: markAsOf,
    mark_is_sync: markIsSync,
    occ,
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
    thesis_health: (lg?.thesis_health as ThesisHealthPayload | null) ?? null,
    closed_reason: (lg?.closed_reason as string) ?? null,
    exit_reason: (lg?.exit_reason as string) ?? null,
    exit_detail: (lg?.exit_detail as string) ?? null,
    exit_at: (lg?.exit_at as string) ?? null,
    exit_pnl_pct: (lg?.exit_pnl_pct as number) ?? null,
    timeline_tranches: (lg?.timeline_tranches as ZeroDteDeckSource["timeline_tranches"]) ?? null,
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

  const heatState = resp.session?.heat?.state as SessionHeatState | undefined;
  const sessionClosed = heatState === "CLOSED" || heatState === undefined;

  const out: ZeroDteDeckSource[] = [];
  const seen = new Set<string>();
  for (const s of resp.setups ?? []) {
    const tk = String(s.ticker ?? "").toUpperCase();
    if (!tk) continue;
    // After close (or unknown heat) fresh finds are NOT plays — mirror mergePlays (ZeroDteBoard.tsx).
    if (sessionClosed && !ledgerByTk.has(tk)) continue;
    seen.add(tk);
    out.push(sourceFrom(tk, s, ledgerByTk.get(tk) ?? null, allocByTk.get(tk) ?? null, heatState));
  }
  // Union ALL ledger rows the scan didn't surface: WORKING positions (9-4) AND CLOSED plays so
  // they remain visible in the "Closed" filter instead of vanishing when the scanner drops them.
  for (const [tk, lg] of ledgerByTk) {
    if (seen.has(tk)) continue;
    const st = String(lg.status ?? "").toUpperCase();
    if (!WORKING_STATUSES.has(st) && st !== "CLOSED") continue;
    out.push(sourceFrom(tk, null, lg, allocByTk.get(tk) ?? null, heatState));
  }
  return out;
}
