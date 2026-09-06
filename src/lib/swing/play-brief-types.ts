import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { HorizonPlay } from "@/lib/horizon-plays";
import type { SwingMeridianCatalystSlice } from "./play-brief-meridian";
import type { PortfolioPosition } from "./portfolio";

/** Inputs gathered server-side for deterministic swing play brief composition. */
export type SwingPlayBriefContext = {
  play: TerminalPlay;
  asOf: string;
  /** ET session date for the brief stamp (YYYY-MM-DD). */
  sessionDate: string | null;
  scanAsOf: string | null;
  ecosystem: EcosystemContext | null;
  vector: VectorFullState | null;
  /** ET session day for the swing discovery scan, when known. */
  scanSessionDay: string | null;
  /** Full serving-lane rows for comparative rank. */
  laneRows: HorizonPlay[];
  /** Meridian catalyst calendar slice for this ticker. */
  meridian: SwingMeridianCatalystSlice | null;
  /** Member open swing book for theme-overlap concentration read. */
  openBook?: PortfolioPosition[];
};

export type SwingPlayBriefResult = {
  playId: string;
  ticker: string;
  envelope: BieAnswerEnvelope;
  asOf: string;
  /** Deterministic — no Anthropic spend. */
  engine: "swing_play_intelligence";
  /**
   * HELIX flow premiums for this cycle, split out as an explicit typed field rather than folded
   * into `envelope.levels` — the "what changed" diff engine (play-brief-diff.ts) needs these as
   * numbers to detect a call/put flow shift between polls, and a `BieLevel` (a chart price level)
   * is the wrong shape for a dollar premium total. null when HELIX has no recent-flow read.
   */
  flowSnapshot: { callPremium: number | null; putPremium: number | null } | null;
};
