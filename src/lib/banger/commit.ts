/**
 * ENGINE B — discovery-and-commit orchestrator.
 * ============================================================================
 * Wires the pure screen (discovery.ts) + pure contract picker (contract.ts) to live Polygon reads and
 * the banger_positions ledger (positions-db.ts). Checks the kill-switch FIRST (flag.ts) — a disabled
 * engine touches nothing.
 *
 * ZERO CAPS (operator direct instruction, 2026-08-04): every ticker screenBangerMovers returns is
 * attempted — there is no top-N slice, no daily-commit cap, no position-count cap here. The screen
 * itself (gain/volume/price/close-strength) is the only filter. Injected deps keep this unit-testable
 * without live Polygon/DB.
 */

import { screenBangerMovers, nearestWeeklyExpiry, type GroupedDailyRow, type BangerMover } from "@/lib/banger/discovery";
import { pickBangerContract, type FetchBarsFn } from "@/lib/banger/contract";
import { isBangerEngineEnabled } from "@/lib/banger/flag";

export type BangerCommitDeps = {
  /** Whole-market grouped-daily rows for the session being scanned. */
  fetchGroupedDaily: () => Promise<GroupedDailyRow[]>;
  fetchBars: FetchBarsFn;
  insertPosition: (pos: {
    commit_key: string;
    session_date: string;
    ticker: string;
    discovery_gain?: number | null;
    discovery_vol?: number | null;
    discovery_dollar_vol?: number | null;
    discovery_close_strength?: number | null;
    contract_strike: number;
    contract_expiry: string;
    contract_occ: string;
    entry_premium: number;
    entry_context?: Record<string, unknown> | null;
  }) => Promise<number>;
  sessionDate: string;
  /** How many calendar days forward from sessionDate to bound the entry-bar probe window. */
  holdWindowDays?: number;
  env?: NodeJS.ProcessEnv;
};

export type BangerCommitResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  sessionDate: string;
  screened: number;
  committed: number;
  contractMisses: number;
  errors: number;
  tickers: string[];
};

function ymdPlusDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Run one discovery-and-commit pass: screen the whole market, pick a contract for EVERY qualifying
 * mover (no cap beyond the screen itself), and commit each to banger_positions. Fail-soft per ticker —
 * one contract-probe miss or insert error is tallied and skipped, never aborting the pass.
 */
export async function runBangerCommit(deps: BangerCommitDeps): Promise<BangerCommitResult> {
  const env = deps.env ?? process.env;
  if (!isBangerEngineEnabled(env)) {
    return {
      ok: true,
      skipped: true,
      reason: "BANGER_ENGINE_ENABLED=0 — Engine B is off",
      sessionDate: deps.sessionDate,
      screened: 0,
      committed: 0,
      contractMisses: 0,
      errors: 0,
      tickers: [],
    };
  }

  const results = await deps.fetchGroupedDaily();
  const movers: BangerMover[] = screenBangerMovers(results);
  const expiry = nearestWeeklyExpiry(deps.sessionDate, 4);
  const toDate = ymdPlusDays(deps.sessionDate, deps.holdWindowDays ?? 9);

  let committed = 0;
  let contractMisses = 0;
  let errors = 0;
  const tickers: string[] = [];

  for (const mover of movers) {
    let pick;
    try {
      pick = await pickBangerContract(mover.ticker, mover.close, expiry, deps.sessionDate, toDate, deps.fetchBars);
    } catch {
      errors += 1;
      continue;
    }
    if (!pick) {
      contractMisses += 1;
      continue;
    }
    const commitKey = `${deps.sessionDate}:${mover.ticker}:${pick.expiry}:${pick.strike}`;
    try {
      await deps.insertPosition({
        commit_key: commitKey,
        session_date: deps.sessionDate,
        ticker: mover.ticker,
        discovery_gain: mover.gain,
        discovery_vol: mover.vol,
        discovery_dollar_vol: mover.dollar,
        discovery_close_strength: mover.closeStrength,
        contract_strike: pick.strike,
        contract_expiry: pick.expiry,
        contract_occ: pick.occ,
        entry_premium: pick.entryPremium,
        entry_context: { discovery: mover, screen: "banger_v1" },
      });
      committed += 1;
      tickers.push(mover.ticker);
    } catch (err) {
      console.error(`[banger/commit] insert failed for ${mover.ticker}`, err);
      errors += 1;
    }
  }

  return {
    ok: true,
    skipped: false,
    sessionDate: deps.sessionDate,
    screened: movers.length,
    committed,
    contractMisses,
    errors,
    tickers,
  };
}
