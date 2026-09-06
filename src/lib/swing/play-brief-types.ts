import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { HorizonPlay } from "@/lib/horizon-plays";
import type { SwingMeridianCatalystSlice } from "./play-brief-meridian";

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
};

export type SwingPlayBriefResult = {
  playId: string;
  ticker: string;
  envelope: BieAnswerEnvelope;
  asOf: string;
  /** Deterministic — no Anthropic spend. */
  engine: "swing_play_intelligence";
};
