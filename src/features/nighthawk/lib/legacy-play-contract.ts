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
