/**
 * COMMAND DECK — the horizon-agnostic terminal contract.
 *
 * One matrix terminal renders all four boards (0DTE / Swings / LEAPS / Legacy). Each board produces this
 * shape from its own data via a pure adapter (adapters.ts), so the terminal never knows which board it's
 * showing — the payoff of the HorizonPlay/explainability/allocation unification. Pure data; no React.
 */

import type { SwingSetupState, SwingEntryState } from "@/lib/swing/taxonomy";
import type { SwingServingSection } from "@/lib/swing/serving";

export type DeckDirection = "LONG" | "SHORT";
export type DeckStatus = "OPEN" | "HOLD" | "TRIM" | "CLOSED" | "WATCH" | "SKIP";
export type ExitModel = "RATCHET" | "SCALE_OUT" | "PLAN";
export type Recommendation = "HOLD" | "TRIM" | "SELL";
export type ThesisLevel = "intact" | "warn" | "break" | "unknown";

/** A signed, point-weighted reason (from the real scoring components). */
export interface DeckFactor {
  label: string;
  points: number;
}

/** Live option greeks for the streaming strip. Null fields render as "—" until the stream carries them. */
export interface DeckGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
}

export interface TerminalPlay {
  id: string;
  ticker: string;
  direction: DeckDirection;
  /** Human contract label, e.g. "192C · 0DTE". */
  contract: string;
  /** OCC symbol for the live greeks/marks subscription, when known. */
  occ?: string | null;
  score: number;
  status: DeckStatus;
  horizon: "ZERO_DTE" | "SWING" | "LEAPS" | "LEGACY";
  exitModel: ExitModel;

  // ── thesis ──
  factors: DeckFactor[];
  gates: Array<{ label: string; ok: boolean }>;
  regime?: string | null;
  confidence?: number | null; // 0–1
  allocation?: { role: string; sizing: string; reason?: string } | null;
  thesisBreak?: { level: ThesisLevel; note?: string } | null;

  // ── management ──
  recommendation: Recommendation;
  recNote?: string;
  /** 0–1 position along the ratchet stop→target track (RATCHET); scale-out tranches derive from status. */
  progress?: number | null;

  // ── pnl ──
  entry?: number | null;
  mark?: number | null;
  pnlPct?: number | null;
  peak?: number | null;
  trough?: number | null;

  // ── greeks (live) ──
  greeks?: DeckGreeks | null;

  // ── swing-only enrichment (all OPTIONAL, ADDITIVE — 0DTE/LEAPS/Legacy leave them undefined; PR-12
  //    populates them through the horizon adapter). The observable swing state the serving router keys on. ──
  /** The classified swing archetype label (taxonomy.ts), when this is a SWING play. */
  archetype?: string | null;
  /** The contract sub-lane (Tactical/Standard/Extended) label, when this is a SWING play. */
  subLane?: string | null;
  /** Pre-entry setup maturity — the OBSERVABLE the serving router branches on. */
  setupState?: SwingSetupState | null;
  /** Entry-execution stance — the other OBSERVABLE the serving router branches on. */
  entryStatus?: SwingEntryState | null;
  /** The serving section (serving.ts) this play resolved to, for the section-grouped terminal. */
  servingSection?: SwingServingSection | null;
}
