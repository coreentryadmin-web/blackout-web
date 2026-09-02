// Resolve a Legacy edition play's OCC symbol from its member-facing options_play string.
// Pure — no I/O. Used by the deck adapter (occ field) and the legacy-marks API.

import { buildOccContractId } from "@/lib/helix/occ-contract-id";
import { parseOptionsContract } from "./option-contract-parse";

/** Build OCC from ticker + options_play (formatOptionsPlay output). Returns null when unparseable. */
export function resolveLegacyPlayOcc(ticker: string, optionsPlay: string | null | undefined): string | null {
  if (!optionsPlay || optionsPlay === "—") return null;
  const parsed = parseOptionsContract(optionsPlay);
  if (!parsed?.side || !parsed.expiryYmd) return null;
  const optionType = parsed.side === "put" ? "PUT" : "CALL";
  return buildOccContractId(ticker, parsed.expiryYmd, optionType, parsed.strike);
}

/** Polygon unified snapshot keys use the `O:` prefix; Legacy play rows store bare OCC. */
export function legacyOccForSnapshot(occ: string): string {
  const bare = occ.trim().toUpperCase().replace(/^O:/, "");
  return bare ? `O:${bare}` : occ;
}

export function lookupLegacyOptionSnapshot<T>(
  snaps: Map<string, T>,
  occ: string
): T | undefined {
  const bare = occ.trim().toUpperCase().replace(/^O:/, "");
  const prefixed = `O:${bare}`;
  return snaps.get(occ) ?? snaps.get(bare) ?? snaps.get(prefixed);
}
