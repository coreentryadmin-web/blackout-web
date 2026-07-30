/**
 * Reconstruct an OCC option symbol for a held Swing ledger row.
 *
 * WHY: commit historically wrote `contract_occ: null` (ChainContract had no OCC field). Without an OCC,
 * active-refresh cannot load a live option mark → premium_stop (−60%), profit ladder, and mark-frozen
 * rolls never fire. Reconstructing from the pinned strike/expiry/type columns restores those gates for
 * every already-open row AND for new commits once `contract_occ` is populated at insert time.
 *
 * Returns a Massive/Polygon-style `O:` prefixed symbol, or null when the row lacks enough identity.
 */

import { buildOcc } from "@/lib/ws/options-socket";

export type SwingOccRowParts = {
  contract_occ?: string | null;
  ticker?: string | null;
  contract_expiry?: string | null;
  contract_type?: string | null;
  contract_strike?: number | null;
};

/** Prefer the stored OCC; otherwise rebuild from strike/expiry/type. Always returns `O:`-prefixed or null. */
export function occSymbolFromSwingRow(row: SwingOccRowParts): string | null {
  const raw = row.contract_occ?.trim();
  if (raw) return raw.startsWith("O:") ? raw : `O:${raw}`;

  const ticker = String(row.ticker ?? "").trim().toUpperCase();
  const expiry = String(row.contract_expiry ?? "").trim().slice(0, 10);
  const strike = row.contract_strike;
  const typeRaw = String(row.contract_type ?? "").trim().toLowerCase();
  const optionType = typeRaw.startsWith("p") ? "put" : typeRaw.startsWith("c") ? "call" : null;
  if (!ticker || !expiry || optionType == null || strike == null || !Number.isFinite(strike) || strike <= 0) {
    return null;
  }
  return buildOcc(ticker, expiry, optionType, strike);
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
