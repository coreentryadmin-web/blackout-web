import type { VectorPickEvidenceSection } from "./vector-pick-evidence";

/** Evidence shown on the contract / execution rail. */
export const OPTION_PLAY_EVIDENCE_IDS = new Set<VectorPickEvidenceSection["id"]>([
  "strike",
  "liquidity",
]);

/** Cross-product desk intelligence rail (HELIX, Thermal, chart, catalysts). */
export const DESK_DATA_EVIDENCE_IDS = new Set<VectorPickEvidenceSection["id"]>([
  "flow",
  "positioning",
  "gex",
  "structure",
  "technicals",
  "catalyst",
  "session",
]);

export function partitionPickEvidence(sections: readonly VectorPickEvidenceSection[]): {
  optionPlay: VectorPickEvidenceSection[];
  deskData: VectorPickEvidenceSection[];
} {
  const optionPlay: VectorPickEvidenceSection[] = [];
  const deskData: VectorPickEvidenceSection[] = [];
  for (const s of sections) {
    if (OPTION_PLAY_EVIDENCE_IDS.has(s.id)) optionPlay.push(s);
    else if (DESK_DATA_EVIDENCE_IDS.has(s.id)) deskData.push(s);
  }
  return { optionPlay, deskData };
}
