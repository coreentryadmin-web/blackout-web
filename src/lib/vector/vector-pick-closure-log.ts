/**
 * Pure helpers for logging Vector contract picks when they transition to Don't buy.
 * Closures are analysis rows — not committed trading positions.
 */
import type { VectorPickActionStatus } from "@/features/vector/lib/vector-play-candidates";

export function vectorPickClosureCommitKey(sessionDate: string, ticker: string, occ: string): string {
  return `${sessionDate}:${ticker.trim().toUpperCase()}:${occ.trim().toUpperCase()}`;
}

/** Log the first Don't buy for this commit_key per session (idempotent at DB layer). */
export function shouldPersistVectorPickClosure(
  actionStatus: VectorPickActionStatus,
  alreadyLogged: boolean
): boolean {
  return actionStatus === "dont_buy" && !alreadyLogged;
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
