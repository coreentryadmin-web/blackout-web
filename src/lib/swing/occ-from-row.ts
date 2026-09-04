/**
 * OCC symbol for a held Swing ledger row — MANAGEMENT path (active-refresh, roll marks).
 *
 * WHY: commit writes `contract_occ` at insert via `occFromChainContract`. For management, a missing OCC is a
 * data incident — reconstructing from strike/expiry/type can silently mark the wrong contract and fire
 * premium_stop / rolls on bad marks (FINDINGS 2026-07-30 P0 #10). Fail-closed: return null unless the
 * ledger carries an explicit OCC. New commits must populate `contract_occ`; legacy rows without one skip
 * premium rungs honestly (underlying structural stop still works).
 *
 * Returns a Massive/Polygon-style `O:` prefixed symbol, or null when absent.
 */

import { buildOcc } from "@/lib/occ-symbol";

export type SwingOccRowParts = {
  contract_occ?: string | null;
  ticker?: string | null;
  contract_expiry?: string | null;
  contract_type?: string | null;
  contract_strike?: number | null;
};

/** Management/read path: stored OCC only — never reconstruct from strike columns. */
export function occSymbolFromSwingRow(row: SwingOccRowParts): string | null {
  const raw = row.contract_occ?.trim();
  if (!raw) return null;
  return raw.startsWith("O:") ? raw : `O:${raw}`;
}

/** OCC for a freshly-picked ChainContract at commit time (bare or O:-prefixed both fine for ledger). */
export function occFromChainContract(args: {
  ticker: string;
  expiry: string;
  right: "C" | "P";
  strike: number;
}): string | null {
  const optionType = args.right === "P" ? "put" : "call";
  const occ = buildOcc(args.ticker, args.expiry, optionType, args.strike);
  // Ledger historically stores without O: prefix (active-refresh normalizes). Keep that convention.
  return occ?.startsWith("O:") ? occ.slice(2) : occ;
}
