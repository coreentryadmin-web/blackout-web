/**
 * Pure helpers for logging Vector contract picks when they transition to Don't buy.
 * Closures are analysis rows — not committed trading positions.
 */
import type { VectorPickActionStatus } from "@/features/vector/lib/vector-play-candidates";

export function vectorPickClosureCommitKey(sessionDate: string, ticker: string, occ: string): string {
  return `${sessionDate}:${ticker.trim().toUpperCase()}:${occ.trim().toUpperCase()}`;
}

/** True when the close reason is a fresh-entry chase-risk block (not a thesis failure). */
export function isVectorPickChaseRiskCloseReason(closeReason: string | null | undefined): boolean {
  return typeof closeReason === "string" && /chase risk/i.test(closeReason);
}

/** Log the first Don't buy for this commit_key per session (idempotent at DB layer). */
export function shouldPersistVectorPickClosure(
  actionStatus: VectorPickActionStatus,
  alreadyLogged: boolean,
  closeReason?: string | null
): boolean {
  if (actionStatus !== "dont_buy" || alreadyLogged) return false;
  // Desk PLYS fresh-entry chase risk is not a board closure — only setup/cap failures are.
  if (isVectorPickChaseRiskCloseReason(closeReason)) return false;
  return true;
}

export type VectorPickClosurePayload = {
  commitKey: string;
  sessionDate: string;
  ticker: string;
  occ: string;
  side: "call" | "put";
  strike: number;
  expiry: string;
  rank: number | null;
  label: string | null;
  role: string | null;
  entryMid: number | null;
  closeMid: number | null;
  premiumPctFromEntry: number | null;
  closeReason: string;
  setupInvalidated: boolean;
  spot: number;
  playJson: Record<string, unknown> | null;
  pickJson: Record<string, unknown> | null;
};
