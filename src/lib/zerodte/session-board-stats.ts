/**
 * Session-level scan vs commit counters for the 0DTE board — pure, display-only.
 * Grounded in the live setups[] + ledger[] the member route already carries.
 */
import { zeroDteGateLabel } from "./pane";

export type ZeroDteSessionBoardStats = {
  /** Candidates the scanner surfaced this cycle (setups.length). */
  scanned: number;
  /** Fresh finds that cleared every hard gate (gate.verdict === COMMIT, not yet in ledger). */
  commit_ready: number;
  /** Fresh finds blocked by at least one hard gate. */
  gate_blocked: number;
  /** Ledger rows still working (OPEN/HOLD/TRIM). */
  committed_open: number;
  /** Ledger rows finished today (CLOSED). */
  committed_closed: number;
  /** Machine code of the most common block this session (from funnel/rejections hint or setups). */
  top_block_code: string | null;
  /** Human label for top_block_code — from zeroDteGateLabel. */
  top_block_label: string | null;
};

type SetupGateSlice = {
  gate?: { verdict?: string; blocks?: Array<{ code?: string }> } | null;
};

type LedgerStatusSlice = {
  status?: string | null;
};

/** Count gate-blocked vs commit-ready among fresh setups (no ledger merge). */
export function tallySetupGateLanes(setups: readonly SetupGateSlice[]): {
  commit_ready: number;
  gate_blocked: number;
  blockCodeCounts: Map<string, number>;
} {
  let commit_ready = 0;
  let gate_blocked = 0;
  const blockCodeCounts = new Map<string, number>();
  for (const s of setups) {
    const verdict = s.gate?.verdict;
    if (verdict === "COMMIT") {
      commit_ready += 1;
      continue;
    }
    if (verdict === "BLOCKED") {
      gate_blocked += 1;
      for (const b of s.gate?.blocks ?? []) {
        const code = String(b.code ?? "").trim();
        if (!code) continue;
        blockCodeCounts.set(code, (blockCodeCounts.get(code) ?? 0) + 1);
      }
    }
  }
  return { commit_ready, gate_blocked, blockCodeCounts };
}

function topBlockFromCounts(counts: Map<string, number>): { code: string | null; label: string | null } {
  let bestCode: string | null = null;
  let bestN = 0;
  for (const [code, n] of counts) {
    if (n > bestN) {
      bestN = n;
      bestCode = code;
    }
  }
  if (!bestCode) return { code: null, label: null };
  return { code: bestCode, label: zeroDteGateLabel(bestCode) };
}

/** Build the session stats object for the board payload. */
export function computeZeroDteSessionBoardStats(
  setups: readonly SetupGateSlice[],
  ledger: readonly LedgerStatusSlice[],
  funnelTopCode?: string | null
): ZeroDteSessionBoardStats {
  const { commit_ready, gate_blocked, blockCodeCounts } = tallySetupGateLanes(setups);
  let committed_open = 0;
  let committed_closed = 0;
  for (const r of ledger) {
    const st = String(r.status ?? "").toUpperCase();
    if (st === "OPEN" || st === "HOLD" || st === "TRIM") committed_open += 1;
    else if (st === "CLOSED") committed_closed += 1;
  }
  const fromSetups = topBlockFromCounts(blockCodeCounts);
  const top_block_code =
    funnelTopCode && funnelTopCode.length > 0 ? funnelTopCode : fromSetups.code;
  const top_block_label =
    top_block_code != null ? zeroDteGateLabel(top_block_code) : fromSetups.label;
  return {
    scanned: setups.length,
    commit_ready,
    gate_blocked,
    committed_open,
    committed_closed,
    top_block_code,
    top_block_label,
  };
}
